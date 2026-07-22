import assert from 'node:assert/strict';
import test from 'node:test';

import { CollectorApiServer } from '../src/api-server.mjs';
import { NOTIFICATION_TEST_COOLDOWN_MS, OffenseRepository } from '../src/database.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import { hashToken } from '../src/security.mjs';
import { OFFENSE_A, PUSH_KEYS, SEQUENCER_A, SEQUENCER_B, silentLogger } from './helpers.mjs';

const ALLOWED_ORIGIN = 'https://monitor.example';
const NOW = Date.parse('2026-07-21T12:00:00.000Z');
const VAPID_PUBLIC_KEY = `B${'a'.repeat(86)}`;
const PUSH_SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/slashmon-test-endpoint',
  expirationTime: null,
  keys: PUSH_KEYS,
};

test('API reports health without exposing full collector snapshots', async (t) => {
  const repository = new OffenseRepository(':memory:');
  repository.listOnchainRounds = () => {
    throw new Error('health and public status must not serialize full L1 round snapshots');
  };
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: 10_000 });
  repository.recordSourceSuccess('l1', {}, 10_000);
  repository.recordSourceSuccess('telegram', {}, 10_000);
  const { baseUrl } = await startApi(t, repository, {
    now: () => 20_000,
    staleAfterMs: 60_000,
    l1StaleAfterMs: 60_000,
  });

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.status, 'healthy');
  assert.equal(health.onchainRounds, undefined);
  assert.equal(health.outbox, undefined);

  const publicStatus = await (await fetch(`${baseUrl}/api/v2/status?network=mainnet`)).json();
  assert.equal(publicStatus.status, 'healthy');
  assert.equal(publicStatus.onchainRounds, undefined);
  assert.equal(publicStatus.outbox, undefined);

});

test('health becomes stale without discarding the last snapshot', async (t) => {
  const repository = new OffenseRepository(':memory:');
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: 1_000 });
  repository.recordFailure('node unavailable', 2_000);
  repository.recordSourceSuccess('l1', {}, 1_000);
  const { baseUrl } = await startApi(t, repository, {
    now: () => 10_000,
    staleAfterMs: 5_000,
    l1StaleAfterMs: 5_000,
  });

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 503);
  assert.equal((await healthResponse.json()).status, 'stale');

  assert.equal(repository.listOffenses({ status: 'active' }).length, 1);
});

test('overall L1 health degrades when confirmed slash-log backfill is failing', async (t) => {
  const repository = new OffenseRepository(':memory:');
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: NOW - 1_000 });
  repository.recordSourceSuccess('l1', {}, NOW - 1_000);
  repository.recordSourceSuccess('l1_slash_logs', {}, NOW - 1_000);
  repository.recordSourceFailure('l1_slash_logs', 'eth_getLogs unavailable', NOW);
  const { baseUrl } = await startApi(t, repository);

  const status = await (await fetch(`${baseUrl}/api/v2/status?network=mainnet`)).json();
  assert.equal(status.status, 'degraded');
  assert.equal(status.sources.l1.status, 'degraded');
});

test('overall L1 health remains degraded while confirmed slash-log backfill has more chunks', async (t) => {
  const repository = new OffenseRepository(':memory:');
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: NOW - 1_000 });
  repository.recordSourceSuccess('l1', {}, NOW - 1_000);
  repository.recordSourceSuccess('l1_slash_logs', { caughtUp: false, degraded: true }, NOW - 1_000);
  const { baseUrl } = await startApi(t, repository);

  const status = await (await fetch(`${baseUrl}/api/v2/status?network=mainnet`)).json();
  assert.equal(status.status, 'degraded');
  assert.equal(status.sources.l1.status, 'degraded');
});

