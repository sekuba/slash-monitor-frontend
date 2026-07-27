import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import { NotificationRateLimitError } from './database.mjs';
import { errorMessage } from './logger.mjs';
import {
  InputError,
  createOpaqueToken,
  hashToken,
  normalizeAddresses,
  normalizeNetwork,
  parsePushSubscription,
  readBearerToken,
  safeHashMatches,
} from './security.mjs';

const WATCHLIST_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_SEQUENCER_FILTERS = 100;
const PUBLIC_EVENT_SOURCES = ['aztec_node', 'aztec_sentinel', 'ethereum_l1'];

export class CollectorApiServer {
  constructor({
    repository,
    host,
    port,
    corsOrigin,
    staleAfterMs,
    l1StaleAfterMs = staleAfterMs,
    network = 'mainnet',
    vapidPublicKey,
    telegramBotUsername,
    isTelegramReady,
    maxSequencers = 100,
    maxRequestBodyBytes = 64 * 1024,
    rateLimitWindowMs = 60_000,
    rateLimitMaxMutations = 20,
    readRateLimitWindowMs = 60_000,
    readRateLimitMax = 180,
    readRateLimitMaxGlobal = 600,
    watchlistMutationRateLimitWindowMs = 60_000,
    watchlistMutationRateLimitMax = 20,
    subscriptionCreateWindowMs = 60 * 60_000,
    subscriptionCreateMaxPerClient = 3,
    subscriptionCreateDailyWindowMs = 24 * 60 * 60_000,
    subscriptionCreateMaxPerDayPerClient = 10,
    subscriptionCreateMaxPerHourGlobal = 10,
    subscriptionCreateMaxPerDayGlobal = 50,
    notificationTestCooldownMs = 5 * 60_000,
    notificationTestMaxPerHourGlobal = 30,
    notificationTestMaxPerDayGlobal = 100,
    webPushEnrollmentMaxPerHourPerWatchlist = 3,
    webPushEnrollmentMaxPerDayPerWatchlist = 10,
    webPushEnrollmentMaxPerHourGlobal = 20,
    webPushEnrollmentMaxPerDayGlobal = 100,
    requestTimeoutMs = 10_000,
    headersTimeoutMs = 5_000,
    keepAliveTimeoutMs = 5_000,
    shutdownTimeoutMs = 10_000,
    trustLoopbackProxy = false,
    linkTokenTtlMs = 10 * 60_000,
    logger,
    now = Date.now,
  }) {
    this.repository = repository;
    this.host = host;
    this.port = port;
    this.corsOrigin = corsOrigin;
    this.staleAfterMs = staleAfterMs;
    this.l1StaleAfterMs = l1StaleAfterMs;
    this.network = network;
    this.vapidPublicKey = vapidPublicKey ?? null;
    this.telegramBotUsername = telegramBotUsername ?? null;
    this.isTelegramReady = isTelegramReady ?? (() => Boolean(this.telegramBotUsername));
    this.maxSequencers = maxSequencers;
    this.maxRequestBodyBytes = maxRequestBodyBytes;
    this.rateLimiter = new MutationRateLimiter(rateLimitWindowMs, rateLimitMaxMutations, now);
    this.readRateLimiter = new MutationRateLimiter(readRateLimitWindowMs, readRateLimitMax, now);
    this.globalReadRateLimiter = new MutationRateLimiter(readRateLimitWindowMs, readRateLimitMaxGlobal, now);
    this.watchlistMutationRateLimiter = new MutationRateLimiter(
      watchlistMutationRateLimitWindowMs,
      watchlistMutationRateLimitMax,
      now,
    );
    this.subscriptionCreateRateLimiter = new MutationRateLimiter(
      subscriptionCreateWindowMs,
      subscriptionCreateMaxPerClient,
      now,
    );
    this.subscriptionCreateDailyRateLimiter = new MutationRateLimiter(
      subscriptionCreateDailyWindowMs,
      subscriptionCreateMaxPerDayPerClient,
      now,
    );
    this.subscriptionAdmissionLimits = {
      maxPerHourGlobal: subscriptionCreateMaxPerHourGlobal,
      maxPerDayGlobal: subscriptionCreateMaxPerDayGlobal,
    };
    this.notificationTestCooldownMs = notificationTestCooldownMs;
    this.notificationTestAdmissionLimits = {
      maxPerHourGlobal: notificationTestMaxPerHourGlobal,
      maxPerDayGlobal: notificationTestMaxPerDayGlobal,
    };
    this.webPushEnrollmentAdmissionLimits = {
      maxPerHourPerWatchlist: webPushEnrollmentMaxPerHourPerWatchlist,
      maxPerDayPerWatchlist: webPushEnrollmentMaxPerDayPerWatchlist,
      maxPerHourGlobal: webPushEnrollmentMaxPerHourGlobal,
      maxPerDayGlobal: webPushEnrollmentMaxPerDayGlobal,
    };
    this.trustLoopbackProxy = trustLoopbackProxy;
    this.linkTokenTtlMs = linkTokenTtlMs;
    this.logger = logger;
    this.now = now;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.statusCache = null;
    this.server = http.createServer((request, response) => void this.handle(request, response));
    this.server.requestTimeout = requestTimeoutMs;
    this.server.headersTimeout = headersTimeoutMs;
    this.server.keepAliveTimeout = keepAliveTimeoutMs;
  }

  listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', onError);
        const address = this.server.address();
        this.logger.info('Slashmon API listening', { address });
        resolve(address);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (!this.server.listening) return resolve();
      const forceClose = setTimeout(() => this.server.closeAllConnections(), this.shutdownTimeoutMs);
      this.server.close((error) => {
        clearTimeout(forceClose);
        if (error) reject(error);
        else resolve();
      });
      this.server.closeIdleConnections();
    });
  }

  async handle(request, response) {
    setCommonHeaders(response, request, this.corsOrigin);
    try {
      this.assertAllowedOrigin(request);
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://slashmon.local');
      const method = request.method ?? 'GET';
      const clientKey = mutationClientKey(request, this.trustLoopbackProxy);
      if (method !== 'GET' && method !== 'HEAD') {
        this.rateLimiter.take(clientKey);
      } else if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
        this.readRateLimiter.take(
          clientKey,
          'read_rate_limited',
          'Too many API reads; try again shortly',
        );
        this.globalReadRateLimiter.take(
          'global',
          'read_capacity_limited',
          'The public read budget is busy; try again shortly',
        );
      }

      if (method === 'GET' && url.pathname === '/live') {
        return writeJson(response, 200, { status: 'ok', now: toIso(this.now()) });
      }
      if (method === 'GET' && url.pathname === '/health') {
        const health = this.buildHealth();
        return writeJson(response, health.httpStatus, health.body);
      }

      if (url.pathname.startsWith('/api/v2/')) {
        return await this.handleV2(method, url, request, response);
      }
      throw new HttpError(404, 'not_found', 'Route not found');
    } catch (error) {
      if (error instanceof NotificationRateLimitError) {
        response.setHeader('retry-after', String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))));
        return writeJson(response, 429, {
          error: { code: error.code, message: error.message },
          retryAfterMs: error.retryAfterMs,
        });
      }
      if (error instanceof HttpError || error instanceof InputError) {
        if (error.status === 429 && error.retryAfterMs) {
          response.setHeader('retry-after', String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))));
        }
        return writeJson(response, error.status, { error: { code: error.code, message: error.message } });
      }
      this.logger.error('Slashmon API request failed', {
        method: request.method,
        error: errorMessage(error),
      });
      return writeJson(response, 500, { error: { code: 'internal_error', message: 'Internal server error' } });
    }
  }

  async handleV2(method, url, request, response) {
    if (method === 'GET' && url.pathname === '/api/v2/config') {
      const readyTelegramUsername = this.readyTelegramUsername();
      return writeJson(response, 200, {
        schemaVersion: 2,
        network: this.network,
        vapidPublicKey: this.vapidPublicKey,
        telegramBotUsername: readyTelegramUsername,
        maxSequencers: this.maxSequencers,
      });
    }
    if (method === 'GET' && url.pathname === '/api/v2/status') {
      normalizeNetwork(url.searchParams.get('network') ?? this.network, this.network);
      return writeJson(response, 200, this.buildPublicStatus());
    }
    if (method === 'GET' && url.pathname === '/api/v2/events') {
      const query = parseEventQuery(url.searchParams, this.network);
      const page = this.repository.listEvents({
        ...query,
        sources: PUBLIC_EVENT_SOURCES,
      });
      return writeJson(response, 200, {
        schemaVersion: 2,
        data: page.data,
        pagination: { nextCursor: page.nextCursor ?? null },
        generatedAt: toIso(this.now()),
      });
    }
    const sequencerRecordMatch = /^\/api\/v2\/sequencers\/([^/]+)\/record$/.exec(url.pathname);
    if (method === 'GET' && sequencerRecordMatch) {
      let rawSequencer;
      try {
        rawSequencer = decodeURIComponent(sequencerRecordMatch[1]);
      } catch {
        throw new HttpError(400, 'invalid_address', 'Sequencer address is malformed');
      }
      const [sequencer] = normalizeAddresses([rawSequencer], 1);
      const query = parseEventQuery(url.searchParams, this.network);
      const page = this.repository.listEvents({
        ...query,
        addresses: [sequencer],
        sources: PUBLIC_EVENT_SOURCES,
      });
      return writeJson(response, 200, {
        schemaVersion: 2,
        data: {
          sequencer,
          protocol: this.repository.getSlashingProtocolSnapshot() ?? null,
          events: page.data,
        },
        pagination: { nextCursor: page.nextCursor ?? null },
        generatedAt: toIso(this.now()),
      });
    }
    if (method === 'GET' && url.pathname.startsWith('/api/v2/events/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/v2/events/'.length));
      if (!/^[A-Za-z0-9:_-]{1,200}$/.test(id)) {
        throw new HttpError(400, 'invalid_event_id', 'Event id is malformed');
      }
      const network = normalizeNetwork(url.searchParams.get('network') ?? this.network, this.network);
      const event = this.repository.getEvent(id);
      if (!event || event.network !== network || !PUBLIC_EVENT_SOURCES.includes(event.source)) {
        throw new HttpError(404, 'event_not_found', 'Event not found');
      }
      return writeJson(response, 200, {
        schemaVersion: 2,
        data: event,
        generatedAt: toIso(this.now()),
      });
    }
    if (method === 'POST' && url.pathname === '/api/v2/subscriptions') {
      const clientKey = mutationClientKey(request, this.trustLoopbackProxy);
      this.subscriptionCreateRateLimiter.take(
        clientKey,
        'subscription_rate_limited',
        'Too many watch lists created from this client; try again later',
      );
      this.subscriptionCreateDailyRateLimiter.take(
        clientKey,
        'subscription_daily_rate_limited',
        'The daily watch-list creation limit for this client was reached',
      );
      const body = await readJsonBody(request, this.maxRequestBodyBytes);
      assertBodyFields(body, ['network', 'addresses']);
      const network = normalizeNetwork(body.network ?? this.network, this.network);
      const addresses = normalizeAddresses(body.addresses, this.maxSequencers);
      const managementToken = createOpaqueToken();
      const watchlist = this.repository.createWatchlist({
        id: randomUUID(),
        managementTokenHash: hashToken(managementToken),
        network,
        addresses,
        now: this.now(),
        admissionLimits: this.subscriptionAdmissionLimits,
      });
      if (!watchlist) {
        throw new HttpError(503, 'subscription_capacity', 'Too many unconnected watch lists; try again later');
      }
      return writeJson(response, 201, {
        schemaVersion: 2,
        data: { ...toPublicWatchlist(watchlist), managementToken },
      });
    }

    const match = /^\/api\/v2\/subscriptions\/([^/]+)(.*)$/.exec(url.pathname);
    if (!match) throw new HttpError(404, 'not_found', 'Route not found');
    const id = decodeURIComponent(match[1]);
    if (!WATCHLIST_ID_PATTERN.test(id)) throw new HttpError(404, 'subscription_not_found', 'Subscription not found');
    const watchlist = this.authorizeWatchlist(id, request);
    const suffix = match[2];
    if (method !== 'GET' && method !== 'HEAD') {
      this.watchlistMutationRateLimiter.take(
        id,
        'subscription_mutation_rate_limited',
        'Too many changes were requested for this watch list; try again shortly',
      );
    }

    if (suffix === '' && method === 'GET') {
      return writeJson(response, 200, { schemaVersion: 2, data: toPublicWatchlist(watchlist) });
    }
    if (suffix === '/events' && method === 'GET') {
      const query = parseEventQuery(url.searchParams, watchlist.network);
      const page = this.repository.listEvents({ ...query, addresses: watchlist.addresses });
      return writeJson(response, 200, {
        schemaVersion: 2,
        data: page.data,
        pagination: { nextCursor: page.nextCursor ?? null },
        generatedAt: toIso(this.now()),
      });
    }
    const eventMatch = /^\/events\/([^/]+)$/.exec(suffix);
    if (eventMatch && method === 'GET') {
      const eventId = decodeURIComponent(eventMatch[1]);
      if (!/^[A-Za-z0-9:_-]{1,200}$/.test(eventId)) {
        throw new HttpError(400, 'invalid_event_id', 'Event id is malformed');
      }
      const network = normalizeNetwork(url.searchParams.get('network') ?? watchlist.network, watchlist.network);
      const event = this.repository.getEvent(eventId);
      const matchesWatchlist = event?.targets.some((target) => watchlist.addresses.includes(target));
      if (!event || event.network !== network || event.source === 'test' || !matchesWatchlist) {
        throw new HttpError(404, 'event_not_found', 'Event not found');
      }
      return writeJson(response, 200, {
        schemaVersion: 2,
        data: event,
        generatedAt: toIso(this.now()),
      });
    }
    if (suffix === '' && method === 'PATCH') {
      const body = await readJsonBody(request, this.maxRequestBodyBytes);
      assertBodyFields(body, ['addresses']);
      if (!Object.hasOwn(body, 'addresses')) {
        throw new HttpError(400, 'empty_patch', 'PATCH must include addresses');
      }
      const addresses = normalizeAddresses(body.addresses, this.maxSequencers);
      const updated = this.repository.updateWatchlist(id, {
        addresses,
        now: this.now(),
      });
      return writeJson(response, 200, { schemaVersion: 2, data: toPublicWatchlist(updated) });
    }
    if (suffix === '' && method === 'DELETE') {
      this.repository.deleteWatchlist(id, this.now());
      response.writeHead(204);
      response.end();
      return;
    }
    if (suffix === '/channels/web-push' && method === 'PUT') {
      if (!this.vapidPublicKey) throw new HttpError(503, 'web_push_unavailable', 'Web Push is not configured');
      const body = await readJsonBody(request, this.maxRequestBodyBytes);
      assertBodyFields(body, ['subscription']);
      const subscription = parsePushSubscription(body.subscription);
      const result = this.repository.upsertEndpoint({
        watchlistId: id,
        kind: 'web_push',
        destination: subscription.endpoint,
        configJson: JSON.stringify(subscription),
        now: this.now(),
        admissionLimits: this.webPushEnrollmentAdmissionLimits,
      });
      if (result?.conflict) {
        throw new HttpError(
          409,
          'push_endpoint_in_use',
          'This browser push endpoint belongs to another watch list; reconnect it to create a fresh endpoint',
        );
      }
      if (result?.capacity) {
        throw new HttpError(503, 'channel_capacity', 'Notification endpoint capacity is temporarily full');
      }
      return writeJson(response, 200, {
        schemaVersion: 2,
        data: {
          connected: true,
          enabled: true,
          verified: result?.verified === true,
          verificationQueued: result?.verificationQueued ?? 0,
          catchupQueued: result?.catchupQueued ?? 0,
        },
      });
    }
    if (suffix === '/channels/web-push' && method === 'DELETE') {
      this.repository.removeEndpoint(id, 'web_push', this.now());
      response.writeHead(204);
      response.end();
      return;
    }
    if (suffix === '/channels/telegram-link' && method === 'POST') {
      const readyTelegramUsername = this.readyTelegramUsername();
      if (!readyTelegramUsername) {
        throw new HttpError(503, 'telegram_unavailable', 'Telegram is not ready');
      }
      const token = createOpaqueToken(24);
      const expiresAt = this.now() + this.linkTokenTtlMs;
      this.repository.createTelegramLink({
        tokenHash: hashToken(token),
        watchlistId: id,
        expiresAt,
        now: this.now(),
      });
      return writeJson(response, 201, {
        schemaVersion: 2,
        url: `https://t.me/${readyTelegramUsername}?start=${token}`,
        expiresAt: toIso(expiresAt),
      });
    }
    if (suffix === '/test' && method === 'POST') {
      const now = this.now();
      const queued = this.repository.enqueueWatchlistTest(id, {
        id: `test-${randomUUID()}`,
        network: watchlist.network,
        source: 'test',
        type: 'notification_test',
        severity: 'info',
        title: 'Slashmon test signal',
        body: 'The wire is live. Real alerts will name the offense and affected sequencer.',
        data: {},
        observedAt: now,
      }, now, {
        cooldownMs: this.notificationTestCooldownMs,
        admissionLimits: this.notificationTestAdmissionLimits,
      });
      if (!queued) {
        throw new HttpError(409, 'no_active_channels', 'No active notification channel is connected');
      }
      return writeJson(response, 202, { schemaVersion: 2, queued: Number(queued ?? 0) });
    }
    throw new HttpError(405, 'method_not_allowed', 'Method is not allowed for this route');
  }

  authorizeWatchlist(id, request) {
    const watchlist = this.repository.getWatchlist(id);
    if (!watchlist) throw new HttpError(404, 'subscription_not_found', 'Subscription not found');
    const token = readBearerToken(request.headers.authorization);
    if (!safeHashMatches(token, watchlist.managementTokenHash)) {
      throw new HttpError(401, 'invalid_management_token', 'Management token is invalid');
    }
    return watchlist;
  }

  readyTelegramUsername() {
    return this.telegramBotUsername && this.isTelegramReady() ? this.telegramBotUsername : null;
  }

  assertAllowedOrigin(request) {
    const origin = request.headers.origin;
    if (origin && origin !== this.corsOrigin && request.method !== 'GET' && request.method !== 'HEAD') {
      throw new HttpError(403, 'origin_not_allowed', 'Request origin is not allowed');
    }
  }

  buildBaseStatus() {
    const now = this.now();
    const aztecOffenses = sourceHealthFromOffenseSync(
      this.repository.getSyncState(),
      this.staleAfterMs,
      now,
    );
    const aztecSentinelState = this.repository.getSourceState('aztec_sentinel');
    const aztecSentinel = sourceHealth(
      aztecSentinelState,
      Math.max(this.staleAfterMs, 3 * 60_000),
      now,
    );
    const aztec = aztecSentinelState
      ? combineSourceHealth([aztecOffenses, aztecSentinel])
      : aztecOffenses;
    const l1SnapshotState = this.repository.getSourceState('l1');
    const l1SlashLogState = this.repository.getSourceState('l1_slash_logs');
    const l1 = l1SlashLogState
      ? combineSourceHealth([
        sourceHealth(l1SnapshotState, this.l1StaleAfterMs, now),
        sourceHealth(l1SlashLogState, this.l1StaleAfterMs, now),
      ])
      : sourceHealth(l1SnapshotState, this.l1StaleAfterMs, now);
    const telegram = this.telegramBotUsername
      ? sourceHealth(this.repository.getSourceState('telegram'), Math.max(120_000, this.staleAfterMs), now)
      : { status: 'disabled', enabled: false };
    const webPush = this.vapidPublicKey
      ? deliveryChannelHealth(this.repository.getSourceState('web_push'))
      : { status: 'disabled', enabled: false };
    const deliveryQueue = publicDeliveryHealth(this.repository.getDeliveryHealthStatus({ now }));
    const critical = [aztec.status, l1.status];
    const sourceStatus = critical.every((value) => value === 'healthy')
      ? 'healthy'
      : critical.some((value) => value === 'unavailable' || value === 'stale')
        ? 'stale'
        : 'degraded';
    const notificationDegraded = deliveryQueue.status === 'degraded' || (
      telegram.enabled !== false && telegram.status !== 'healthy'
    ) || webPush.status === 'degraded';
    const delivery = {
      ...deliveryQueue,
      status: notificationDegraded ? 'degraded' : 'healthy',
    };
    const status = sourceStatus === 'healthy' && notificationDegraded
      ? 'degraded'
      : sourceStatus;
    return {
      schemaVersion: 2,
      status,
      generatedAt: toIso(now),
      network: this.network,
      sources: { l1, aztec, aztecOffenses, aztecSentinel, telegram, webPush },
      delivery,
    };
  }

  buildPublicStatus() {
    const status = this.buildStatus();
    return {
      schemaVersion: status.schemaVersion,
      status: status.status,
      generatedAt: status.generatedAt,
      network: status.network,
      sources: {
        l1: { status: status.sources.l1.status },
        aztec: { status: status.sources.aztec.status },
      },
      delivery: { status: status.delivery.status },
    };
  }

  buildStatus() {
    const now = this.now();
    if (this.statusCache && this.statusCache.expiresAt > now) {
      return this.statusCache.value;
    }
    const value = this.buildBaseStatus();
    this.statusCache = { value, expiresAt: now + 1_000 };
    return value;
  }

  buildHealth() {
    const status = this.buildStatus();
    return {
      httpStatus: status.status === 'stale' ? 503 : 200,
      body: {
        status: status.status,
        sources: status.sources,
        delivery: status.delivery,
        now: status.generatedAt,
      },
    };
  }

}

