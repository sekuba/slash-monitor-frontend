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
  parsePushSubscription,
  readBearerToken,
  safeHashMatches,
} from './security.mjs';

const WATCHLIST_ID_PATTERN = /^[0-9a-f-]{36}$/i;

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
    maxWatchlistAddresses = 100,
    maxRequestBodyBytes = 64 * 1024,
    rateLimitWindowMs = 60_000,
    rateLimitMaxMutations = 20,
    readRateLimitWindowMs = 60_000,
    readRateLimitMax = 180,
    readRateLimitMaxGlobal = 600,
    watchlistMutationRateLimitWindowMs = 60_000,
    watchlistMutationRateLimitMax = 20,
    watchlistCreateWindowMs = 60 * 60_000,
    watchlistCreateMaxPerClient = 3,
    watchlistCreateDailyWindowMs = 24 * 60 * 60_000,
    watchlistCreateMaxPerDayPerClient = 10,
    watchlistCreateMaxPerHourGlobal = 10,
    watchlistCreateMaxPerDayGlobal = 50,
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
    this.maxWatchlistAddresses = maxWatchlistAddresses;
    this.maxRequestBodyBytes = maxRequestBodyBytes;
    this.rateLimiter = new RateLimiter(rateLimitWindowMs, rateLimitMaxMutations, now);
    this.readRateLimiter = new RateLimiter(readRateLimitWindowMs, readRateLimitMax, now);
    this.globalReadRateLimiter = new RateLimiter(readRateLimitWindowMs, readRateLimitMaxGlobal, now);
    this.watchlistMutationRateLimiter = new RateLimiter(
      watchlistMutationRateLimitWindowMs,
      watchlistMutationRateLimitMax,
      now,
    );
    this.watchlistCreateRateLimiter = new RateLimiter(
      watchlistCreateWindowMs,
      watchlistCreateMaxPerClient,
      now,
    );
    this.watchlistCreateDailyRateLimiter = new RateLimiter(
      watchlistCreateDailyWindowMs,
      watchlistCreateMaxPerDayPerClient,
      now,
    );
    this.watchlistAdmissionLimits = {
      maxPerHourGlobal: watchlistCreateMaxPerHourGlobal,
      maxPerDayGlobal: watchlistCreateMaxPerDayGlobal,
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
      const url = new URL(request.url ?? '/', 'http://slashmon.local');
      if (request.method === 'OPTIONS') {
        if (!url.pathname.startsWith('/api/')) {
          throw new HttpError(404, 'not_found', 'Route not found');
        }
        response.writeHead(204);
        response.end();
        return;
      }

      const method = request.method ?? 'GET';
      const clientKey = clientAddress(request, this.trustLoopbackProxy);
      if (url.pathname.startsWith('/api/')) {
        if (method === 'GET' || method === 'HEAD') {
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
        } else {
          this.rateLimiter.take(clientKey);
        }
      }

      return await this.handleApi(method, url, request, response, clientKey);
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
        return writeJson(response, error.status, {
          error: { code: error.code, message: error.message },
        });
      }
      this.logger.error('Slashmon API request failed', {
        method: request.method,
        path: request.url,
        error: errorMessage(error),
      });
      return writeJson(response, 500, {
        error: { code: 'internal_error', message: 'Internal server error' },
      });
    }
  }

  async handleApi(method, url, request, response, clientKey) {
    if (!url.pathname.startsWith('/api/')) {
      throw new HttpError(404, 'not_found', 'Route not found');
    }

    if (method === 'GET' && url.pathname === '/api/config') {
      assertNoQuery(url);
      const telegramBotUsername = this.readyTelegramUsername();
      return writeJson(response, 200, {
        network: this.network,
        maxWatchlistAddresses: this.maxWatchlistAddresses,
        channels: {
          webPush: {
            available: Boolean(this.vapidPublicKey),
            publicKey: this.vapidPublicKey,
          },
          telegram: {
            available: Boolean(telegramBotUsername),
            botUsername: telegramBotUsername,
          },
        },
      });
    }
    if (method === 'GET' && url.pathname === '/api/status') {
      assertNoQuery(url);
      return writeJson(response, 200, this.buildStatus());
    }
    if (method === 'GET' && url.pathname === '/api/monitor') {
      assertNoQuery(url);
      return writeJson(response, 200, this.repository.getMonitorSnapshot(this.network));
    }

    const validatorMatch = /^\/api\/validators\/([^/]+)$/.exec(url.pathname);
    if (validatorMatch) {
      if (method !== 'GET') {
        throw new HttpError(405, 'method_not_allowed', 'Method is not allowed for this route');
      }
      assertNoQuery(url);
      const address = decodePathSegment(validatorMatch[1], 'invalid_address');
      const [normalized] = normalizeAddresses([address], 1);
      return writeJson(
        response,
        200,
        this.repository.getValidatorSnapshot(this.network, normalized),
      );
    }

    if (url.pathname === '/api/watchlists') {
      if (method !== 'POST') {
        throw new HttpError(405, 'method_not_allowed', 'Method is not allowed for this route');
      }
      assertNoQuery(url);
      this.watchlistCreateRateLimiter.take(
        clientKey,
        'watchlist_rate_limited',
        'Too many watchlists were created from this client; try again later',
      );
      this.watchlistCreateDailyRateLimiter.take(
        clientKey,
        'watchlist_daily_rate_limited',
        'The daily watchlist creation limit for this client was reached',
      );
      const body = await readJsonBody(request, this.maxRequestBodyBytes);
      assertBodyFields(body, ['addresses']);
      const addresses = normalizeAddresses(body.addresses, this.maxWatchlistAddresses);
      const managementToken = createOpaqueToken();
      const watchlist = this.repository.createWatchlist({
        id: randomUUID(),
        managementTokenHash: hashToken(managementToken),
        network: this.network,
        addresses,
        now: this.now(),
        admissionLimits: this.watchlistAdmissionLimits,
      });
      if (!watchlist) {
        throw new HttpError(
          503,
          'watchlist_capacity',
          'Too many unconnected watchlists; try again later',
        );
      }
      return writeJson(response, 201, {
        ...toPublicWatchlist(watchlist),
        managementToken,
      });
    }

    const match = /^\/api\/watchlists\/([^/]+)(.*)$/.exec(url.pathname);
    if (!match) throw new HttpError(404, 'not_found', 'Route not found');
    const id = decodePathSegment(match[1], 'watchlist_not_found');
    if (!WATCHLIST_ID_PATTERN.test(id)) {
      throw new HttpError(404, 'watchlist_not_found', 'Watchlist not found');
    }
    const watchlist = this.authorizeWatchlist(id, request);
    const suffix = match[2];
    assertNoQuery(url);
    if (method !== 'GET' && method !== 'HEAD') {
      this.watchlistMutationRateLimiter.take(
        id,
        'watchlist_mutation_rate_limited',
        'Too many changes were requested for this watchlist; try again shortly',
      );
    }

    if (suffix === '') {
      if (method === 'GET') {
        return writeJson(response, 200, toPublicWatchlist(watchlist));
      }
      if (method === 'PATCH') {
        const body = await readJsonBody(request, this.maxRequestBodyBytes);
        assertBodyFields(body, ['addresses']);
        const addresses = normalizeAddresses(body.addresses, this.maxWatchlistAddresses);
        const updated = this.repository.updateWatchlist(id, {
          addresses,
          now: this.now(),
        });
        return writeJson(response, 200, toPublicWatchlist(updated));
      }
      if (method === 'DELETE') {
        this.repository.deleteWatchlist(id);
        response.writeHead(204);
        response.end();
        return;
      }
      throw new HttpError(405, 'method_not_allowed', 'Method is not allowed for this route');
    }

    if (suffix === '/channels/web-push') {
      if (method === 'PUT') {
        if (!this.vapidPublicKey) {
          throw new HttpError(503, 'web_push_unavailable', 'Web Push is not configured');
        }
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
            'This browser push endpoint belongs to another watchlist',
          );
        }
        if (result?.capacity) {
          throw new HttpError(
            503,
            'channel_capacity',
            'Notification endpoint capacity is temporarily full',
          );
        }
        return writeJson(response, 200, {
          connected: true,
          enabled: true,
          verified: result?.verified === true,
          verificationQueued: Number(result?.verificationQueued ?? 0),
        });
      }
      if (method === 'DELETE') {
        this.repository.removeEndpoint(id, 'web_push', this.now());
        response.writeHead(204);
        response.end();
        return;
      }
      throw new HttpError(405, 'method_not_allowed', 'Method is not allowed for this route');
    }

    if (suffix === '/channels/web-push/verify') {
      if (method !== 'POST') {
        throw new HttpError(405, 'method_not_allowed', 'Method is not allowed for this route');
      }
      const endpoint = watchlist.endpoints.find((item) => item.kind === 'web_push');
      if (!endpoint) {
        throw new HttpError(409, 'channel_not_connected', 'Web Push is not connected');
      }
      if (endpoint.enabled !== false && endpoint.verified === true) {
        return writeJson(response, 200, { verified: true, queued: 0 });
      }
      if (endpoint.enabled === false) {
        throw new HttpError(
          409,
          'channel_disabled',
          'Web Push must be reconnected before it can be verified',
        );
      }
      const queued = Number(this.repository.requestEndpointVerification({
        watchlistId: id,
        endpointId: endpoint.id,
        now: this.now(),
        admissionLimits: this.webPushEnrollmentAdmissionLimits,
      }) ?? 0);
      return writeJson(response, 202, {
        verified: false,
        queued,
      });
    }

    if (suffix === '/channels/telegram') {
      if (method === 'POST') {
        const telegramBotUsername = this.readyTelegramUsername();
        if (!telegramBotUsername) {
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
          url: `https://t.me/${telegramBotUsername}?start=${token}`,
          expiresAt: toIso(expiresAt),
        });
      }
      if (method === 'DELETE') {
        this.repository.removeEndpoint(id, 'telegram', this.now());
        response.writeHead(204);
        response.end();
        return;
      }
      throw new HttpError(405, 'method_not_allowed', 'Method is not allowed for this route');
    }

    if (suffix === '/test') {
      if (method !== 'POST') {
        throw new HttpError(405, 'method_not_allowed', 'Method is not allowed for this route');
      }
      const now = this.now();
      const queued = this.repository.enqueueWatchlistTest(
        id,
        {
          id: `test-${randomUUID()}`,
          incidentId: `watchlist-test-${id}`,
          network: this.network,
          source: 'test',
          type: 'notification_test',
          severity: 'info',
          data: {},
          observedAt: now,
        },
        now,
        {
          cooldownMs: this.notificationTestCooldownMs,
          admissionLimits: this.notificationTestAdmissionLimits,
        },
      );
      if (!queued) {
        throw new HttpError(
          409,
          'no_active_channels',
          'No active notification channel is connected',
        );
      }
      return writeJson(response, 202, { queued: Number(queued) });
    }

    throw new HttpError(404, 'not_found', 'Route not found');
  }

  authorizeWatchlist(id, request) {
    const watchlist = this.repository.getWatchlist(id);
    if (!watchlist) throw new HttpError(404, 'watchlist_not_found', 'Watchlist not found');
    const token = readBearerToken(request.headers.authorization);
    if (!safeHashMatches(token, watchlist.managementTokenHash)) {
      throw new HttpError(401, 'invalid_management_token', 'Management token is invalid');
    }
    return watchlist;
  }

  readyTelegramUsername() {
    return this.telegramBotUsername && this.isTelegramReady()
      ? this.telegramBotUsername
      : null;
  }

  assertAllowedOrigin(request) {
    const origin = request.headers.origin;
    if (
      origin &&
      origin !== this.corsOrigin &&
      request.method !== 'GET' &&
      request.method !== 'HEAD'
    ) {
      throw new HttpError(403, 'origin_not_allowed', 'Request origin is not allowed');
    }
  }

  buildStatus() {
    const now = this.now();
    if (this.statusCache && this.statusCache.expiresAt > now) {
      return this.statusCache.value;
    }

    const node = sourceHealthFromOffenseSync(
      this.repository.getSyncState(),
      this.staleAfterMs,
      now,
    );
    const l1Snapshot = sourceHealth(
      this.repository.getSourceState('l1'),
      this.l1StaleAfterMs,
      now,
    );
    const slashLogsState = this.repository.getSourceState('l1_slash_logs');
    const l1 = combineSourceHealth([
      l1Snapshot,
      sourceHealth(slashLogsState, this.l1StaleAfterMs, now),
    ]);
    const notifications = publicDeliveryHealth({
      delivery: this.repository.getDeliveryHealthStatus({ now }),
      webPushConfigured: Boolean(this.vapidPublicKey),
      webPushState: this.repository.getSourceState('web_push'),
      telegramConfigured: Boolean(this.telegramBotUsername),
      telegramReady: Boolean(this.telegramBotUsername) && this.isTelegramReady(),
      telegramState: this.repository.getSourceState('telegram'),
    });
    const criticalStates = [node.status, l1.status];
    const status = criticalStates.some((value) => value === 'unavailable' || value === 'stale')
      ? 'stale'
      : criticalStates.some((value) => value === 'degraded') || notifications.status === 'degraded'
        ? 'degraded'
        : 'healthy';
    const value = {
      network: this.network,
      status,
      observedAt: toIso(now),
      sources: {
        node: toPublicSourceHealth(node),
        l1: toPublicSourceHealth(l1),
      },
      notifications,
    };
    this.statusCache = { value, expiresAt: now + 1_000 };
    return value;
  }
}