test('config, public journal, watch filtering, and CORS share one real snapshot', async (t) => {
  const repository = healthyRepository();
  const { baseUrl } = await startApi(t, repository);

  const configResponse = await fetch(`${baseUrl}/api/v2/config`, {
    headers: { origin: ALLOWED_ORIGIN },
  });
  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.deepEqual(await configResponse.json(), {
    schemaVersion: 2,
    network: 'mainnet',
    vapidPublicKey: VAPID_PUBLIC_KEY,
    telegramBotUsername: 'slashmon_test_bot',
    maxSequencers: 5,
  });

  const statusResponse = await fetch(`${baseUrl}/api/v2/status?network=mainnet`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.schemaVersion, 2);
  assert.equal(status.network, 'mainnet');
  assert.equal(status.status, 'healthy');
  assert.deepEqual(status.sources, {
    l1: { status: 'healthy' },
    aztec: { status: 'healthy' },
  });
  assert.deepEqual(status.delivery, { status: 'healthy' });
  assert.match(status.generatedAt, /^2026-07-21T/);

  const wrongNetworkResponse = await fetch(`${baseUrl}/api/v2/status?network=testnet`);
  assert.equal(wrongNetworkResponse.status, 400);
  assert.equal((await wrongNetworkResponse.json()).error.code, 'unsupported_network');

  const publicEventsResponse = await fetch(
    `${baseUrl}/api/v2/events?network=mainnet&address=${SEQUENCER_A}`,
  );
  const publicEvents = await publicEventsResponse.json();
  assert.equal(publicEvents.schemaVersion, 2);
  assert.deepEqual(
    publicEvents.data.map((event) => ({ source: event.source, certainty: event.certainty })),
    [{ source: 'aztec_node', certainty: 'pending' }],
  );
  const [pendingEvent] = repository.listEvents({ network: 'mainnet', addresses: [SEQUENCER_A] }).data;

  const publicPendingDetailResponse = await fetch(
    `${baseUrl}/api/v2/events/${pendingEvent.id}?network=mainnet`,
  );
  assert.equal(publicPendingDetailResponse.status, 200);
  const publicPendingDetail = await publicPendingDetailResponse.json();
  assert.equal(publicPendingDetail.data.id, pendingEvent.id);
  assert.equal(publicPendingDetail.data.certainty, 'pending');

  const matchingSubscription = await createSubscription(baseUrl, [SEQUENCER_A]);
  const unrelatedSubscription = await createSubscription(baseUrl, [SEQUENCER_B]);
  const matching = matchingSubscription.body.data;
  const unrelated = unrelatedSubscription.body.data;

  const matchingEvents = await authenticatedJson(baseUrl, matching.id, matching.managementToken, {
    path: '/events',
  });
  const unrelatedEvents = await authenticatedJson(baseUrl, unrelated.id, unrelated.managementToken, {
    path: '/events',
  });
  assert.deepEqual(matchingEvents.body.data.map((event) => event.id), [pendingEvent.id]);
  assert.deepEqual(unrelatedEvents.body.data, []);

  const matchingDetail = await authenticatedJson(baseUrl, matching.id, matching.managementToken, {
    path: `/events/${pendingEvent.id}`,
  });
  const unrelatedDetail = await authenticatedJson(baseUrl, unrelated.id, unrelated.managementToken, {
    path: `/events/${pendingEvent.id}`,
  });
  assert.equal(matchingDetail.response.status, 200);
  assert.equal(matchingDetail.body.data.id, pendingEvent.id);
  assert.equal(unrelatedDetail.response.status, 404);
  assert.equal(unrelatedDetail.body.error.code, 'event_not_found');

  const preflight = await fetch(`${baseUrl}/api/v2/subscriptions`, {
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

  const blockedMutation = await jsonRequest(`${baseUrl}/api/v2/subscriptions`, {
    method: 'POST',
    origin: 'https://evil.example',
    body: { network: 'mainnet', addresses: [SEQUENCER_A] },
  });
  assert.equal(blockedMutation.response.status, 403);
  assert.equal(blockedMutation.response.headers.get('access-control-allow-origin'), null);
  assert.equal(blockedMutation.body.error.code, 'origin_not_allowed');
});

test('subscriptions use bearer capability auth and replace their addresses', async (t) => {
  const repository = healthyRepository();
  const { baseUrl } = await startApi(t, repository);

  const created = await createSubscription(baseUrl, [SEQUENCER_A, SEQUENCER_A]);
  assert.equal(created.response.status, 201);
  assert.equal(created.body.schemaVersion, 2);
  assert.match(created.body.data.id, /^[0-9a-f-]{36}$/);
  assert.match(created.body.data.managementToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(created.body.data.addresses, [SEQUENCER_A]);
  const { id, managementToken } = created.body.data;

  const unauthenticated = await fetch(`${baseUrl}/api/v2/subscriptions/${id}`);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error.code, 'missing_management_token');

  const wrongToken = await fetch(`${baseUrl}/api/v2/subscriptions/${id}`, {
    headers: { authorization: `Bearer ${'x'.repeat(43)}` },
  });
  assert.equal(wrongToken.status, 401);
  assert.equal((await wrongToken.json()).error.code, 'invalid_management_token');

  const fetched = await authenticatedJson(baseUrl, id, managementToken);
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.data.managementToken, undefined);
  assert.deepEqual(fetched.body.data.addresses, [SEQUENCER_A]);
  assert.equal(fetched.body.data.enabled, undefined);

  const emptyPatch = await authenticatedJson(baseUrl, id, managementToken, {
    method: 'PATCH',
    body: {},
  });
  assert.equal(emptyPatch.response.status, 400);
  assert.equal(emptyPatch.body.error.code, 'empty_patch');

  const removedField = await authenticatedJson(baseUrl, id, managementToken, {
    method: 'PATCH',
    body: { addresses: [SEQUENCER_B], enabled: true },
  });
  assert.equal(removedField.response.status, 400);
  assert.equal(removedField.body.error.code, 'unknown_field');

  const updated = await authenticatedJson(baseUrl, id, managementToken, {
    method: 'PATCH',
    body: { addresses: [SEQUENCER_B] },
  });
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body.data.addresses, [SEQUENCER_B]);

  const deleted = await authenticatedJson(baseUrl, id, managementToken, { method: 'DELETE' });
  assert.equal(deleted.response.status, 204);

  const afterDelete = await authenticatedJson(baseUrl, id, managementToken);
  assert.equal(afterDelete.response.status, 404);
  assert.equal(afterDelete.body.error.code, 'subscription_not_found');
});