function parseEventQuery(searchParams, expectedNetwork) {
  const network = normalizeNetwork(searchParams.get('network') ?? expectedNetwork, expectedNetwork);
  const addresses = searchParams.getAll('address')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const cursor = searchParams.get('cursor');
  if (cursor && (cursor.length > 200 || !/^[A-Za-z0-9_.:-]+$/.test(cursor))) {
    throw new HttpError(400, 'invalid_cursor', 'cursor is malformed');
  }
  return {
    network,
    addresses: addresses.length > 0 ? normalizeAddresses(addresses, MAX_SEQUENCER_FILTERS) : [],
    cursor: cursor ?? undefined,
    limit: parseQueryInteger(searchParams.get('limit'), 'limit', 50, 1, 100),
  };
}

function parseQueryInteger(raw, name, defaultValue, min, max) {
  if (raw === null) return defaultValue;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, `invalid_${name}`, `${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

async function readJsonBody(request, maxBytes) {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'request_too_large', `Request body exceeds ${maxBytes} bytes`);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new HttpError(413, 'request_too_large', `Request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object');
  }
  return body;
}

function assertBodyFields(body, allowed) {
  const unexpected = Object.keys(body).find((field) => !allowed.includes(field));
  if (unexpected) {
    throw new HttpError(400, 'unknown_field', `Unknown request field: ${unexpected}`);
  }
}

