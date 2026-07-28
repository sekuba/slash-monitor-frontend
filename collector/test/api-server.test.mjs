import assert from 'node:assert/strict';
import test from 'node:test';

import { CollectorApiServer } from '../src/api-server.mjs';
import {
  NotificationRateLimitError,
  SlashmonRepository,
} from '../src/database.mjs';
import { PUSH_KEYS, VALIDATOR_A, VALIDATOR_B, silentLogger } from './helpers.mjs';

const ALLOWED_ORIGIN = 'https://monitor.example';
const NOW = Date.parse('2026-07-21T12:00:00.000Z');
const VAPID_PUBLIC_KEY = `B${'a'.repeat(86)}`;
const PUSH_SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/slashmon-test-endpoint',
  expirationTime: null,
  keys: PUSH_KEYS,
};

test('manual Web Push verification shares the enrollment admission budget', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    const watchlistId = '11111111-1111-4111-8111-111111111111';
    const limits = {
      maxPerHourPerWatchlist: 1,
      maxPerDayPerWatchlist: 10,
      maxPerHourGlobal: 20,
      maxPerDayGlobal: 100,
    };
    repository.createWatchlist({
      id: watchlistId,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [VALIDATOR_A],
      now: 100,
    });
    const endpoint = repository.upsertEndpoint({
      watchlistId,
      kind: 'web_push',
      destination: PUSH_SUBSCRIPTION.endpoint,
      configJson: JSON.stringify(PUSH_SUBSCRIPTION),
      now: 100,
      admissionLimits: limits,
    });
    assert.equal(endpoint.verificationQueued, 1);

    const [verification] = repository.claimDeliveries({ now: 100 });
    assert.ok(verification);
    assert.equal(repository.failDelivery(verification.id, 'provider unavailable', 101), true);
    assert.throws(
      () => repository.requestEndpointVerification({
        watchlistId,
        endpointId: endpoint.id,
        now: 102,
        admissionLimits: limits,
      }),
      (error) => {
        assert.equal(error instanceof NotificationRateLimitError, true);
        assert.equal(error.code, 'web_push_enrollment_rate_limited');
        return true;
      },
    );
  } finally {
    repository.close();
  }
});

test('status reports notifications unavailable when no delivery channel is configured', () => {
  const server = new CollectorApiServer({
    repository: new FakeRepository(),
    host: '127.0.0.1',
    port: 0,
    corsOrigin: ALLOWED_ORIGIN,
    staleAfterMs: 60_000,
    network: 'mainnet',
    logger: silentLogger,
    now: () => NOW,
  });
  assert.deepEqual(server.buildStatus().notifications, {
    status: 'unavailable',
    channels: {
      webPush: { status: 'unavailable' },
      telegram: { status: 'unavailable' },
    },
  });
});

test('status identifies the degraded or unavailable notification channel', () => {
  const repository = new FakeRepository();
  repository.sourceStates.set('web_push', { consecutiveFailures: 2 });
  repository.sourceStates.set('telegram', { consecutiveFailures: 0 });
  const server = new CollectorApiServer({
    repository,
    host: '127.0.0.1',
    port: 0,
    corsOrigin: ALLOWED_ORIGIN,
    staleAfterMs: 60_000,
    network: 'mainnet',
    vapidPublicKey: VAPID_PUBLIC_KEY,
    telegramBotUsername: 'slashmon_test_bot',
    isTelegramReady: () => false,
    logger: silentLogger,
    now: () => NOW,
  });
  assert.deepEqual(server.buildStatus().notifications, {
    status: 'degraded',
    channels: {
      webPush: { status: 'degraded' },
      telegram: { status: 'unavailable' },
    },
  });
});

test('status stays unavailable until confirmed slash-log scanning succeeds', () => {
  const repository = new FakeRepository();
  repository.sourceStates.delete('l1_slash_logs');
  const server = new CollectorApiServer({
    repository,
    host: '127.0.0.1',
    port: 0,
    corsOrigin: ALLOWED_ORIGIN,
    staleAfterMs: 60_000,
    network: 'mainnet',
    logger: silentLogger,
    now: () => NOW,
  });
  const status = server.buildStatus();
  assert.equal(status.status, 'stale');
  assert.deepEqual(status.sources.l1, {
    status: 'unavailable',
    lastSuccessAt: null,
    dataAgeMs: null,
    blockNumber: '1234',
    blockHash: `0x${'ab'.repeat(32)}`,
  });
});

