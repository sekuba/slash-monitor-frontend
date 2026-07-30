import assert from 'node:assert/strict';
import test from 'node:test';

import { TelegramBot } from '../src/telegram-bot.mjs';
import { DeliveryError } from '../src/channels.mjs';
import { hashToken } from '../src/security.mjs';
import { SEQUENCER_A, SEQUENCER_B } from './helpers.mjs';

const LINK_TOKEN = 'A'.repeat(43);

test('TelegramBot consumes an opaque deep link without exposing it in the reply', async () => {
  let consumed;
  let sent;
  const repository = {
    consumeTelegramLink(tokenHash, chatId, now) {
      consumed = { tokenHash, chatId, now };
      return { network: 'mainnet', addresses: [SEQUENCER_A, SEQUENCER_B] };
    },
  };
  const bot = new TelegramBot({
    repository,
    network: 'mainnet',
    logger: recordingLogger(),
    now: () => 50_000,
    client: {
      async sendMessage(chatId, text) {
        sent = { chatId, text };
      },
    },
  });

  await bot.processUpdate(privateMessage(1, `/start ${LINK_TOKEN}`, '9007199254740991'));

  assert.deepEqual(consumed, {
    tokenHash: hashToken(LINK_TOKEN),
    chatId: '9007199254740991',
    now: 50_000,
  });
  assert.equal(sent.chatId, '9007199254740991');
  assert.match(sent.text, /Linked\. Watching 2 sequencers on mainnet/);
  assert.match(sent.text, new RegExp(SEQUENCER_A));
  assert.doesNotMatch(sent.text, new RegExp(LINK_TOKEN));
});

test('TelegramBot silently rejects malformed and consumed links so strangers cannot spend send quota', async () => {
  let consumeCalls = 0;
  const replies = [];
  const repository = {
    consumeTelegramLink() {
      consumeCalls += 1;
      return null;
    },
  };
  const bot = new TelegramBot({
    repository,
    network: 'mainnet',
    logger: recordingLogger(),
    client: {
      async sendMessage(_chatId, text) {
        replies.push(text);
      },
    },
  });

  await bot.processUpdate(privateMessage(1, '/start short'));
  await bot.processUpdate(privateMessage(2, `/start ${LINK_TOKEN}`));

  assert.equal(consumeCalls, 1);
  assert.deepEqual(replies, []);
});

test('TelegramBot persists the update offset after a durable command even if its reply fails', async () => {
  const calls = [];
  let offset = 17;
  let bot;
  const logger = recordingLogger();
  const repository = {
    recordSourceAttempt(...args) {
      calls.push(['attempt', ...args]);
    },
    getTelegramOffset() {
      return offset;
    },
    setTelegramOffset(value) {
      offset = value;
      calls.push(['offset', value]);
    },
    recordSourceSuccess(...args) {
      calls.push(['success', ...args]);
    },
    recordSourceFailure(...args) {
      calls.push(['failure', ...args]);
    },
    setTelegramEndpointEnabled(chatId, enabled, now) {
      calls.push(['enabled', chatId, enabled, now]);
      return true;
    },
    getWatchByTelegramChat() {
      return {
        network: 'mainnet',
        addresses: [SEQUENCER_A],
        telegramEnabled: true,
      };
    },
  };
  const client = {
    async getMe() {
      calls.push(['get-me']);
      return { username: 'slashveto_bot' };
    },
    async deleteWebhook() {
      calls.push(['delete-webhook']);
    },
    async getUpdates(options) {
      calls.push(['get-updates', options.offset, options.timeout]);
      bot.running = false;
      return [privateMessage(23, '/pause', '-100123')];
    },
    async sendMessage() {
      throw new Error('reply transport failed');
    },
  };
  bot = new TelegramBot({
    repository,
    client,
    network: 'mainnet',
    expectedUsername: 'slashveto_bot',
    pollTimeoutSeconds: 31,
    logger,
    now: () => 99_000,
  });

  bot.running = true;
  await bot.runLoop();

  assert.equal(offset, 24);
  assert.deepEqual(calls.slice(0, 6), [
    ['get-me'],
    ['delete-webhook'],
    ['attempt', 'telegram', 99_000],
    ['get-updates', 17, 31],
    ['enabled', '-100123', false, 99_000],
    ['offset', 24],
  ]);
  assert.deepEqual(calls[6], ['success', 'telegram', { offset: 24 }, 99_000]);
  assert.equal(calls.some(([kind]) => kind === 'failure'), false);
  assert.equal(logger.records.some((record) => record.message === 'Telegram command reply failed'), true);
});