function assertNoQuery(url) {
  if (url.searchParams.size > 0) {
    throw new HttpError(400, 'unexpected_query', 'This route does not accept query parameters');
  }
}

function decodePathSegment(value, code) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, code, 'Path parameter is malformed');
  }
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
    if (length > maxBytes) {
      throw new HttpError(413, 'request_too_large', `Request body exceeds ${maxBytes} bytes`);
    }
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
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
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
      dataAgeMs: null,
      lastSuccessAt: null,
      blockNumber: state?.lastBlockNumber ?? null,
      blockHash: state?.lastBlockHash ?? null,
    };
  }
  const age = Math.max(0, now - Number(state.lastSuccessAt));
  const fresh = age <= staleAfterMs;
  const reachable = Number(state.consecutiveFailures ?? 0) === 0;
  const partial = Boolean(state.metadata?.degraded);
  return {
    status: !fresh ? 'stale' : !reachable || partial ? 'degraded' : 'healthy',
    dataAgeMs: age,
    lastSuccessAt: toIso(state.lastSuccessAt),
    blockNumber: state.lastBlockNumber ?? null,
    blockHash: state.lastBlockHash ?? null,
  };
}

function combineSourceHealth(sources) {
  const rank = { healthy: 0, degraded: 1, stale: 2, unavailable: 3 };
  const worst = sources.reduce((left, right) =>
    rank[right.status] > rank[left.status] ? right : left
  );
  const successes = sources.map((source) => source.lastSuccessAt).filter(Boolean).sort();
  const blockSource = [...sources].reverse().find((source) => source.blockNumber !== null);
  return {
    status: worst.status,
    dataAgeMs: sources.some((source) => source.dataAgeMs === null)
      ? null
      : Math.max(...sources.map((source) => source.dataAgeMs)),
    lastSuccessAt: successes.length === sources.length ? successes[0] : null,
    blockNumber: blockSource?.blockNumber ?? null,
    blockHash: blockSource?.blockHash ?? null,
  };
}