test('public API exposes only direct config, status, monitor, and validator resources', async (t) => {
  const repository = new FakeRepository();
  const { baseUrl } = await startApi(t, repository);

  const config = await getJson(`${baseUrl}/api/config`);
  assert.equal(config.response.status, 200);
  assert.deepEqual(config.body, {
    network: 'mainnet',
    maxWatchlistAddresses: 5,
    channels: {
      webPush: {
        available: true,
        publicKey: VAPID_PUBLIC_KEY,
      },
      telegram: {
        available: true,
        botUsername: 'slashmon_test_bot',
      },
    },
  });
  const status = await getJson(`${baseUrl}/api/status`);
  assert.equal(status.response.status, 200);
  assert.deepEqual(status.body, {
    network: 'mainnet',
    status: 'healthy',
    observedAt: '2026-07-21T12:00:00.000Z',
    sources: {
      node: {
        status: 'healthy',
        lastSuccessAt: '2026-07-21T11:59:59.000Z',
        dataAgeMs: 1_000,
      },
      l1: {
        status: 'healthy',
        lastSuccessAt: '2026-07-21T11:59:59.000Z',
        dataAgeMs: 1_000,
        blockNumber: '1234',
        blockHash: `0x${'ab'.repeat(32)}`,
      },
    },
    notifications: {
      status: 'healthy',
      channels: {
        webPush: { status: 'healthy' },
        telegram: { status: 'healthy' },
      },
    },
  });

  const monitor = await getJson(`${baseUrl}/api/monitor`);
  assert.equal(monitor.response.status, 200);
  assert.deepEqual(monitor.body, repository.monitorSnapshot);
  assert.deepEqual(repository.monitorRequests, ['mainnet']);

  const checksumCaseAddress = `0x${VALIDATOR_A.slice(2).toUpperCase()}`;
  const validator = await getJson(`${baseUrl}/api/validators/${checksumCaseAddress}`);
  assert.equal(validator.response.status, 200);
  assert.deepEqual(validator.body, repository.validatorSnapshot);
  assert.deepEqual(repository.validatorRequests, [{
    network: 'mainnet',
    address: VALIDATOR_A,
  }]);

  const invalidAddress = await getJson(`${baseUrl}/api/validators/not-an-address`);
  assert.equal(invalidAddress.response.status, 400);
  assert.equal(invalidAddress.body.error.code, 'invalid_address');

  const networkQuery = await getJson(`${baseUrl}/api/status?network=mainnet`);
  assert.equal(networkQuery.response.status, 400);
  assert.equal(networkQuery.body.error.code, 'unexpected_query');

  const unknown = await getJson(`${baseUrl}/api/no-such-resource`);
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.error.code, 'not_found');
});

