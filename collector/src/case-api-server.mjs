import http from 'node:http';
import { randomUUID } from 'node:crypto';

import {
  createOpaqueToken,
  hashToken,
  InputError,
  normalizeAddresses,
  normalizeNetwork,
  parsePushSubscription,
  readBearerToken,
  safeHashMatches,
} from './security.mjs';

const API_PREFIX = '/api';

export class CaseApiServer {
  constructor({
    repository,
    host = '127.0.0.1',
    port = 8_790,
    corsOrigin,
    network,
    staleAfterMs = 60_000,
    l1StaleAfterMs = 120_000,
    vapidPublicKey,
    telegramBotUsername,
    isTelegramReady = () => false,
    maxSequencers = 100,
    maxRequestBodyBytes = 64 * 1024,
    rateLimitWindowMs = 60_000,
    rateLimitMaxMutations = 20,
    trustLoopbackProxy = false,
    linkTokenTtlMs = 10 * 60_000,
    logger,
    now = Date.now,
  }) {
    this.repository = repository;
    this.host = host;
    this.port = port;
    this.corsOrigin = corsOrigin;
    this.network = network;
    this.staleAfterMs = staleAfterMs;
    this.l1StaleAfterMs = l1StaleAfterMs;
    this.vapidPublicKey = vapidPublicKey;
    this.telegramBotUsername = telegramBotUsername;
    this.isTelegramReady = isTelegramReady;
    this.maxSequencers = maxSequencers;
    this.maxRequestBodyBytes = maxRequestBodyBytes;
    this.trustLoopbackProxy = trustLoopbackProxy;
    this.linkTokenTtlMs = linkTokenTtlMs;
    this.logger = logger;
    this.now = now;
    this.rateLimiter = new MutationRateLimiter(rateLimitWindowMs, rateLimitMaxMutations);
    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        this.logger?.error?.('API request failed', {
          method: request.method,
          path: request.url,
          error: String(error?.message ?? error),
        });
        this.sendError(response, error);
      });
    });
  }

  listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', onError);
        resolve(this.server.address());
      });
    });
  }

  close() {
    if (!this.server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  async handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://backend.invalid');
    this.setCors(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/live') {
      return this.send(response, 200, { status: 'live' });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const status = this.status();
      return this.send(response, status.status === 'healthy' ? 200 : 503, status);
    }
    if (request.method === 'GET' && url.pathname === `${API_PREFIX}/config`) {
      return this.send(response, 200, {
        network: this.network,
        maxSequencers: this.maxSequencers,
        notifications: {
          webPush: this.vapidPublicKey
            ? { enabled: true, publicKey: this.vapidPublicKey }
            : { enabled: false, publicKey: null },
          telegram: {
            enabled: Boolean(this.telegramBotUsername && this.isTelegramReady()),
            username: this.telegramBotUsername ?? null,
          },
        },
      });
    }
    if (request.method === 'GET' && url.pathname === `${API_PREFIX}/status`) {
      return this.send(response, 200, this.status());
    }
    if (request.method === 'GET' && url.pathname === `${API_PREFIX}/network`) {
      return this.send(response, 200, {
        ...this.repository.getNetworkSummary(this.network),
        sources: this.status().sources,
      });
    }

    const sequencerMatch = /^\/api\/sequencers\/(0x[0-9a-fA-F]{40})$/.exec(
      url.pathname,
    );
    if (request.method === 'GET' && sequencerMatch) {
      return this.send(response, 200, this.repository.getSequencerRecord(
        sequencerMatch[1],
        this.network,
      ));
    }
    const caseMatch = /^\/api\/cases\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && caseMatch) {
      const item = this.repository.getCase(decodeURIComponent(caseMatch[1]));
      if (!item) throw new InputError('case_not_found', 'Slashing case not found', 404);
      return this.send(response, 200, item);
    }

    if (request.method === 'POST' && url.pathname === `${API_PREFIX}/watches`) {
      this.limitMutation(request);
      const body = await this.readBody(request);
      const managementToken = createOpaqueToken();
      const watch = this.repository.createWatch({
        id: randomUUID(),
        managementTokenHash: hashToken(managementToken),
        network: normalizeNetwork(body.network ?? this.network, this.network),
        addresses: normalizeAddresses(body.addresses, this.maxSequencers),
        now: this.now(),
      });
      return this.send(response, 201, {
        watch: publicWatch(watch, this.repository),
        managementToken,
      });
    }

    const watchMatch = /^\/api\/watches\/([0-9a-fA-F-]{36})$/.exec(url.pathname);
    if (watchMatch) {
      const watch = this.authorizeWatch(request, watchMatch[1]);
      if (request.method === 'GET') {
        return this.send(response, 200, publicWatch(watch, this.repository));
      }
      this.limitMutation(request);
      if (request.method === 'PATCH') {
        const body = await this.readBody(request);
        const addresses = body.addresses === undefined
          ? undefined
          : normalizeAddresses(body.addresses, this.maxSequencers);
        const updated = this.repository.updateWatch(watch.id, {
          addresses,
          now: this.now(),
        });
        return this.send(response, 200, publicWatch(updated, this.repository));
      }
      if (request.method === 'DELETE') {
        this.repository.deleteWatch(watch.id);
        response.writeHead(204);
        response.end();
        return;
      }
    }

    const channelMatch =
      /^\/api\/watches\/([0-9a-fA-F-]{36})\/channels\/(web_push)$/.exec(
        url.pathname,
      );
    if (channelMatch) {
      const watch = this.authorizeWatch(request, channelMatch[1]);
      this.limitMutation(request);
      if (request.method === 'PUT') {
        if (!this.vapidPublicKey) {
          throw new InputError(
            'web_push_unavailable',
            'Web Push is not configured',
            503,
          );
        }
        const body = await this.readBody(request);
        const subscription = parsePushSubscription(body.subscription);
        const updated = this.repository.upsertEndpoint({
          watchId: watch.id,
          kind: 'web_push',
          destination: subscription.endpoint,
          configJson: JSON.stringify(subscription),
          now: this.now(),
        });
        return this.send(response, 200, publicWatch(updated, this.repository));
      }
      if (request.method === 'DELETE') {
        this.repository.deleteEndpoint(watch.id, 'web_push');
        response.writeHead(204);
        response.end();
        return;
      }
    }

    const telegramMatch =
      /^\/api\/watches\/([0-9a-fA-F-]{36})\/channels\/telegram-link$/.exec(
        url.pathname,
      );
    if (request.method === 'POST' && telegramMatch) {
      const watch = this.authorizeWatch(request, telegramMatch[1]);
      this.limitMutation(request);
      if (!this.telegramBotUsername || !this.isTelegramReady()) {
        throw new InputError(
          'telegram_unavailable',
          'Telegram notifications are unavailable',
          503,
        );
      }
      const token = createOpaqueToken();
      const expiresAt = this.now() + this.linkTokenTtlMs;
      this.repository.createTelegramLink({
        tokenHash: hashToken(token),
        watchId: watch.id,
        expiresAt,
        now: this.now(),
      });
      return this.send(response, 201, {
        url: `https://t.me/${this.telegramBotUsername}?start=${token}`,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    }

    const testMatch =
      /^\/api\/watches\/([0-9a-fA-F-]{36})\/channels\/test$/.exec(
        url.pathname,
      );
    if (request.method === 'POST' && testMatch) {
      const watch = this.authorizeWatch(request, testMatch[1]);
      this.limitMutation(request);
      const queued = this.repository.enqueueWatchTest(watch.id, this.now());
      if (queued === 0) {
        throw new InputError(
          'no_notification_channel',
          'Connect a notification channel first',
          409,
        );
      }
      return this.send(response, 202, { queued });
    }

    throw new InputError('not_found', 'Route not found', 404);
  }

  authorizeWatch(request, id) {
    const watch = this.repository.getWatch(id);
    if (!watch) throw new InputError('watch_not_found', 'Watch not found', 404);
    const token = readBearerToken(request.headers.authorization);
    if (!safeHashMatches(token, watch.managementTokenHash)) {
      throw new InputError('invalid_management_token', 'Management token is invalid', 401);
    }
    return watch;
  }

  status() {
    const now = this.now();
    const required = [
      ['ethereum_l1', ['l1', 'l1_slash_logs'], this.l1StaleAfterMs],
      ['aztec_node', ['aztec_node'], this.staleAfterMs],
      ['aztec_sentinel', ['aztec_sentinel'], this.staleAfterMs * 2],
    ];
    const sources = required.map(([source, keys, staleAfter]) => {
      const states = keys.map((key) => this.repository.getSourceState(key));
      const successes = states.map((state) => Number(state?.lastSuccessAt ?? 0));
      const leastRecentSuccess = Math.min(...successes);
      const age = leastRecentSuccess === 0 ? null : now - leastRecentSuccess;
      const status = successes.some((at) => at === 0)
        ? 'unavailable'
        : states.some((state) => Number(state?.consecutiveFailures ?? 0) > 0) ||
            age > staleAfter
          ? 'stale'
          : 'healthy';
      const failed = states.find((state) =>
        Number(state?.consecutiveFailures ?? 0) > 0 && state?.lastError);
      return {
        source,
        status,
        lastSuccessAt: leastRecentSuccess
          ? new Date(leastRecentSuccess).toISOString()
          : null,
        lastError: failed?.lastError ?? null,
      };
    });
    const protocol = this.repository.getProtocolSnapshot();
    const overall = !protocol
      ? 'starting'
      : sources.every((item) => item.status === 'healthy')
        ? 'healthy'
        : 'degraded';
    return {
      status: overall,
      network: this.network,
      observedAt: new Date(now).toISOString(),
      protocol,
      sources,
    };
  }

  limitMutation(request) {
    const key = clientAddress(request, this.trustLoopbackProxy);
    const retryAfterMs = this.rateLimiter.take(key, this.now());
    if (retryAfterMs > 0) {
      const error = new InputError(
        'rate_limited',
        'Too many changes; try again shortly',
        429,
      );
      error.retryAfterMs = retryAfterMs;
      throw error;
    }
  }

  async readBody(request) {
    const contentType = String(request.headers['content-type'] ?? '').split(';')[0];
    if (contentType !== 'application/json') {
      throw new InputError('invalid_content_type', 'Use application/json', 415);
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > this.maxRequestBodyBytes) {
        throw new InputError('body_too_large', 'Request body is too large', 413);
      }
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      throw new InputError('invalid_json', 'Request body must be a JSON object');
    }
  }

  setCors(response) {
    response.setHeader('access-control-allow-origin', this.corsOrigin);
    response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    response.setHeader('access-control-allow-headers', 'authorization,content-type');
    response.setHeader('vary', 'Origin');
  }

  send(response, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  }

  sendError(response, error) {
    const status = Number(error?.status);
    const safeStatus = Number.isInteger(status) && status >= 400 && status < 600
      ? status
      : 500;
    if (error?.retryAfterMs) {
      response.setHeader('retry-after', String(Math.ceil(error.retryAfterMs / 1_000)));
    }
    this.send(response, safeStatus, {
      error: {
        code: error?.code ?? 'internal_error',
        message: safeStatus === 500
          ? 'The slashveto.me backend could not complete this request'
          : String(error.message),
      },
    });
  }
}