function setCommonHeaders(response, request, corsOrigin) {
  if (request.headers.origin === corsOrigin) {
    response.setHeader('access-control-allow-origin', corsOrigin);
    response.setHeader('vary', 'Origin');
  }
  response.setHeader('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  response.setHeader('access-control-max-age', '600');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
}

function writeJson(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
  });
  response.end(encoded);
}

function sourceHealthFromOffenseSync(state, staleAfterMs, now) {
  return sourceHealth({
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    consecutiveFailures: state.consecutiveFailures,
    successfulPolls: state.successfulPolls,
    lastError: state.lastError,
  }, staleAfterMs, now);
}

function sourceHealth(state, staleAfterMs, now) {
  if (!state || state.lastSuccessAt === null || state.lastSuccessAt === undefined) {
    return {
      status: 'unavailable',
      upstreamReachable: false,
      dataFresh: false,
      dataAgeMs: null,
      lastAttemptAt: toIso(state?.lastAttemptAt),
      lastSuccessAt: null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      successfulPolls: state?.successfulPolls ?? 0,
      errorClass: state?.lastError ? 'upstream_error' : null,
    };
  }
  const age = Math.max(0, now - Number(state.lastSuccessAt));
  const fresh = age <= staleAfterMs;
  const reachable = Number(state.consecutiveFailures ?? 0) === 0;
  const partial = Boolean(state.metadata?.degraded);
  return {
    status: !fresh ? 'stale' : !reachable || partial ? 'degraded' : 'healthy',
    upstreamReachable: reachable,
    dataFresh: fresh,
    dataAgeMs: age,
    lastAttemptAt: toIso(state.lastAttemptAt),
    lastSuccessAt: toIso(state.lastSuccessAt),
    consecutiveFailures: Number(state.consecutiveFailures ?? 0),
    successfulPolls: Number(state.successfulPolls ?? 0),
    errorClass: state.lastError ? 'upstream_error' : null,
    blockNumber: state.lastBlockNumber ?? null,
    blockHash: state.lastBlockHash ?? null,
  };
}