test('watchlists are direct capability-protected CRUD resources', async (t) => {
  const repository = new FakeRepository();
  const { baseUrl } = await startApi(t, repository);

  const created = await jsonRequest(`${baseUrl}/api/watchlists`, {
    method: 'POST',
    origin: ALLOWED_ORIGIN,
    body: { addresses: [VALIDATOR_A, VALIDATOR_A] },
  });
  assert.equal(created.response.status, 201);
  assert.match(created.body.id, /^[0-9a-f-]{36}$/);
  assert.match(created.body.managementToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(created.body.addresses, [VALIDATOR_A]);
  assert.deepEqual(created.body.channels, disconnectedChannels());
  assert.equal(created.body.network, undefined);

  const { id, managementToken } = created.body;
  const missingToken = await getJson(`${baseUrl}/api/watchlists/${id}`);
  assert.equal(missingToken.response.status, 401);
  assert.equal(missingToken.body.error.code, 'missing_management_token');

  const wrongToken = await jsonRequest(`${baseUrl}/api/watchlists/${id}`, {
    token: 'x'.repeat(43),
  });
  assert.equal(wrongToken.response.status, 401);
  assert.equal(wrongToken.body.error.code, 'invalid_management_token');

  const fetched = await jsonRequest(`${baseUrl}/api/watchlists/${id}`, {
    token: managementToken,
  });
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.managementToken, undefined);
  assert.deepEqual(fetched.body, {
    id,
    addresses: [VALIDATOR_A],
    channels: disconnectedChannels(),
  });

  const updated = await jsonRequest(`${baseUrl}/api/watchlists/${id}`, {
    method: 'PATCH',
    token: managementToken,
    origin: ALLOWED_ORIGIN,
    body: { addresses: [VALIDATOR_B] },
  });
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body, {
    id,
    addresses: [VALIDATOR_B],
    channels: disconnectedChannels(),
  });

  const networkField = await jsonRequest(`${baseUrl}/api/watchlists`, {
    method: 'POST',
    origin: ALLOWED_ORIGIN,
    body: { network: 'mainnet', addresses: [VALIDATOR_A] },
  });
  assert.equal(networkField.response.status, 400);
  assert.equal(networkField.body.error.code, 'unknown_field');

  const deleted = await jsonRequest(`${baseUrl}/api/watchlists/${id}`, {
    method: 'DELETE',
    token: managementToken,
    origin: ALLOWED_ORIGIN,
  });
  assert.equal(deleted.response.status, 204);
  assert.equal(deleted.body, null);

  const gone = await jsonRequest(`${baseUrl}/api/watchlists/${id}`, {
    token: managementToken,
  });
  assert.equal(gone.response.status, 404);
  assert.equal(gone.body.error.code, 'watchlist_not_found');
});

test('watchlist channel routes add, verify, test, link, and remove delivery channels', async (t) => {
  const repository = new FakeRepository();
  let telegramReady = false;
  const { baseUrl } = await startApi(t, repository, {
    isTelegramReady: () => telegramReady,
  });
  const created = await createWatchlist(baseUrl);
  const { id, managementToken } = created.body;

  const unavailableTelegram = await authenticatedRequest(
    baseUrl,
    id,
    managementToken,
    '/channels/telegram',
    { method: 'POST' },
  );
  assert.equal(unavailableTelegram.response.status, 503);
  assert.equal(unavailableTelegram.body.error.code, 'telegram_unavailable');

  const connected = await authenticatedRequest(
    baseUrl,
    id,
    managementToken,
    '/channels/web-push',
    {
      method: 'PUT',
      body: { subscription: PUSH_SUBSCRIPTION },
    },
  );
  assert.equal(connected.response.status, 200);
  assert.deepEqual(connected.body, {
    connected: true,
    enabled: true,
    verified: false,
    verificationQueued: 1,
  });

  const fetched = await authenticatedRequest(baseUrl, id, managementToken);
  assert.deepEqual(fetched.body.channels.webPush, {
    connected: true,
    enabled: true,
    verified: false,
  });

  const changedAddresses = await authenticatedRequest(baseUrl, id, managementToken, '', {
    method: 'PATCH',
    body: { addresses: [VALIDATOR_B] },
  });
  assert.equal(changedAddresses.response.status, 200);
  assert.deepEqual(changedAddresses.body.addresses, [VALIDATOR_B]);
  assert.deepEqual(changedAddresses.body.channels.webPush, {
    connected: true,
    enabled: true,
    verified: false,
  });

  const verification = await authenticatedRequest(
    baseUrl,
    id,
    managementToken,
    '/channels/web-push/verify',
    { method: 'POST' },
  );
  assert.equal(verification.response.status, 202);
  assert.deepEqual(verification.body, { verified: false, queued: 1 });
  assert.deepEqual(repository.verificationRequests, [{
    watchlistId: id,
    endpointId: 'web-push-endpoint',
    now: NOW,
    admissionLimits: {
      maxPerHourPerWatchlist: 3,
      maxPerDayPerWatchlist: 10,
      maxPerHourGlobal: 20,
      maxPerDayGlobal: 100,
    },
  }]);

  const tested = await authenticatedRequest(
    baseUrl,
    id,
    managementToken,
    '/test',
    { method: 'POST' },
  );
  assert.equal(tested.response.status, 202);
  assert.deepEqual(tested.body, { queued: 1 });
  assert.equal(repository.testRequests[0].event.type, 'notification_test');
  assert.equal(repository.testRequests[0].event.network, 'mainnet');

  telegramReady = true;
  const telegram = await authenticatedRequest(
    baseUrl,
    id,
    managementToken,
    '/channels/telegram',
    { method: 'POST' },
  );
  assert.equal(telegram.response.status, 201);
  assert.equal(new URL(telegram.body.url).pathname, '/slashmon_test_bot');
  assert.match(new URL(telegram.body.url).searchParams.get('start'), /^[A-Za-z0-9_-]{32}$/);
  assert.equal(telegram.body.expiresAt, '2026-07-21T12:10:00.000Z');

  const removedPush = await authenticatedRequest(
    baseUrl,
    id,
    managementToken,
    '/channels/web-push',
    { method: 'DELETE' },
  );
  assert.equal(removedPush.response.status, 204);
  const missingPush = await authenticatedRequest(
    baseUrl,
    id,
    managementToken,
    '/channels/web-push/verify',
    { method: 'POST' },
  );
  assert.equal(missingPush.response.status, 409);
  assert.equal(missingPush.body.error.code, 'channel_not_connected');

  const removedTelegram = await authenticatedRequest(
    baseUrl,
    id,
    managementToken,
    '/channels/telegram',
    { method: 'DELETE' },
  );
  assert.equal(removedTelegram.response.status, 204);
  assert.deepEqual(repository.removedEndpoints, [
    { watchlistId: id, kind: 'web_push', now: NOW },
    { watchlistId: id, kind: 'telegram', now: NOW },
  ]);
});

