import { createHash } from 'node:crypto';
import webpush from 'web-push';

import {
  dashtecReferenceLines,
  etherscanReferenceLines,
  formatNotificationBody,
} from './notification-content.mjs';

const MIN_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;
const WEB_PUSH_TTL_SECONDS = 24 * 60 * 60;

export class DeliveryError extends Error {
  constructor(message, { permanent = false, retryAfterMs, statusCode, scope = 'endpoint' } = {}) {
    super(message);
    this.permanent = permanent;
    this.retryAfterMs = retryAfterMs;
    this.statusCode = statusCode;
    this.scope = scope;
  }
}

export class WebPushChannel {
  constructor({
    vapid,
    publicUrl,
    timeoutMs = 15_000,
    sendNotification = webpush.sendNotification.bind(webpush),
    now = Date.now,
  }) {
    this.vapid = vapid;
    this.publicUrl = publicUrl;
    this.timeoutMs = timeoutMs;
    this.sendNotification = sendNotification;
    this.now = now;
  }

  async send(delivery, signal) {
    if (!this.vapid) {
      throw new DeliveryError('Web Push is not configured');
    }
    const subscription = parseJson(delivery.endpointConfig, 'stored Web Push subscription');
    const event = delivery.event;
    const payload = JSON.stringify({
      title: event.title,
      body: formatNotificationBody(event).slice(0, 600),
      tag: `slashmon-${event.id}`,
      icon: './favicon.svg',
      badge: './favicon.svg',
      data: {
        caseId: event.data?.caseId ?? null,
        network: event.network,
        url: notificationPath(event),
      },
    });
    try {
      const response = await withAbortSignal(this.sendNotification(subscription, payload, {
        vapidDetails: this.vapid,
        TTL: WEB_PUSH_TTL_SECONDS,
        urgency: ['critical', 'warning'].includes(event.severity) ? 'high' : 'normal',
        topic: createHash('sha256').update(event.id).digest('base64url').slice(0, 32),
        timeout: this.timeoutMs,
      }), signal);
      return { providerMessageId: response?.headers?.location ?? null };
    } catch (error) {
      const statusCode = Number(error?.statusCode) || undefined;
      const permanent = statusCode === 404 || statusCode === 410;
      const scope = [400, 401, 403].includes(statusCode) ? 'channel' : 'endpoint';
      const retryAfterMs = parseRetryAfterMs(readHeader(error?.headers, 'retry-after'), this.now());
      throw new DeliveryError(
        statusCode ? `Web Push returned HTTP ${statusCode}` : 'Web Push request failed',
        { permanent, retryAfterMs, statusCode, scope },
      );
    }
  }
}

function withAbortSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Web Push request aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Web Push request aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function parseRetryAfterMs(value, now = Date.now()) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!['string', 'number'].includes(typeof raw)) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;

  let delayMs;
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isFinite(seconds)) return MAX_RETRY_AFTER_MS;
    delayMs = seconds * 1_000;
  } else {
    const retryAt = Date.parse(text);
    if (!Number.isFinite(retryAt)) return undefined;
    delayMs = retryAt - Number(now);
  }
  if (!Number.isFinite(delayMs)) return MAX_RETRY_AFTER_MS;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, Math.ceil(delayMs)));
}

export class TelegramSendScheduler {
  constructor({
    maxPerSecond = 20,
    lowPriorityMaxPerSecond = 5,
    perChatIntervalMs = 1_000,
    rateWindowMs = 1_000,
    now = Date.now,
  } = {}) {
    for (const [name, value] of Object.entries({
      maxPerSecond,
      lowPriorityMaxPerSecond,
      perChatIntervalMs,
      rateWindowMs,
    })) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer`);
      }
    }
    this.maxPerSecond = maxPerSecond;
    this.lowPriorityMaxPerSecond = Math.min(lowPriorityMaxPerSecond, maxPerSecond);
    this.perChatIntervalMs = perChatIntervalMs;
    this.rateWindowMs = rateWindowMs;
    this.now = now;
    this.alertQueue = [];
    this.lowQueue = [];
    this.sentAt = [];
    this.lowSentAt = [];
    this.chatAvailableAt = new Map();
    this.timer = null;
    this.draining = false;
  }

  acquire(chatId, { priority = 'alert', signal } = {}) {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error('Telegram send scheduling aborted'));
    }
    return new Promise((resolve, reject) => {
      const queue = priority === 'low' ? this.lowQueue : this.alertQueue;
      const entry = {
        chatId: String(chatId),
        priority: priority === 'low' ? 'low' : 'alert',
        resolve,
        reject,
        signal,
        onAbort: null,
      };
      if (signal) {
        entry.onAbort = () => {
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(signal.reason ?? new Error('Telegram send scheduling aborted'));
          this.drain();
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      queue.push(entry);
      this.drain();
    });
  }

  drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      while (this.alertQueue.length > 0 || this.lowQueue.length > 0) {
        const now = this.now();
        this.sentAt = this.sentAt.filter((sentAt) => sentAt > now - this.rateWindowMs);
        this.lowSentAt = this.lowSentAt.filter((sentAt) => sentAt > now - this.rateWindowMs);
        if (this.chatAvailableAt.size > 10_000) {
          for (const [chatId, availableAt] of this.chatAvailableAt) {
            if (availableAt <= now) this.chatAvailableAt.delete(chatId);
          }
        }

        const alertIndex = this.alertQueue.findIndex((entry) => this.readyAt(entry, now) <= now);
        const lowIndex = alertIndex < 0
          ? this.lowQueue.findIndex((entry) => this.readyAt(entry, now) <= now)
          : -1;
        const queue = alertIndex >= 0 ? this.alertQueue : lowIndex >= 0 ? this.lowQueue : null;
        const index = alertIndex >= 0 ? alertIndex : lowIndex;
        if (!queue || index < 0) {
          const waiting = [...this.alertQueue, ...this.lowQueue];
          const wakeAt = Math.min(...waiting.map((entry) => this.readyAt(entry, now)));
          this.timer = setTimeout(
            () => {
              this.timer = null;
              this.drain();
            },
            Math.max(1, Math.ceil(wakeAt - now)),
          );
          return;
        }

        const [entry] = queue.splice(index, 1);
        if (entry.signal && entry.onAbort) {
          entry.signal.removeEventListener('abort', entry.onAbort);
        }
        this.sentAt.push(now);
        if (entry.priority === 'low') this.lowSentAt.push(now);
        this.chatAvailableAt.set(entry.chatId, now + this.perChatIntervalMs);
        entry.resolve();
      }
    } finally {
      this.draining = false;
    }
  }

  readyAt(entry, now) {
    let readyAt = this.chatAvailableAt.get(entry.chatId) ?? now;
    if (this.sentAt.length >= this.maxPerSecond) {
      readyAt = Math.max(readyAt, this.sentAt[0] + this.rateWindowMs);
    }
    if (entry.priority === 'low' && this.lowSentAt.length >= this.lowPriorityMaxPerSecond) {
      readyAt = Math.max(readyAt, this.lowSentAt[0] + this.rateWindowMs);
    }
    return readyAt;
  }
}

export class TelegramClient {
  constructor({
    token,
    timeoutMs = 15_000,
    fetchImpl = fetch,
    sendScheduler = new TelegramSendScheduler(),
  }) {
    this.baseUrl = `https://api.telegram.org/bot${token}/`;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.sendScheduler = sendScheduler;
  }