function deliveryChannelHealth(state) {
  if (!state || Number(state.consecutiveFailures ?? 0) === 0) {
    return { status: 'healthy', enabled: true };
  }
  return {
    status: 'degraded',
    enabled: true,
    errorClass: 'upstream_error',
    consecutiveFailures: Number(state.consecutiveFailures),
    lastAttemptAt: toIso(state.lastAttemptAt),
    lastSuccessAt: toIso(state.lastSuccessAt),
  };
}

function combineSourceHealth(sources) {
  const rank = { healthy: 0, degraded: 1, stale: 2, unavailable: 3 };
  const worst = sources.reduce((left, right) =>
    rank[right.status] > rank[left.status] ? right : left
  );
  const attempts = sources.map((source) => source.lastAttemptAt).filter(Boolean).sort();
  const successes = sources.map((source) => source.lastSuccessAt).filter(Boolean).sort();
  return {
    ...worst,
    status: worst.status,
    upstreamReachable: sources.every((source) => source.upstreamReachable),
    dataFresh: sources.every((source) => source.dataFresh),
    dataAgeMs: sources.some((source) => source.dataAgeMs === null)
      ? null
      : Math.max(...sources.map((source) => source.dataAgeMs)),
    lastAttemptAt: attempts.at(-1) ?? null,
    lastSuccessAt: successes.length === sources.length ? successes[0] : null,
    consecutiveFailures: sources.reduce((sum, source) => sum + source.consecutiveFailures, 0),
    successfulPolls: Math.min(...sources.map((source) => source.successfulPolls)),
    errorClass: sources.some((source) => source.errorClass) ? 'upstream_error' : null,
  };
}