test('mutations enforce CORS while preflight and public reads remain available', async (t) => {
  const repository = new FakeRepository();
  const { baseUrl } = await startApi(t, repository);

  const preflight = await fetch(`${baseUrl}/api/watchlists`, {
    method: 'OPTIONS',
    headers: {
      origin: ALLOWED_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);

  const blocked = await jsonRequest(`${baseUrl}/api/watchlists`, {
    method: 'POST',
    origin: 'https://evil.example',
    body: { addresses: [VALIDATOR_A] },
  });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.response.headers.get('access-control-allow-origin'), null);
  assert.equal(blocked.body.error.code, 'origin_not_allowed');

  const publicRead = await fetch(`${baseUrl}/api/status`, {
    headers: { origin: 'https://elsewhere.example' },
  });
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.headers.get('access-control-allow-origin'), null);
});

class FakeRepository {
  constructor() {
    this.watchlists = new Map();
    this.monitorRequests = [];
    this.validatorRequests = [];
    this.verificationRequests = [];
    this.testRequests = [];
    this.removedEndpoints = [];
    this.telegramLinks = [];
    this.monitorSnapshot = {
      network: 'mainnet',
      coverage: {
        cases: {
          observedAt: '2026-07-21T11:59:59.000Z',
          blockNumber: '1234',
          blockHash: `0x${'ab'.repeat(32)}`,
          complete: true,
        },
        slashes: {
          observedAt: '2026-07-21T11:59:59.000Z',
          fromBlock: '1000',
          blockNumber: '1234',
          blockHash: `0x${'ab'.repeat(32)}`,
          confirmedBlockNumber: '1234',
          complete: true,
        },
      },
      protocol: { currentRound: '7', quorum: 9 },
      cases: [{ id: 'case-1', phase: 'voting' }],
      slashes: { confirmed: [], removed: [] },
    };
    this.validatorSnapshot = {
      address: VALIDATOR_A,
      observedAt: '2026-07-21T11:59:59.000Z',
      cases: [],
      nodeOffenses: [],
      slashes: { confirmed: [], removed: [] },
    };
    this.sourceStates = new Map([
      ['l1', {
        lastAttemptAt: NOW - 1_000,
        lastSuccessAt: NOW - 1_000,
        consecutiveFailures: 0,
        successfulPolls: 4,
        lastBlockNumber: '1234',
        lastBlockHash: `0x${'ab'.repeat(32)}`,
        metadata: {},
      }],
      ['l1_slash_logs', {
        lastAttemptAt: NOW - 1_000,
        lastSuccessAt: NOW - 1_000,
        consecutiveFailures: 0,
        successfulPolls: 4,
        lastBlockNumber: '1234',
        lastBlockHash: `0x${'ab'.repeat(32)}`,
        metadata: {},
      }],
    ]);
  }