function publicWatch(watch, repository) {
  const cases = repository.listCases({
    network: watch.network,
    sequencers: watch.addresses,
  });
  return {
    id: watch.id,
    network: watch.network,
    addresses: watch.addresses,
    endpoints: watch.endpoints,
    createdAt: new Date(Number(watch.createdAt)).toISOString(),
    updatedAt: new Date(Number(watch.updatedAt)).toISOString(),
    cases,
  };
}

class MutationRateLimiter {
  constructor(windowMs, max) {
    this.windowMs = windowMs;
    this.max = max;
    this.entries = new Map();
  }

  take(key, now) {
    const recent = (this.entries.get(key) ?? []).filter(
      (timestamp) => timestamp > now - this.windowMs,
    );
    if (recent.length >= this.max) {
      return recent[0] + this.windowMs - now;
    }
    recent.push(now);
    this.entries.set(key, recent);
    if (this.entries.size > 10_000) {
      for (const [candidate, timestamps] of this.entries) {
        if (timestamps.every((timestamp) => timestamp <= now - this.windowMs)) {
          this.entries.delete(candidate);
        }
      }
    }
    return 0;
  }
}

function clientAddress(request, trustLoopbackProxy) {
  const remote = request.socket.remoteAddress ?? 'unknown';
  if (!trustLoopbackProxy || !isLoopback(remote)) return remote;
  const cloudflare = request.headers['cf-connecting-ip'];
  if (typeof cloudflare === 'string' && cloudflare.length < 128) return cloudflare;
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',').map((item) => item.trim()).filter(Boolean).at(-1) ?? remote;
  }
  return remote;
}

function isLoopback(value) {
  return value === '::1' || value === '127.0.0.1' || value === '::ffff:127.0.0.1';
}