  async getMe(signal) {
    return this.call('getMe', {}, signal);
  }

  async deleteWebhook(signal) {
    return this.call('deleteWebhook', { drop_pending_updates: false }, signal);
  }

  async getUpdates({ offset, timeout = 25, signal } = {}) {
    return this.call('getUpdates', {
      ...(offset === undefined ? {} : { offset }),
      timeout,
      limit: 100,
      allowed_updates: ['message'],
    }, signal, (timeout + 5) * 1_000);
  }

  async sendMessage(chatId, text, signal, { priority = 'alert' } = {}) {
    await this.sendScheduler.acquire(chatId, { priority, signal });
    return this.call('sendMessage', {
      chat_id: String(chatId),
      text: String(text).slice(0, 4_096),
      link_preview_options: { is_disabled: true },
    }, signal);
  }

  async call(method, body, signal, timeoutMs = this.timeoutMs) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${method}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: requestSignal,
      });
    } catch (error) {
      if (requestSignal.aborted && !signal?.aborted) {
        throw new DeliveryError(`Telegram ${method} timed out`);
      }
      if (signal?.aborted) {
        throw error;
      }
      throw new DeliveryError(`Telegram ${method} request failed`);
    }

    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new DeliveryError(`Telegram ${method} returned invalid JSON`, { statusCode: response.status });
    }
    if (!response.ok || payload?.ok !== true) {
      const statusCode = Number(payload?.error_code) || response.status;
      const retryAfterSeconds = Number(payload?.parameters?.retry_after);
      throw new DeliveryError(`Telegram ${method} returned error ${statusCode}`, {
        permanent: statusCode === 400 || statusCode === 401 || statusCode === 403,
        // A 401 rejects the bot credential, not the destination chat. Retrying
        // the channel must never revoke every user's otherwise-valid endpoint.
        scope: statusCode === 401 ? 'channel' : 'endpoint',
        retryAfterMs: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : undefined,
        statusCode,
      });
    }
    return payload.result;
  }
}

export class TelegramChannel {
  constructor({ client, publicUrl, isReady = () => true }) {
    this.client = client;
    this.publicUrl = publicUrl;
    this.isReady = isReady;
  }

  async send(delivery, signal) {
    if (!this.isReady()) {
      throw new DeliveryError('Telegram bot identity is not validated yet', { scope: 'channel' });
    }
    const event = delivery.event;
    const icon = event.severity === 'critical' ? '🚨' : event.severity === 'warning' ? '⚠️' : '🛰️';
    const url = new URL(notificationPath(event), this.publicUrl).toString();
    const references = [
      `Slashmon case: ${url}`,
      ...dashtecReferenceLines(event),
      ...etherscanReferenceLines(event),
    ];
    const message = `${icon} ${event.title}\n\n${formatNotificationBody(event)}\n\n` +
      references.join('\n');
    const priority = event.source === 'test' ? 'low' : 'alert';
    const result = await this.client.sendMessage(delivery.destination, message, signal, { priority });
    return { providerMessageId: result?.message_id === undefined ? null : String(result.message_id) };
  }
}

export function notificationPath(event) {
  const params = new URLSearchParams({ view: 'pingme', network: event.network });
  if (event.data?.caseId) params.set('case', event.data.caseId);
  return `?${params.toString()}`;
}

function parseJson(value, label) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new DeliveryError(`${label} is invalid`, { permanent: true });
  }
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return value;
  }
  return undefined;
}