test('notification channels validate endpoints and queue test deliveries', async (t) => {
  const repository = healthyRepository();
  let now = NOW;
  const { baseUrl } = await startApi(t, repository, { now: () => now });
  const created = await createSubscription(baseUrl, [SEQUENCER_A]);
  const { id, managementToken } = created.body.data;

  const testWithoutChannel = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/test',
    method: 'POST',
    body: {},
  });
  assert.equal(testWithoutChannel.response.status, 409);
  assert.equal(testWithoutChannel.body.error.code, 'no_active_channels');

  const unsupportedPush = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/channels/web-push',
    method: 'PUT',
    body: {
      subscription: {
        ...PUSH_SUBSCRIPTION,
        endpoint: 'https://push.attacker.example/collect',
      },
    },
  });
  assert.equal(unsupportedPush.response.status, 400);
  assert.equal(unsupportedPush.body.error.code, 'unsupported_push_service');

  const invalidPushKeys = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/channels/web-push',
    method: 'PUT',
    body: { subscription: { ...PUSH_SUBSCRIPTION, keys: { p256dh: 'short', auth: 'short' } } },
  });
  assert.equal(invalidPushKeys.response.status, 400);
  assert.equal(invalidPushKeys.body.error.code, 'invalid_push_keys');

  const push = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/channels/web-push',
    method: 'PUT',
    body: { subscription: PUSH_SUBSCRIPTION },
  });
  assert.equal(push.response.status, 200);
  assert.equal(push.body.data.connected, true);
  assert.equal(push.body.data.verified, false);
  assert.equal(push.body.data.verificationQueued, 1);
  assert.equal(push.body.data.catchupQueued, 0);

  const otherCreated = await createSubscription(baseUrl, [SEQUENCER_B]);
  const other = otherCreated.body.data;
  const endpointTakeover = await authenticatedJson(baseUrl, other.id, other.managementToken, {
    path: '/channels/web-push',
    method: 'PUT',
    body: { subscription: PUSH_SUBSCRIPTION },
  });
  assert.equal(endpointTakeover.response.status, 409);
  assert.equal(endpointTakeover.body.error.code, 'push_endpoint_in_use');
  const originalAfterConflict = await authenticatedJson(baseUrl, id, managementToken);
  const otherAfterConflict = await authenticatedJson(baseUrl, other.id, other.managementToken);
  assert.deepEqual(originalAfterConflict.body.data.channels.webPush, {
    connected: true, enabled: true, verified: false,
  });
  assert.deepEqual(otherAfterConflict.body.data.channels.webPush, {
    connected: false, enabled: false, verified: false,
  });

  const [verification] = repository.claimDeliveries({ now: NOW });
  assert.equal(verification.event.type, 'notification_channel_verification');
  assert.equal(repository.completeDelivery(verification.id, 'provider-check', NOW), true);

  const catchup = repository.db.prepare("SELECT id FROM events WHERE source = 'catchup'").get();
  assert.ok(catchup);
  const privateCatchup = await authenticatedJson(baseUrl, id, managementToken, {
    path: `/events/${catchup.id}`,
  });
  assert.equal(privateCatchup.response.status, 200);
  assert.equal(privateCatchup.body.data.source, 'catchup');
  assert.equal(privateCatchup.body.data.certainty, 'pending');
  const privateFeed = await authenticatedJson(baseUrl, id, managementToken, { path: '/events' });
  assert.equal(privateFeed.body.data.some((event) => event.source === 'catchup'), false);
  const publicCatchup = await fetch(`${baseUrl}/api/v2/events/${catchup.id}?network=mainnet`);
  assert.equal(publicCatchup.status, 404);

  const afterPush = await authenticatedJson(baseUrl, id, managementToken);
  assert.deepEqual(afterPush.body.data.channels.webPush, {
    connected: true, enabled: true, verified: true,
  });
  assert.deepEqual(afterPush.body.data.channels.telegram, {
    connected: false, enabled: false, verified: false,
  });

  const pushTest = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/test',
    method: 'POST',
    body: {},
  });
  assert.equal(pushTest.response.status, 202);
  assert.equal(pushTest.body.queued, 1);

  const throttledTest = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/test',
    method: 'POST',
    body: {},
  });
  assert.equal(throttledTest.response.status, 429);
  assert.equal(throttledTest.response.headers.get('retry-after'), '60');
  assert.equal(throttledTest.body.error.code, 'notification_test_cooldown');
  assert.equal(throttledTest.body.retryAfterMs, NOTIFICATION_TEST_COOLDOWN_MS);

  const link = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/channels/telegram-link',
    method: 'POST',
    body: {},
  });
  assert.equal(link.response.status, 201);
  assert.equal(link.body.schemaVersion, 2);
  assert.equal(link.body.expiresAt, new Date(NOW + 10 * 60_000).toISOString());
  const linkUrl = new URL(link.body.url);
  assert.equal(linkUrl.origin, 'https://t.me');
  assert.equal(linkUrl.pathname, '/slashmon_test_bot');
  const linkToken = linkUrl.searchParams.get('start');
  assert.match(linkToken, /^[A-Za-z0-9_-]{32}$/);

  const linked = repository.consumeTelegramLink(hashToken(linkToken), '424242', NOW + 1_000);
  assert.equal(linked.id, id);
  const afterTelegram = await authenticatedJson(baseUrl, id, managementToken);
  assert.deepEqual(afterTelegram.body.data.channels.telegram, {
    connected: true, enabled: true, verified: true,
  });

  now += NOTIFICATION_TEST_COOLDOWN_MS;
  const bothChannelsTest = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/test',
    method: 'POST',
    body: {},
  });
  assert.equal(bothChannelsTest.response.status, 202);
  assert.equal(bothChannelsTest.body.queued, 2);

  const removedPush = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/channels/web-push',
    method: 'DELETE',
  });
  assert.equal(removedPush.response.status, 204);
  const afterRemoval = await authenticatedJson(baseUrl, id, managementToken);
  assert.deepEqual(afterRemoval.body.data.channels.webPush, {
    connected: false, enabled: false, verified: false,
  });
});