function toPublicSourceHealth(source) {
  const result = {
    status: source.status,
    lastSuccessAt: source.lastSuccessAt,
    dataAgeMs: source.dataAgeMs,
  };
  if (source.blockNumber !== null && source.blockNumber !== undefined) {
    result.blockNumber = source.blockNumber;
    result.blockHash = source.blockHash;
  }
  return result;
}

function publicDeliveryHealth({
  delivery,
  webPushConfigured,
  webPushState,
  telegramConfigured,
  telegramReady,
  telegramState,
}) {
  const webPush = channelNotificationHealth({
    configured: webPushConfigured,
    ready: true,
    state: webPushState,
  });
  const telegram = channelNotificationHealth({
    configured: telegramConfigured,
    ready: telegramReady,
    state: telegramState,
  });
  const configuredStatuses = [
    ...(webPushConfigured ? [webPush.status] : []),
    ...(telegramConfigured ? [telegram.status] : []),
  ];
  const status = configuredStatuses.length === 0
    ? 'unavailable'
    : delivery.status === 'degraded' ||
        configuredStatuses.some((value) => value !== 'healthy')
      ? 'degraded'
      : 'healthy';
  return {
    status,
    channels: { webPush, telegram },
  };
}

function channelNotificationHealth({ configured, ready, state }) {
  if (!configured || !ready) return { status: 'unavailable' };
  return {
    status: Number(state?.consecutiveFailures ?? 0) > 0
      ? 'degraded'
      : 'healthy',
  };
}

function toPublicWatchlist(watchlist) {
  const endpoints = watchlist.endpoints;
  return {
    id: watchlist.id,
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
    verified: matching.some(
      (endpoint) => endpoint.enabled !== false && endpoint.verified === true,
    ),
  };
}

function toIso(value) {
  return value === null || value === undefined
    ? null
    : new Date(Number(value)).toISOString();
}

class HttpError extends Error {
  constructor(status, code, message, retryAfterMs) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

class RateLimiter {
  constructor(windowMs, max, now, maxBuckets = 10_000) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.maxBuckets = maxBuckets;
    this.buckets = new Map();
  }

  take(key, code = 'rate_limited', message = 'Too many requests; try again shortly') {
    const now = this.now();
    const bucket = this.getBucket(key, now);
    bucket.count += 1;
    if (bucket.count > this.max) {
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

function clientAddress(request, trustLoopbackProxy) {
  const remote = request.socket.remoteAddress ?? 'unknown';
  if (!trustLoopbackProxy || !isLoopback(remote)) return remote;

  const cloudflareIp = request.headers['cf-connecting-ip'];
  if (typeof cloudflareIp === 'string' && isIP(cloudflareIp.trim())) {
    return cloudflareIp.trim();
  }
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
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