function publicDeliveryHealth(health) {
  // Exact global queue counts/timestamps can reveal the cadence and volume of
  // capability-scoped pending alerts. Public callers only need to know whether
  // notification coverage is healthy; operators can inspect SQLite/journald.
  return { status: health.status === 'degraded' ? 'degraded' : 'healthy' };
}

function toPublicWatchlist(watchlist) {
  const endpoints = watchlist.endpoints;
  return {
    id: watchlist.id,
    network: watchlist.network,
    addresses: watchlist.addresses,
    channels: {
      webPush: channelSummary(endpoints, 'web_push'),
      telegram: channelSummary(endpoints, 'telegram'),
    },
  };
}

function channelSummary(endpoints, kind) {
  const matching = endpoints.filter((item) => item.kind === kind);
  return {
    connected: matching.length > 0,
    enabled: matching.some((endpoint) => endpoint.enabled !== false),
    verified: matching.some((endpoint) => endpoint.enabled !== false && endpoint.verified === true),
  };
}

function toIso(value) {
  return value === null || value === undefined ? null : new Date(Number(value)).toISOString();
}

class HttpError extends Error {
  constructor(status, code, message, retryAfterMs) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

class MutationRateLimiter {
  constructor(windowMs, max, now, maxBuckets = 10_000) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.maxBuckets = maxBuckets;
    this.buckets = new Map();
  }