test('Telegram links stay hidden until the configured bot identity is runtime-verified', async (t) => {
  const repository = healthyRepository();
  let telegramReady = false;
  const { baseUrl } = await startApi(t, repository, {
    isTelegramReady: () => telegramReady,
  });
  const created = await createSubscription(baseUrl, [SEQUENCER_A]);
  const { id, managementToken } = created.body.data;

  const unavailableConfig = await (await fetch(`${baseUrl}/api/v2/config`)).json();
  assert.equal(unavailableConfig.telegramBotUsername, null);
  const unavailableLink = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/channels/telegram-link',
    method: 'POST',
    body: {},
  });
  assert.equal(unavailableLink.response.status, 503);
  assert.equal(unavailableLink.body.error.code, 'telegram_unavailable');

  telegramReady = true;
  const readyConfig = await (await fetch(`${baseUrl}/api/v2/config`)).json();
  assert.equal(readyConfig.telegramBotUsername, 'slashmon_test_bot');
  const readyLink = await authenticatedJson(baseUrl, id, managementToken, {
    path: '/channels/telegram-link',
    method: 'POST',
    body: {},
  });
  assert.equal(readyLink.response.status, 201);
  assert.equal(new URL(readyLink.body.url).pathname, '/slashmon_test_bot');
});

