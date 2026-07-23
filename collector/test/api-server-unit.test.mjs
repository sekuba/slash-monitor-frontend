import assert from 'node:assert/strict';
import test from 'node:test';

import { CollectorApiServer } from '../src/api-server.mjs';
import { OffenseRepository } from '../src/database.mjs';
import { createOpaqueToken, hashToken } from '../src/security.mjs';
import { SEQUENCER_A } from './helpers.mjs';

test('Telegram configuration and links are gated by runtime bot identity readiness', async () => {
  const repository = new OffenseRepository(':memory:');
  const managementToken = createOpaqueToken();
  repository.createWatchlist({
    id: '11111111-1111-4111-8111-111111111111',
    managementTokenHash: hashToken(managementToken),
    network: 'mainnet',
    addresses: [SEQUENCER_A],
    now: 1,
  });
  let ready = false;
  const api = createApi(repository, {
    telegramBotUsername: 'slashmon_test_bot',
    isTelegramReady: () => ready,
  });
  try {
    const unavailableConfig = responseRecorder();
    await api.handleV2(
      'GET',
      new URL('http://slashmon.local/api/v2/config'),
      { headers: {} },
      unavailableConfig,
    );
    assert.equal(unavailableConfig.json().telegramBotUsername, null);

    const request = { headers: { authorization: `Bearer ${managementToken}` } };
    const linkUrl = new URL(
      'http://slashmon.local/api/v2/subscriptions/11111111-1111-4111-8111-111111111111/channels/telegram-link',
    );
    await assert.rejects(
      () => api.handleV2('POST', linkUrl, request, responseRecorder()),
      (error) => error.code === 'telegram_unavailable' && error.status === 503,
    );

    ready = true;
    const availableConfig = responseRecorder();
    await api.handleV2(
      'GET',
      new URL('http://slashmon.local/api/v2/config'),
      { headers: {} },
      availableConfig,
    );
    assert.equal(availableConfig.json().telegramBotUsername, 'slashmon_test_bot');
    const link = responseRecorder();
    await api.handleV2('POST', linkUrl, request, link);
    assert.equal(link.status, 201);
    assert.equal(new URL(link.json().url).pathname, '/slashmon_test_bot');
  } finally {
    repository.close();
  }
});

test('a shared Web Push authentication failure degrades channel health', () => {
  const repository = new OffenseRepository(':memory:');
  repository.recordSourceFailure('web_push', 'Web Push returned HTTP 401', 10);
  const api = createApi(repository, { vapidPublicKey: 'public-key', now: () => 10 });
  try {
    const health = api.buildHealth().body;
    assert.equal(health.sources.webPush.status, 'degraded');
    assert.equal(health.sources.webPush.errorClass, 'upstream_error');
    assert.equal(health.delivery.status, 'degraded');
  } finally {
    repository.close();
  }
});

test('sentinel failures degrade the combined Aztec source after indexing has started', () => {
  const repository = new OffenseRepository(':memory:');
  repository.recordSuccessfulPoll([], { observedAt: 900, network: 'mainnet' });
  repository.recordSourceSuccess('aztec_sentinel', { lastProcessedSlot: '10' }, 900);
  repository.recordSourceFailure('aztec_sentinel', 'sentinel unavailable', 1_000);
  const api = createApi(repository);
  try {
    const health = api.buildHealth().body;
    assert.equal(health.sources.aztec.status, 'degraded');
    assert.equal(health.sources.aztecSentinel.status, 'degraded');
    assert.equal(health.sources.aztecOffenses.status, 'healthy');
  } finally {
    repository.close();
  }
});

function createApi(repository, overrides = {}) {
  return new CollectorApiServer({
    repository,
    host: '127.0.0.1',
    port: 0,
    corsOrigin: 'http://localhost:5173',
    staleAfterMs: 60_000,
    network: 'mainnet',
    logger: { info() {}, error() {} },
    now: () => 1_000,
    ...overrides,
  });
}

function responseRecorder() {
  return {
    status: null,
    body: '',
    writeHead(status) {
      this.status = status;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}