  take(key, code = 'rate_limited', message = 'Too many mutation requests; try again shortly') {
    const now = this.now();
    const bucket = this.getBucket(key, now);
    bucket.count += 1;
    if (bucket.count > this.max) throw new HttpError(429, code, message, bucket.resetAt - now);
  }

  check(key, code = 'rate_limited', message = 'Too many requests; try again shortly') {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now && bucket.count >= this.max) {
      throw new HttpError(429, code, message, bucket.resetAt - now);
    }
  }

  getBucket(key, now) {
    let bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now) return bucket;
    if (!bucket && this.buckets.size >= this.maxBuckets) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
      while (this.buckets.size >= this.maxBuckets) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey === undefined) break;
        this.buckets.delete(oldestKey);
      }
    }
    bucket = { count: 0, resetAt: now + this.windowMs };
    this.buckets.set(key, bucket);
    return bucket;
  }
}

function mutationClientKey(request, trustLoopbackProxy) {
  const remote = request.socket.remoteAddress ?? 'unknown';
  if (!trustLoopbackProxy || !isLoopback(remote)) return remote;

  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string' && isIP(realIp.trim())) return realIp.trim();

  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    // For the documented single local reverse proxy, the rightmost address is
    // the socket peer it observed and cannot be supplied past that proxy hop.
    const candidates = forwarded.split(',').map((value) => value.trim()).filter(Boolean);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      if (isIP(candidates[index])) return candidates[index];
    }
  }
  return remote;
}

function isLoopback(address) {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}
