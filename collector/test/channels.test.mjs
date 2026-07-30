import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DeliveryError,
  TelegramChannel,
  TelegramClient,
  TelegramSendScheduler,
  WebPushChannel,
  notificationPath,
  parseRetryAfterMs,
} from '../src/channels.mjs';

const EVENT = {
  id: 'transition/with spaces',
  network: 'mainnet',
  type: 'onchain_targeted',
  severity: 'critical',
  title: 'Sequencer targeted',
  body: 'A confirmed payload targets 0x1111…1111.',
  targets: ['0x1111111111111111111111111111111111111111'],
  data: {
    caseId: 'case:mainnet:lineage:0x1111111111111111111111111111111111111111:24',
    chainId: 1,
    blockNumber: '25587802',
    payloadAddress: '0x2222222222222222222222222222222222222222',
    transactionHash: `0x${'34'.repeat(32)}`,
  },
};

test('WebPushChannel builds a scoped high-urgency payload and returns the provider id', async () => {
  let captured;
  const channel = new WebPushChannel({
    vapid: {
      subject: 'mailto:operator@example.com',
      publicKey: 'public',
      privateKey: 'private',
    },
    publicUrl: 'https://slashveto.example',
    timeoutMs: 3210,
    sendNotification: async (...args) => {
      captured = args;
      return { headers: { location: 'push-message-7' } };
    },
  });
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/example',
    keys: { p256dh: 'A'.repeat(65), auth: 'b'.repeat(22) },
  };

  const result = await channel.send({ endpointConfig: JSON.stringify(subscription), event: EVENT });

  assert.deepEqual(result, { providerMessageId: 'push-message-7' });
  assert.deepEqual(captured[0], subscription);
  const payload = JSON.parse(captured[1]);
  assert.equal(payload.title, EVENT.title);
  assert.equal(
    payload.body,
    'Sequencer: 0x1111111111111111111111111111111111111111\n' +
      'A confirmed payload targets 0x1111…1111.',
  );
  assert.equal(payload.data.caseId, EVENT.data.caseId);
  assert.equal(payload.data.url, notificationPath(EVENT));
  assert.doesNotMatch(payload.body, /https?:\/\//);
  assert.equal(
    payload.data.url,
    '?view=pingme&network=mainnet&case=case%3Amainnet%3Alineage%3A0x1111111111111111111111111111111111111111%3A24',
  );
  assert.equal(captured[2].vapidDetails.privateKey, 'private');
  assert.equal(captured[2].urgency, 'high');
  assert.equal(captured[2].TTL, 24 * 60 * 60);
  assert.equal(captured[2].timeout, 3210);
  assert.match(captured[2].topic, /^[A-Za-z0-9_-]{32}$/);
});

test('WebPushChannel classifies expired endpoints as permanent and provider pressure as retryable', async () => {
  const delivery = { endpointConfig: '{}', event: EVENT };
  for (const statusCode of [404, 410]) {
    const channel = new WebPushChannel({
      vapid: { subject: 'mailto:a@example.com', publicKey: 'public', privateKey: 'private' },
      publicUrl: 'https://slashveto.example',
      sendNotification: async () => { throw { statusCode, body: 'provider details must not escape' }; },
    });
    await assert.rejects(() => channel.send(delivery), (error) => {
      assert.equal(error instanceof DeliveryError, true);
      assert.equal(error.permanent, true);
      assert.equal(error.statusCode, statusCode);
      assert.equal(error.message, `Web Push returned HTTP ${statusCode}`);
      assert.doesNotMatch(error.message, /provider details/);
      return true;
    });
  }

  const throttled = new WebPushChannel({
    vapid: { subject: 'mailto:a@example.com', publicKey: 'public', privateKey: 'private' },
    publicUrl: 'https://slashveto.example',
    sendNotification: async () => { throw { statusCode: 429, headers: { 'Retry-After': '17' } }; },
  });
  await assert.rejects(() => throttled.send(delivery), (error) => {
    assert.equal(error.permanent, false);
    assert.equal(error.statusCode, 429);
    assert.equal(error.retryAfterMs, 17_000);
    return true;
  });

  const badVapid = new WebPushChannel({
    vapid: { subject: 'mailto:a@example.com', publicKey: 'public', privateKey: 'private' },
    publicUrl: 'https://slashveto.example',
    sendNotification: async () => { throw { statusCode: 401 }; },
  });
  await assert.rejects(() => badVapid.send(delivery), (error) => {
    assert.equal(error.permanent, false);
    assert.equal(error.scope, 'channel');
    assert.equal(error.statusCode, 401);
    return true;
  });

  const malformed = new WebPushChannel({
    vapid: { subject: 'mailto:a@example.com', publicKey: 'public', privateKey: 'private' },
    publicUrl: 'https://slashveto.example',
  });
  await assert.rejects(() => malformed.send({ endpointConfig: '{', event: EVENT }), (error) => {
    assert.equal(error.permanent, true);
    assert.match(error.message, /stored Web Push subscription is invalid/);
    return true;
  });
});