test('overall health degrades when notification delivery work is meaningfully overdue', async (t) => {
  const repository = healthyRepository();
  repository.createWatchlist({
    id: '11111111-1111-4111-8111-111111111111',
    managementTokenHash: 'a'.repeat(64),
    network: 'mainnet',
    addresses: [SEQUENCER_B],
    now: NOW - 10 * 60_000,
  });
  repository.upsertEndpoint({
    watchlistId: '11111111-1111-4111-8111-111111111111',
    kind: 'telegram',
    destination: '42',
    now: NOW - 10 * 60_000,
  });
  repository.enqueueWatchlistTest(
    '11111111-1111-4111-8111-111111111111',
    {
      id: 'overdue-health-test',
      network: 'mainnet',
      source: 'test',
      type: 'notification_test',
      severity: 'info',
      title: 'test',
      body: 'test',
      data: {},
    },
    NOW - 10 * 60_000,
  );
  const { baseUrl } = await startApi(t, repository);

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.status, 'degraded');
  assert.equal(health.delivery.status, 'degraded');
  assert.equal(health.delivery.overdueDeliveries, undefined);

  const status = await (await fetch(`${baseUrl}/api/v2/status?network=mainnet`)).json();
  assert.equal(status.status, 'degraded');
  assert.deepEqual(status.delivery, { status: 'degraded' });
});

test('one expired client endpoint cannot degrade global health', async (t) => {
  const repository = healthyRepository();
  const watchlistId = '22222222-2222-4222-8222-222222222222';
  repository.createWatchlist({
    id: watchlistId,
    managementTokenHash: 'b'.repeat(64),
    network: 'mainnet',
    addresses: [SEQUENCER_B],
    now: NOW - 1_000,
  });
  repository.upsertEndpoint({
    watchlistId,
    kind: 'web_push',
    destination: 'https://fcm.googleapis.com/fcm/send/expired-health-endpoint',
    now: NOW - 1_000,
  });
  repository.enqueueWatchlistTest(watchlistId, {
    id: 'permanent-provider-health-test',
    network: 'mainnet',
    source: 'test',
    type: 'notification_test',
    severity: 'info',
    title: 'test',
    body: 'test',
    data: {},
  }, NOW - 500);
  const [delivery] = repository.claimDeliveries({ now: NOW });
  repository.failDeliveryAndDisableEndpoint(
    delivery.id,
    delivery.endpointId,
    'Web Push returned HTTP 410',
    NOW,
  );
  const { baseUrl } = await startApi(t, repository);

  const health = await (await fetch(`${baseUrl}/health`)).json();
  assert.equal(health.status, 'healthy');
  assert.equal(health.delivery.status, 'healthy');
  assert.equal(health.delivery.recentTerminalFailures, undefined);
});

test('a configured Telegram credential outage degrades delivery health without disabling collection', async (t) => {
  const repository = healthyRepository();
  repository.recordSourceFailure('telegram', 'Telegram getMe returned error 401', NOW);
  const { baseUrl } = await startApi(t, repository);

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.status, 'degraded');
  assert.equal(health.delivery.status, 'degraded');
  assert.deepEqual(health.delivery, { status: 'degraded' });
  assert.equal(health.sources.l1.status, 'healthy');
  assert.equal(health.sources.aztec.status, 'healthy');
  assert.equal(health.sources.telegram.lastError, undefined);
  assert.equal(health.sources.telegram.errorClass, 'upstream_error');
});