test('TelegramBot isolates a different bot identity without taking down other workers', async () => {
  let webhookDeleted = false;
  const readiness = [];
  const failures = [];
  const logger = recordingLogger();
  const bot = new TelegramBot({
    repository: {
      recordSourceFailure(...args) {
        failures.push(args);
      },
    },
    network: 'mainnet',
    expectedUsername: 'slashveto_bot',
    logger,
    onReadinessChange: (ready) => readiness.push(ready),
    now: () => 123_000,
    client: {
      async getMe() {
        return { username: 'some_other_bot' };
      },
      async deleteWebhook() {
        webhookDeleted = true;
      },
    },
  });

  bot.running = true;
  bot.sleep = async () => { bot.running = false; };
  await bot.removeWebhookWithRetry();

  assert.equal(webhookDeleted, false);
  assert.deepEqual(readiness, [false]);
  assert.deepEqual(failures, [[
    'telegram',
    'Telegram token belongs to @some_other_bot, expected @slashveto_bot',
    123_000,
  ]]);
  assert.equal(logger.records.some((record) => (
    record.level === 'error' && record.message.includes('identity mismatch')
  )), true);
});

test('TelegramBot opens the delivery gate only after identity and long-poll setup succeed', async () => {
  const readiness = [];
  const bot = new TelegramBot({
    repository: {},
    network: 'mainnet',
    expectedUsername: 'slashveto_bot',
    logger: recordingLogger(),
    onReadinessChange: (ready) => readiness.push(ready),
    client: {
      async getMe() {
        return { username: 'slashveto_bot' };
      },
      async deleteWebhook() {},
    },
  });

  bot.running = true;
  await bot.removeWebhookWithRetry();
  assert.deepEqual(readiness, [true]);
});

test('TelegramBot keeps a rejected token isolated as unhealthy channel state', async () => {
  const failures = [];
  const bot = new TelegramBot({
    repository: {
      recordSourceFailure(...args) {
        failures.push(args);
      },
    },
    network: 'mainnet',
    expectedUsername: 'slashveto_bot',
    logger: recordingLogger(),
    now: () => 123_000,
    client: {
      async getMe() {
        throw new DeliveryError('Telegram getMe returned error 401', {
          permanent: true,
          scope: 'channel',
          statusCode: 401,
        });
      },
    },
  });

  bot.running = true;
  bot.sleep = async () => {
    bot.running = false;
  };
  await bot.removeWebhookWithRetry();

  assert.deepEqual(failures, [[
    'telegram',
    'Telegram getMe returned error 401',
    123_000,
  ]]);
});

test('TelegramBot ignores non-private commands', async () => {
  let sent = false;
  const bot = new TelegramBot({
    repository: {},
    network: 'mainnet',
    logger: recordingLogger(),
    client: {
      async sendMessage() {
        sent = true;
      },
    },
  });

  await bot.processUpdate({
    update_id: 1,
    message: { text: '/delete', chat: { id: -100, type: 'group' } },
  });
  assert.equal(sent, false);
});

test('TelegramBot ignores unlinked chatter, unknown commands, and reply floods', async () => {
  const sent = [];
  let linked = false;
  let now = 10_000;
  const bot = new TelegramBot({
    repository: {
      getWatchByTelegramChat() {
        return linked ? {
          network: 'mainnet',
          addresses: [SEQUENCER_A],
          telegramEnabled: true,
        } : null;
      },
    },
    network: 'mainnet',
    logger: recordingLogger(),
    now: () => now,
    client: {
      async sendMessage(chatId, text) {
        sent.push({ chatId, text });
      },
    },
  });

  await bot.processUpdate(privateMessage(1, 'hello'));
  await bot.processUpdate(privateMessage(2, '/help'));
  linked = true;
  await bot.processUpdate(privateMessage(3, 'hello'));
  await bot.processUpdate(privateMessage(4, '/help'));
  await bot.processUpdate(privateMessage(5, '/help'));
  assert.equal(sent.length, 1);

  now += 2_000;
  await bot.processUpdate(privateMessage(6, '/help'));
  assert.equal(sent.length, 2);
});

function privateMessage(updateId, text, chatId = '42') {
  return {
    update_id: updateId,
    message: {
      text,
      chat: { id: chatId, type: 'private' },
    },
  };
}

function recordingLogger() {
  const records = [];
  return {
    records,
    debug(message, data) { records.push({ level: 'debug', message, data }); },
    info(message, data) { records.push({ level: 'info', message, data }); },
    warn(message, data) { records.push({ level: 'warn', message, data }); },
    error(message, data) { records.push({ level: 'error', message, data }); },
  };
}