test('WebPushChannel stops awaiting the provider when delivery is aborted', async () => {
  const channel = new WebPushChannel({
    vapid: { subject: 'mailto:a@example.com', publicKey: 'public', privateKey: 'private' },
    publicUrl: 'https://slashveto.example',
    sendNotification: () => new Promise(() => {}),
  });
  const controller = new AbortController();
  const pending = channel.send({ endpointConfig: '{}', event: EVENT }, controller.signal);

  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(error instanceof DeliveryError, true);
    assert.equal(error.message, 'Web Push request failed');
    return true;
  });
});

test('Web Push Retry-After parsing accepts delta seconds and dates with defensive bounds', () => {
  const now = Date.parse('2026-07-21T12:00:00Z');
  assert.equal(parseRetryAfterMs('7', now), 7_000);
  assert.equal(parseRetryAfterMs('Tue, 21 Jul 2026 12:00:30 GMT', now), 30_000);
  assert.equal(parseRetryAfterMs('0', now), 1_000);
  assert.equal(parseRetryAfterMs('999999999999999999999', now), 24 * 60 * 60_000);
  assert.equal(parseRetryAfterMs('eventually', now), undefined);
});

test('TelegramClient sends bounded JSON requests without surfacing its bot token', async () => {
  const token = '123456:super-secret-token';
  const calls = [];
  const client = new TelegramClient({
    token,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse(200, { ok: true, result: { message_id: 42 } });
    },
  });

  const sent = await client.sendMessage(9_007_199_254_740_991n, 'x'.repeat(5_000));
  assert.deepEqual(sent, { message_id: 42 });
  assert.equal(calls[0].url.endsWith('/sendMessage'), true);
  assert.equal(calls[0].body.chat_id, '9007199254740991');
  assert.equal(calls[0].body.text.length, 4_096);
  assert.deepEqual(calls[0].body.link_preview_options, { is_disabled: true });

  const networkFailure = new TelegramClient({
    token,
    fetchImpl: async () => { throw new Error(`failed via https://api.telegram.org/bot${token}/sendMessage`); },
  });
  await assert.rejects(() => networkFailure.sendMessage('1', 'hello'), (error) => {
    assert.equal(error instanceof DeliveryError, true);
    assert.equal(error.message, 'Telegram sendMessage request failed');
    assert.doesNotMatch(error.message, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
});

test('TelegramClient classifies permanent chat errors and honors retry_after', async () => {
  const permanent = new TelegramClient({
    token: 'token',
    fetchImpl: async () => jsonResponse(403, {
      ok: false,
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    }),
  });
  await assert.rejects(() => permanent.sendMessage('1', 'hello'), (error) => {
    assert.equal(error.permanent, true);
    assert.equal(error.scope, 'endpoint');
    assert.equal(error.statusCode, 403);
    assert.equal(error.retryAfterMs, undefined);
    assert.equal(error.message, 'Telegram sendMessage returned error 403');
    return true;
  });

  const rejectedToken = new TelegramClient({
    token: 'invalid-token',
    fetchImpl: async () => jsonResponse(401, {
      ok: false,
      error_code: 401,
      description: 'Unauthorized',
    }),
  });
  await assert.rejects(() => rejectedToken.sendMessage('1', 'hello'), (error) => {
    assert.equal(error.permanent, true);
    assert.equal(error.scope, 'channel');
    assert.equal(error.statusCode, 401);
    assert.equal(error.message, 'Telegram sendMessage returned error 401');
    return true;
  });

  const throttled = new TelegramClient({
    token: 'token',
    fetchImpl: async () => jsonResponse(429, {
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 7 },
    }),
  });
  await assert.rejects(() => throttled.sendMessage('1', 'hello'), (error) => {
    assert.equal(error.permanent, false);
    assert.equal(error.statusCode, 429);
    assert.equal(error.retryAfterMs, 7_000);
    return true;
  });
});

test('Telegram send scheduling prioritizes alerts and paces each chat', async () => {
  const scheduler = new TelegramSendScheduler({
    maxPerSecond: 1,
    lowPriorityMaxPerSecond: 1,
    perChatIntervalMs: 10,
    rateWindowMs: 20,
  });
  await scheduler.acquire('seed');

  const order = [];
  const low = scheduler.acquire('low-chat', { priority: 'low' }).then(() => order.push('low'));
  const alert = scheduler.acquire('alert-chat').then(() => order.push('alert'));
  await Promise.all([low, alert]);
  assert.deepEqual(order, ['alert', 'low']);

  const chatScheduler = new TelegramSendScheduler({
    maxPerSecond: 10,
    lowPriorityMaxPerSecond: 10,
    perChatIntervalMs: 20,
    rateWindowMs: 5,
  });
  await chatScheduler.acquire('same-chat');
  const startedAt = Date.now();
  await chatScheduler.acquire('same-chat');
  assert.ok(Date.now() - startedAt >= 15);
});

test('TelegramClient long polling and TelegramChannel preserve routing semantics', async () => {
  let requestBody;
  const client = new TelegramClient({
    token: 'token',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse(200, { ok: true, result: [] });
    },
  });
  await client.getUpdates({ offset: 17, timeout: 30 });
  assert.deepEqual(requestBody, {
    offset: 17,
    timeout: 30,
    limit: 100,
    allowed_updates: ['message'],
  });

  let message;
  const channel = new TelegramChannel({
    publicUrl: 'https://slashveto.example/base/',
    client: {
      async sendMessage(chatId, text, _signal, options) {
        message = { chatId, text, options };
        return { message_id: 99 };
      },
    },
  });
  const result = await channel.send({ destination: '-100123', event: EVENT });
  assert.deepEqual(result, { providerMessageId: '99' });
  assert.equal(message.chatId, '-100123');
  assert.deepEqual(message.options, { priority: 'alert' });
  assert.match(message.text, /^🚨 Sequencer targeted/);
  assert.match(message.text, /Sequencer: 0x1111111111111111111111111111111111111111/);
  assert.match(message.text, /Case: https:\/\/slashveto\.example\/base\/\?view=pingme&network=mainnet&case=case%3Amainnet%3Alineage%3A0x1111111111111111111111111111111111111111%3A24/);
  assert.match(message.text, /Dashtec: https:\/\/dashtec\.xyz\/sequencers\/0x1111111111111111111111111111111111111111/);
  assert.match(message.text, /Transaction: https:\/\/etherscan\.io\/tx\/0x3434343434343434343434343434343434343434343434343434343434343434/);
  assert.doesNotMatch(message.text, /Etherscan block/);
  assert.doesNotMatch(message.text, /candidate payload/);
});

test('TelegramChannel keeps queued alerts retryable until the bot identity is validated', async () => {
  let ready = false;
  let sends = 0;
  const channel = new TelegramChannel({
    publicUrl: 'https://slashveto.example/',
    isReady: () => ready,
    client: {
      async sendMessage() {
        sends += 1;
        return { message_id: 7 };
      },
    },
  });

  await assert.rejects(() => channel.send({ destination: '42', event: EVENT }), (error) => {
    assert.equal(error instanceof DeliveryError, true);
    assert.equal(error.scope, 'channel');
    assert.match(error.message, /identity is not validated/);
    return true;
  });
  assert.equal(sends, 0);

  ready = true;
  assert.deepEqual(
    await channel.send({ destination: '42', event: EVENT }),
    { providerMessageId: '7' },
  );
  assert.equal(sends, 1);
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}