  getSyncState() {
    return {
      lastAttemptAt: NOW - 1_000,
      lastSuccessAt: NOW - 1_000,
      consecutiveFailures: 0,
      successfulPolls: 4,
      lastError: null,
    };
  }

  getSourceState(source) {
    return this.sourceStates.get(source);
  }

  getDeliveryHealthStatus() {
    return { status: 'healthy' };
  }

  getMonitorSnapshot(network) {
    this.monitorRequests.push(network);
    return this.monitorSnapshot;
  }

  getValidatorSnapshot(network, address) {
    this.validatorRequests.push({ network, address });
    return this.validatorSnapshot;
  }

  createWatchlist({ id, managementTokenHash, addresses }) {
    const watchlist = {
      id,
      managementTokenHash,
      addresses: [...addresses],
      endpoints: [],
    };
    this.watchlists.set(id, watchlist);
    return watchlist;
  }

  getWatchlist(id) {
    return this.watchlists.get(id);
  }

  deleteWatchlist(id) {
    return this.watchlists.delete(id);
  }

  updateWatchlist(id, { addresses }) {
    const watchlist = this.watchlists.get(id);
    watchlist.addresses = [...addresses];
    return watchlist;
  }

  upsertEndpoint({ watchlistId, kind }) {
    const watchlist = this.watchlists.get(watchlistId);
    watchlist.endpoints = watchlist.endpoints.filter((endpoint) => endpoint.kind !== kind);
    watchlist.endpoints.push({
      id: 'web-push-endpoint',
      kind,
      enabled: true,
      verified: false,
    });
    return {
      id: 'web-push-endpoint',
      kind,
      enabled: true,
      verified: false,
      verificationQueued: 1,
    };
  }

  removeEndpoint(watchlistId, kind, now) {
    const watchlist = this.watchlists.get(watchlistId);
    watchlist.endpoints = watchlist.endpoints.filter((endpoint) => endpoint.kind !== kind);
    this.removedEndpoints.push({ watchlistId, kind, now });
    return true;
  }

  requestEndpointVerification({ watchlistId, endpointId, now, admissionLimits }) {
    this.verificationRequests.push({ watchlistId, endpointId, now, admissionLimits });
    return 1;
  }

  createTelegramLink(link) {
    this.telegramLinks.push(link);
  }

  enqueueWatchlistTest(watchlistId, event, now, options) {
    this.testRequests.push({ watchlistId, event, now, options });
    return this.watchlists.get(watchlistId).endpoints.length;
  }
}

function disconnectedChannels() {
  return {
    webPush: { connected: false, enabled: false, verified: false },
    telegram: { connected: false, enabled: false, verified: false },
  };
}

async function startApi(t, repository, overrides = {}) {
  const server = new CollectorApiServer({
    repository,
    host: '127.0.0.1',
    port: 0,
    corsOrigin: ALLOWED_ORIGIN,
    staleAfterMs: 60_000,
    l1StaleAfterMs: 60_000,
    network: 'mainnet',
    vapidPublicKey: VAPID_PUBLIC_KEY,
    telegramBotUsername: 'slashmon_test_bot',
    isTelegramReady: () => true,
    maxWatchlistAddresses: 5,
    logger: silentLogger,
    now: () => NOW,
    ...overrides,
  });
  const address = await server.listen();
  t.after(async () => {
    await server.close();
  });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function createWatchlist(baseUrl, addresses = [VALIDATOR_A]) {
  return jsonRequest(`${baseUrl}/api/watchlists`, {
    method: 'POST',
    origin: ALLOWED_ORIGIN,
    body: { addresses },
  });
}

function authenticatedRequest(
  baseUrl,
  id,
  token,
  path = '',
  { method = 'GET', body } = {},
) {
  return jsonRequest(`${baseUrl}/api/watchlists/${id}${path}`, {
    method,
    origin: ALLOWED_ORIGIN,
    token,
    body,
  });
}

function getJson(url) {
  return jsonRequest(url);
}

async function jsonRequest(url, {
  method = 'GET',
  origin,
  token,
  body,
  headers: extraHeaders = {},
} = {}) {
  const headers = { accept: 'application/json', ...extraHeaders };
  if (origin) headers.origin = origin;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}