test('a shared Web Push credential outage is visible without blaming one endpoint', async (t) => {
  const repository = healthyRepository();
  repository.recordSourceFailure('web_push', 'Web Push returned HTTP 401', NOW);
  const { baseUrl } = await startApi(t, repository);

  const health = await (await fetch(`${baseUrl}/health`)).json();
  assert.equal(health.status, 'degraded');
  assert.equal(health.delivery.status, 'degraded');
  assert.equal(health.sources.webPush.status, 'degraded');
  assert.equal(health.sources.webPush.errorClass, 'upstream_error');
  assert.equal(health.sources.l1.status, 'healthy');
});

test('mutation limits separate clients only through an explicitly trusted loopback proxy', async (t) => {
  const repository = healthyRepository();
  const { baseUrl } = await startApi(t, repository, {
    trustLoopbackProxy: true,
    rateLimitMaxMutations: 1,
  });

  const first = await jsonRequest(`${baseUrl}/api/v2/subscriptions`, {
    method: 'POST',
    origin: ALLOWED_ORIGIN,
    headers: { 'x-real-ip': '198.51.100.10' },
    body: { network: 'mainnet', addresses: [SEQUENCER_A] },
  });
  const otherClient = await jsonRequest(`${baseUrl}/api/v2/subscriptions`, {
    method: 'POST',
    origin: ALLOWED_ORIGIN,
    headers: { 'x-real-ip': '198.51.100.11' },
    body: { network: 'mainnet', addresses: [SEQUENCER_A] },
  });
  const repeated = await jsonRequest(`${baseUrl}/api/v2/subscriptions`, {
    method: 'POST',
    origin: ALLOWED_ORIGIN,
    headers: { 'x-real-ip': '198.51.100.10' },
    body: { network: 'mainnet', addresses: [SEQUENCER_A] },
  });

  assert.equal(first.response.status, 201);
  assert.equal(otherClient.response.status, 201);
  assert.equal(repeated.response.status, 429);
  assert.equal(repeated.body.error.code, 'rate_limited');
});

test('anonymous reads and watch-list creation have tighter independent limits', async (t) => {
  const repository = healthyRepository();
  const { baseUrl } = await startApi(t, repository, {
    readRateLimitMax: 1,
    subscriptionCreateMaxPerClient: 1,
    subscriptionCreateMaxGlobal: 10,
  });

  const firstRead = await fetch(`${baseUrl}/api/v2/config`);
  const secondRead = await fetch(`${baseUrl}/api/v2/config`);
  assert.equal(firstRead.status, 200);
  assert.equal(secondRead.status, 429);
  assert.equal((await secondRead.json()).error.code, 'read_rate_limited');

  const firstCreate = await createSubscription(baseUrl, [SEQUENCER_A]);
  const secondCreate = await createSubscription(baseUrl, [SEQUENCER_A]);
  assert.equal(firstCreate.response.status, 201);
  assert.equal(secondCreate.response.status, 429);
  assert.equal(secondCreate.body.error.code, 'subscription_rate_limited');
});

function healthyRepository() {
  const repository = new OffenseRepository(':memory:');
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: NOW - 1_000, network: 'mainnet' });
  repository.recordSourceSuccess('l1', { blockNumber: '100' }, NOW - 1_000);
  repository.recordSourceSuccess('telegram', {}, NOW - 1_000);
  return repository;
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
    maxSequencers: 5,
    logger: silentLogger,
    now: () => NOW,
    ...overrides,
  });
  const address = await server.listen();
  t.after(async () => {
    await server.close();
    repository.close();
  });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function createSubscription(baseUrl, addresses) {
  return jsonRequest(`${baseUrl}/api/v2/subscriptions`, {
    method: 'POST',
    origin: ALLOWED_ORIGIN,
    body: { network: 'mainnet', addresses },
  });
}

function authenticatedJson(baseUrl, id, token, {
  path = '',
  method = 'GET',
  body,
} = {}) {
  return jsonRequest(`${baseUrl}/api/v2/subscriptions/${id}${path}`, {
    method,
    origin: ALLOWED_ORIGIN,
    token,
    body,
  });
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
