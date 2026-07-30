import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  legacyAudienceStats,
  loadLegacyRecipients,
  parseArgs,
  telegramMessageParts,
  webPushBody,
} from '../scripts/notify-reset-watchers.mjs';
import { PUSH_KEYS, SEQUENCER_A, SEQUENCER_B } from './helpers.mjs';

const LEGACY_TABLES = [
  'deliveries',
  'event_targets',
  'events',
  'l1_slash_logs',
  'offenses',
  'onchain_rounds',
  'source_state',
  'sync_state',
  'telegram_link_tokens',
  'telegram_state',
  'validator_duties',
  'validator_epoch_performance',
  'validator_indexed_epochs',
];

test('legacy backup reader selects enabled Telegram and PWA channels with their watchlists', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-reset-test-'));
  const databasePath = path.join(directory, 'legacy.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE watchlists (
      id TEXT PRIMARY KEY,
      network TEXT NOT NULL
    );
    CREATE TABLE watchlist_addresses (
      watchlist_id TEXT NOT NULL,
      sequencer TEXT NOT NULL
    );
    CREATE TABLE delivery_endpoints (
      id TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      destination TEXT NOT NULL,
      config_json TEXT,
      enabled INTEGER NOT NULL
    );
    ${LEGACY_TABLES.map((table) => `CREATE TABLE ${table} (id TEXT);`).join('\n')}
    PRAGMA user_version = 3;
  `);
  database.prepare('INSERT INTO watchlists(id, network) VALUES (?, ?)')
    .run('watch-a', 'mainnet');
  const insertAddress = database.prepare(
    'INSERT INTO watchlist_addresses(watchlist_id, sequencer) VALUES (?, ?)',
  );
  insertAddress.run('watch-a', SEQUENCER_B);
  insertAddress.run('watch-a', SEQUENCER_A);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/legacy',
    expirationTime: null,
    keys: PUSH_KEYS,
  };
  const insertEndpoint = database.prepare(`
    INSERT INTO delivery_endpoints(
      id, watchlist_id, kind, destination, config_json, enabled
    ) VALUES (?, 'watch-a', ?, ?, ?, ?)
  `);
  insertEndpoint.run('telegram-active', 'telegram', '-42', null, 1);
  insertEndpoint.run(
    'push-active',
    'web_push',
    subscription.endpoint,
    JSON.stringify(subscription),
    1,
  );
  insertEndpoint.run('telegram-disabled', 'telegram', '43', null, 0);
  database.close();

  const recipients = loadLegacyRecipients(databasePath);

  assert.deepEqual(recipients.map(({ id }) => id), ['telegram-active', 'push-active']);
  assert.deepEqual(recipients[0].addresses, [SEQUENCER_A, SEQUENCER_B]);
  assert.equal(recipients[1].configJson, JSON.stringify(subscription));
});

test('legacy audience stats separate stored watches, reachable watches, and channel overlap', () => {
  const watches = [
    { id: 'one', network: 'mainnet', addresses: [SEQUENCER_A] },
    { id: 'two', network: 'mainnet', addresses: [SEQUENCER_A, SEQUENCER_B] },
    { id: 'three', network: 'testnet', addresses: [SEQUENCER_B] },
    { id: 'four', network: 'mainnet', addresses: [] },
  ];
  const recipients = [
    { watchlistId: 'one', kind: 'telegram' },
    { watchlistId: 'two', kind: 'telegram' },
    { watchlistId: 'two', kind: 'web_push' },
    { watchlistId: 'three', kind: 'web_push' },
  ];

  const stats = legacyAudienceStats(watches, recipients);

  assert.equal(stats.watches, 4);
  assert.equal(stats.activeWatches, 3);
  assert.equal(stats.inactiveWatches, 1);
  assert.equal(stats.telegramChats, 2);
  assert.equal(stats.pwaSubscriptions, 2);
  assert.deepEqual(stats.channelMix, { telegramOnly: 1, pwaOnly: 1, both: 1 });
  assert.equal(stats.uniqueSequencers, 3);
  assert.equal(stats.activeUniqueSequencers, 3);
  assert.equal(stats.associations, 4);
  assert.equal(stats.activeAssociations, 4);
  assert.deepEqual(stats.watchSize, { min: 0, median: 1, average: 1, max: 2 });
  assert.deepEqual(stats.activeWatchSize, { min: 1, median: 1, average: 4 / 3, max: 2 });
  assert.deepEqual(stats.networks, {
    mainnet: {
      watches: 3,
      activeWatches: 2,
      uniqueSequencers: 2,
      activeUniqueSequencers: 2,
    },
    testnet: {
      watches: 1,
      activeWatches: 1,
      uniqueSequencers: 1,
      activeUniqueSequencers: 1,
    },
  });
});

test('legacy backup reader rejects the new database schema', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-reset-test-'));
  const databasePath = path.join(directory, 'current.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE watches (id TEXT);
    PRAGMA application_id = 1397509454;
    PRAGMA user_version = 3;
  `);
  database.close();

  assert.throws(
    () => loadLegacyRecipients(databasePath),
    /not an exact slashveto\.me v2 backup/,
  );
});

test('Telegram announcement includes every address without exceeding its message limit', () => {
  const addresses = Array.from(
    { length: 100 },
    (_, index) => `0x${index.toString(16).padStart(40, '0')}`,
  );

  const parts = telegramMessageParts(
    { addresses, network: 'mainnet' },
    'https://slashveto.me',
  );

  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 4_096));
  assert.match(parts[0], /previous watch was reset/i);
  assert.match(parts[0], /https:\/\/slashveto\.me\/\?view=pingme&network=mainnet/);
  const included = parts.flatMap((part) => part.match(/0x[0-9a-f]{40}/g) ?? []);
  assert.deepEqual(included, addresses);
});

test('PWA announcement includes complete small lists and counts omitted large-list addresses', () => {
  const small = webPushBody({ addresses: [SEQUENCER_A, SEQUENCER_B] });
  assert.match(small, new RegExp(SEQUENCER_A));
  assert.match(small, new RegExp(SEQUENCER_B));
  assert.doesNotMatch(small, /more/);

  const addresses = Array.from(
    { length: 100 },
    (_, index) => `0x${index.toString(16).padStart(40, '0')}`,
  );
  const large = webPushBody({ addresses });
  const included = large.match(/0x[0-9a-f]{40}/g) ?? [];
  assert.ok(included.length > 0 && included.length < addresses.length);
  assert.match(large, new RegExp(`…and ${addresses.length - included.length} more$`));
  assert.ok(large.length <= 600);
});

test('reset announcement arguments are safe by default and accept a bounded canary', () => {
  assert.deepEqual(parseArgs(['--database', '/backup.sqlite']), {
    database: '/backup.sqlite',
    state: null,
    channel: 'all',
    limit: Number.POSITIVE_INFINITY,
    send: false,
  });
  assert.deepEqual(
    parseArgs([
      '--database',
      '/backup.sqlite',
      '--channel',
      'pwa',
      '--limit',
      '1',
      '--send',
    ]),
    {
      database: '/backup.sqlite',
      state: null,
      channel: 'web_push',
      limit: 1,
      send: true,
    },
  );
  assert.throws(() => parseArgs(['--database', '/backup.sqlite', '--limit', '0']));
});
