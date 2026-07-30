#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  DeliveryError,
  TelegramClient,
  WebPushChannel,
} from '../src/channels.mjs';
import { InputError, parsePushSubscription } from '../src/security.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const TELEGRAM_CHAT = /^-?[1-9][0-9]*$/;
const LEGACY_SCHEMA_VERSION = 3;
const LEGACY_TABLES = new Set([
  'deliveries',
  'delivery_endpoints',
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
  'watchlist_addresses',
  'watchlists',
]);
const TELEGRAM_MESSAGE_LIMIT = 4_096;
const WEB_PUSH_BODY_LIMIT = 600;
const MAX_SEND_ATTEMPTS = 3;
const STATE_SCHEMA_VERSION = 1;

export function parseArgs(argv) {
  const options = {
    database: null,
    state: null,
    channel: 'all',
    limit: Number.POSITIVE_INFINITY,
    send: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--database') {
      options.database = requiredValue(argv, ++index, argument);
    } else if (argument === '--state') {
      options.state = requiredValue(argv, ++index, argument);
    } else if (argument === '--channel') {
      const value = requiredValue(argv, ++index, argument);
      if (!['all', 'telegram', 'pwa', 'web-push'].includes(value)) {
        throw new Error('--channel must be all, telegram, or pwa');
      }
      options.channel = value === 'pwa' || value === 'web-push' ? 'web_push' : value;
    } else if (argument === '--limit') {
      const value = requiredValue(argv, ++index, argument);
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error('--limit must be a positive integer');
      }
      options.limit = Number(value);
    } else if (argument === '--send') {
      options.send = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.help && !options.database) {
    throw new Error('--database is required');
  }
  return options;
}

export function loadLegacyRecipients(databasePath) {
  return loadLegacyBackup(databasePath).recipients;
}

export function loadLegacyBackup(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec('PRAGMA query_only = ON');
    validateLegacyDatabase(database);
    const addressQuery = database.prepare(`
      SELECT sequencer FROM watchlist_addresses
      WHERE watchlist_id = ? ORDER BY sequencer
    `);
    const watches = database.prepare(`
      SELECT id, network FROM watchlists ORDER BY id
    `).all().map((row) => {
      const addresses = addressQuery.all(row.id)
        .map(({ sequencer }) => String(sequencer).toLowerCase());
      validateLegacyWatch({ ...row, addresses });
      return {
        id: String(row.id),
        network: String(row.network),
        addresses,
      };
    });
    const watchesById = new Map(watches.map((watch) => [watch.id, watch]));
    const rows = database.prepare(`
      SELECT endpoint.id, endpoint.watchlist_id AS watchlistId,
        endpoint.kind, endpoint.destination, endpoint.config_json AS configJson,
        watchlist.network
      FROM delivery_endpoints endpoint
      JOIN watchlists watchlist ON watchlist.id = endpoint.watchlist_id
      WHERE endpoint.enabled = 1
        AND endpoint.kind IN ('telegram', 'web_push')
      ORDER BY endpoint.kind, endpoint.id
    `).all();
    const recipients = rows.map((row) => {
      const watch = watchesById.get(String(row.watchlistId));
      if (!watch) throw new Error('The v2 backup contains an endpoint without a watchlist');
      validateLegacyRecipient({ ...row, addresses: watch.addresses });
      return {
        id: String(row.id),
        watchlistId: String(row.watchlistId),
        kind: String(row.kind),
        destination: String(row.destination),
        configJson: row.configJson === null ? null : String(row.configJson),
        network: String(row.network),
        addresses: watch.addresses,
      };
    });
    return { watches, recipients };
  } finally {
    database.close();
  }
}

export function legacyAudienceStats(watches, recipients) {
  const channelsByWatch = new Map();
  for (const recipient of recipients) {
    const channels = channelsByWatch.get(recipient.watchlistId) ?? new Set();
    channels.add(recipient.kind);
    channelsByWatch.set(recipient.watchlistId, channels);
  }
  const activeWatches = watches.filter((watch) => channelsByWatch.has(watch.id));
  const channelMix = { telegramOnly: 0, pwaOnly: 0, both: 0 };
  for (const channels of channelsByWatch.values()) {
    if (channels.has('telegram') && channels.has('web_push')) channelMix.both += 1;
    else if (channels.has('telegram')) channelMix.telegramOnly += 1;
    else if (channels.has('web_push')) channelMix.pwaOnly += 1;
  }
  const watchSizes = watches.map((watch) => watch.addresses.length).sort((left, right) => left - right);
  const activeWatchSizes = activeWatches
    .map((watch) => watch.addresses.length)
    .sort((left, right) => left - right);
  const networks = {};
  for (const network of [...new Set(watches.map((watch) => watch.network))].sort()) {
    const networkWatches = watches.filter((watch) => watch.network === network);
    const networkActiveWatches = activeWatches.filter((watch) => watch.network === network);
    networks[network] = {
      watches: networkWatches.length,
      activeWatches: networkActiveWatches.length,
      uniqueSequencers: uniqueSequencers(networkWatches),
      activeUniqueSequencers: uniqueSequencers(networkActiveWatches),
    };
  }
  return {
    watches: watches.length,
    activeWatches: activeWatches.length,
    inactiveWatches: watches.length - activeWatches.length,
    telegramChats: recipients.filter(({ kind }) => kind === 'telegram').length,
    pwaSubscriptions: recipients.filter(({ kind }) => kind === 'web_push').length,
    channelMix,
    uniqueSequencers: uniqueSequencers(watches),
    activeUniqueSequencers: uniqueSequencers(activeWatches),
    associations: watchSizes.reduce((total, size) => total + size, 0),
    activeAssociations: activeWatchSizes.reduce((total, size) => total + size, 0),
    watchSize: distribution(watchSizes),
    activeWatchSize: distribution(activeWatchSizes),
    networks,
  };
}

export function telegramMessageParts({ addresses, network }, publicUrl) {
  const url = watchUrl(publicUrl, network);
  const noun = addresses.length === 1 ? 'sequencer' : 'sequencers';
  const firstHeader = [
    '🔔 Recreate your slashveto.me watch',
    '',
    'Slashveto.me was upgraded and your previous watch was reset. ' +
      'Recreate it to resume alerts:',
    url,
    '',
    `Previous watchlist (${addresses.length} ${noun}):`,
  ].join('\n');
  const continuedHeader = 'Previous watchlist (continued):';
  return chunkLines(firstHeader, continuedHeader, addresses, TELEGRAM_MESSAGE_LIMIT);
}

export function webPushBody({ addresses }) {
  const noun = addresses.length === 1 ? 'sequencer' : 'sequencers';
  const header = [
    'Slashveto.me was upgraded and your previous watch was reset. ' +
      'Recreate it to resume alerts.',
    '',
    `Previous watchlist (${addresses.length} ${noun}):`,
  ].join('\n');
  const included = [];
  for (const address of addresses) {
    const remaining = addresses.length - included.length - 1;
    const suffix = remaining > 0 ? `\n…and ${remaining} more` : '';
    const candidate = [header, ...included, address].join('\n') + suffix;
    if (candidate.length > WEB_PUSH_BODY_LIMIT) break;
    included.push(address);
  }
  const remaining = addresses.length - included.length;
  return [
    header,
    ...included,
    ...(remaining > 0 ? [`…and ${remaining} more`] : []),
  ].join('\n').slice(0, WEB_PUSH_BODY_LIMIT);
}

export async function run(options, {
  env = process.env,
  output = console,
  now = Date.now,
} = {}) {
  const databasePath = fs.realpathSync(options.database);
  const identity = databaseIdentity(databasePath);
  const statePath = path.resolve(options.state ?? `${databasePath}.reset-announcement.json`);
  const backup = loadLegacyBackup(databasePath);
  const audience = legacyAudienceStats(backup.watches, backup.recipients);
  const recipients = backup.recipients
    .filter((recipient) => options.channel === 'all' || recipient.kind === options.channel);
  const state = loadState(statePath, identity);
  const completed = recipients.filter((recipient) => isCompleted(state, recipient)).length;
  const pending = recipients.filter((recipient) => !isCompleted(state, recipient));
  const selected = pending.slice(0, options.limit);

  printAudienceSummary(output, audience);
  output.log('');
  output.log('Delivery selection');
  output.log(`  Selected channels: ${recipients.length} (${counts(recipients)})`);
  output.log(`  Already handled: ${completed}`);
  output.log(`  Pending: ${pending.length}`);
  output.log(`  Selected this run: ${selected.length}`);
  if (!options.send) {
    output.log('Dry run only. Add --send to deliver the announcement.');
    return { recipients: recipients.length, completed, pending: pending.length, selected: selected.length };
  }
  if (selected.length === 0) {
    output.log('No pending channels selected.');
    return { recipients: recipients.length, sent: 0, unreachable: 0, failed: 0 };
  }

  const publicUrl = requiredPublicUrl(env.SLASHMON_PUBLIC_URL);
  const channels = createChannels(selected, env, publicUrl);
  initializeState(statePath, state, identity);
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Announcement interrupted'));
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);

  let sent = 0;
  let unreachable = 0;
  let failed = 0;
  const blockedChannels = new Set();
  try {
    if (channels.telegram) {
      try {
        await channels.telegram.getMe(controller.signal);
      } catch (error) {
        blockedChannels.add('telegram');
        output.error(`Telegram preflight failed: ${safeErrorMessage(error)}`);
      }
    }

    for (const [index, recipient] of selected.entries()) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const label = recipient.kind === 'telegram' ? 'Telegram' : 'PWA';
      if (blockedChannels.has(recipient.kind)) {
        failed += 1;
        continue;
      }
      try {
        await sendRecipient(recipient, channels, publicUrl, controller.signal, {
          state,
          statePath,
          identity,
          now,
        });
        sent += 1;
        output.log(`[${index + 1}/${selected.length}] ${label} sent ` +
          `(${recipient.addresses.length} sequencer${recipient.addresses.length === 1 ? '' : 's'})`);
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (isPermanentEndpointError(error)) {
          markState(state, recipient, {
            status: 'unreachable',
            completedAt: new Date(now()).toISOString(),
            statusCode: Number(error.statusCode) || null,
          });
          saveState(statePath, state, identity);
          unreachable += 1;
          output.warn(`[${index + 1}/${selected.length}] ${label} is no longer reachable`);
        } else {
          failed += 1;
          if (error instanceof DeliveryError && error.scope === 'channel') {
            blockedChannels.add(recipient.kind);
          }
          output.error(`[${index + 1}/${selected.length}] ${label} failed: ${safeErrorMessage(error)}`);
        }
      }
    }
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }

  const skippedForBlockedChannel = selected.filter(
    (recipient) => blockedChannels.has(recipient.kind) && !isCompleted(state, recipient),
  ).length;
  failed = Math.max(failed, skippedForBlockedChannel);
  output.log(`Finished: ${sent} sent, ${unreachable} unreachable, ${failed} pending after errors.`);
  if (failed > 0) process.exitCode = 1;
  return { recipients: recipients.length, sent, unreachable, failed };
}

async function sendRecipient(recipient, channels, publicUrl, signal, context) {
  if (recipient.kind === 'telegram') {
    const parts = telegramMessageParts(recipient, publicUrl);
    const previous = context.state.records[recipient.id];
    const firstPart = previous?.status === 'partial'
      ? Math.min(Number(previous.partsSent) || 0, parts.length)
      : 0;
    for (let index = firstPart; index < parts.length; index += 1) {
      await withRetries(
        () => channels.telegram.sendMessage(
          recipient.destination,
          parts[index],
          signal,
          { priority: 'low' },
        ),
        signal,
      );
      markState(context.state, recipient, {
        status: 'partial',
        partsSent: index + 1,
      });
      saveState(context.statePath, context.state, context.identity);
    }
  } else {
    const subscription = parsePushSubscription(parseJson(recipient.configJson));
    if (subscription.endpoint !== recipient.destination) {
      throw new InputError('invalid_push_subscription', 'Stored Web Push endpoint does not match');
    }
    await withRetries(() => channels.web_push.send({
      endpointConfig: JSON.stringify(subscription),
      event: {
        id: `watch-reset:${recipient.id}`,
        network: recipient.network,
        source: 'migration',
        severity: 'info',
        title: 'Recreate your slashveto.me watch',
        body: webPushBody(recipient),
        targets: [],
        data: {},
      },
    }, signal), signal);
  }
  markState(context.state, recipient, {
    status: 'sent',
    completedAt: new Date(context.now()).toISOString(),
  });
  saveState(context.statePath, context.state, context.identity);
}

async function withRetries(action, signal) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (
        signal.aborted ||
        isPermanentEndpointError(error) ||
        (error instanceof DeliveryError && error.scope === 'channel') ||
        attempt === MAX_SEND_ATTEMPTS
      ) {
        throw error;
      }
      const retryAfterMs = error instanceof DeliveryError && error.retryAfterMs
        ? error.retryAfterMs
        : 1_000 * 2 ** (attempt - 1);
      await abortableDelay(Math.min(30_000, retryAfterMs), signal);
    }
  }
  throw lastError;
}

function createChannels(recipients, env, publicUrl) {
  const kinds = new Set(recipients.map(({ kind }) => kind));
  const channels = {};
  if (kinds.has('telegram')) {
    if (!String(env.TELEGRAM_BOT_TOKEN ?? '').trim()) {
      throw new Error('TELEGRAM_BOT_TOKEN is required for selected Telegram chats');
    }
    channels.telegram = new TelegramClient({ token: env.TELEGRAM_BOT_TOKEN.trim() });
  }
  if (kinds.has('web_push')) {
    const vapid = {
      subject: String(env.VAPID_SUBJECT ?? '').trim(),
      publicKey: String(env.VAPID_PUBLIC_KEY ?? '').trim(),
      privateKey: String(env.VAPID_PRIVATE_KEY ?? '').trim(),
    };
    if (Object.values(vapid).some((value) => !value)) {
      throw new Error(
        'VAPID_SUBJECT, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY are required for selected PWA channels',
      );
    }
    channels.web_push = new WebPushChannel({ vapid, publicUrl });
  }
  return channels;
}

function validateLegacyDatabase(database) {
  const quickCheck = String(database.prepare('PRAGMA quick_check').get().quick_check);
  if (quickCheck !== 'ok') throw new Error(`Legacy database quick check failed: ${quickCheck}`);
  const applicationId = Number(database.prepare('PRAGMA application_id').get().application_id);
  const version = Number(database.prepare('PRAGMA user_version').get().user_version);
  const tables = new Set(database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map(({ name }) => String(name)));
  if (
    applicationId !== 0 ||
    version !== LEGACY_SCHEMA_VERSION ||
    !sameValues(tables, LEGACY_TABLES)
  ) {
    throw new Error(
      'The supplied database is not an exact slashveto.me v2 backup ' +
      `(application ${applicationId}, schema ${version}, ${tables.size} tables)`,
    );
  }
  assertColumns(database, 'watchlists', [
    'id',
    'network',
  ]);
  assertColumns(database, 'watchlist_addresses', [
    'watchlist_id',
    'sequencer',
  ]);
  assertColumns(database, 'delivery_endpoints', [
    'id',
    'watchlist_id',
    'kind',
    'destination',
    'config_json',
    'enabled',
  ]);
}

function assertColumns(database, table, required) {
  const columns = new Set(database.prepare(`PRAGMA table_info(${table})`).all()
    .map(({ name }) => String(name)));
  for (const column of required) {
    if (!columns.has(column)) {
      throw new Error(`The v2 backup is missing ${table}.${column}`);
    }
  }
}

function validateLegacyRecipient(recipient) {
  if (!['telegram', 'web_push'].includes(String(recipient.kind))) {
    throw new Error('The v2 backup contains an unsupported channel');
  }
  if (!['mainnet', 'testnet'].includes(String(recipient.network))) {
    throw new Error('The v2 backup contains an unsupported network');
  }
  if (!recipient.addresses.every((address) => ADDRESS.test(address))) {
    throw new Error('The v2 backup contains a malformed sequencer address');
  }
  if (recipient.kind === 'telegram' && !TELEGRAM_CHAT.test(String(recipient.destination))) {
    throw new Error('The v2 backup contains a malformed Telegram chat ID');
  }
}

function validateLegacyWatch(watch) {
  if (!['mainnet', 'testnet'].includes(String(watch.network))) {
    throw new Error('The v2 backup contains an unsupported network');
  }
  if (!watch.addresses.every((address) => ADDRESS.test(address))) {
    throw new Error('The v2 backup contains a malformed sequencer address');
  }
}

function chunkLines(firstHeader, continuedHeader, lines, limit) {
  const chunks = [];
  let current = firstHeader;
  for (const line of lines) {
    if (`${current}\n${line}`.length <= limit) {
      current += `\n${line}`;
      continue;
    }
    chunks.push(current);
    current = `${continuedHeader}\n${line}`;
    if (current.length > limit) throw new Error('A watchlist line exceeds Telegram limits');
  }
  chunks.push(current);
  return chunks;
}

function watchUrl(publicUrl, network) {
  const url = new URL(publicUrl);
  url.hash = '';
  url.searchParams.set('view', 'pingme');
  url.searchParams.set('network', network);
  return url.toString();
}

function requiredPublicUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('SLASHMON_PUBLIC_URL is required');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('SLASHMON_PUBLIC_URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('SLASHMON_PUBLIC_URL must be an absolute HTTP(S) URL');
  }
  return url.toString();
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new InputError('invalid_push_subscription', 'Stored Web Push subscription is invalid');
  }
}

function isPermanentEndpointError(error) {
  return error instanceof InputError ||
    (error instanceof DeliveryError && error.permanent && error.scope !== 'channel');
}

function safeErrorMessage(error) {
  if (error instanceof DeliveryError || error instanceof InputError) return error.message;
  return error instanceof Error ? error.message : 'Unknown delivery error';
}

function abortableDelay(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function databaseIdentity(databasePath) {
  const stat = fs.statSync(databasePath);
  if (!stat.isFile()) throw new Error('The database path is not a regular file');
  return {
    path: databasePath,
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
  };
}

function loadState(statePath, identity) {
  if (!fs.existsSync(statePath)) {
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      database: identity,
      records: {},
    };
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    throw new Error(`Announcement state is not valid JSON: ${statePath}`);
  }
  if (
    state?.schemaVersion !== STATE_SCHEMA_VERSION ||
    !sameIdentity(state.database, identity) ||
    !state.records ||
    typeof state.records !== 'object' ||
    Array.isArray(state.records)
  ) {
    throw new Error(`Announcement state does not belong to this backup: ${statePath}`);
  }
  return state;
}

function initializeState(statePath, state, identity) {
  if (!fs.existsSync(statePath)) saveState(statePath, state, identity);
}

function saveState(statePath, state, identity) {
  state.schemaVersion = STATE_SCHEMA_VERSION;
  state.database = identity;
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, statePath);
}

function markState(state, recipient, update) {
  state.records[recipient.id] = {
    kind: recipient.kind,
    ...update,
  };
}

function isCompleted(state, recipient) {
  const record = state.records[recipient.id];
  return record?.kind === recipient.kind && ['sent', 'unreachable'].includes(record.status);
}

function sameIdentity(left, right) {
  return left?.path === right.path &&
    Number(left?.size) === right.size &&
    Number(left?.mtimeMs) === right.mtimeMs;
}

function sameValues(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function counts(recipients) {
  const telegram = recipients.filter(({ kind }) => kind === 'telegram').length;
  const pwa = recipients.length - telegram;
  return `${telegram} Telegram, ${pwa} PWA`;
}

function uniqueSequencers(watches) {
  return new Set(
    watches.flatMap((watch) => watch.addresses.map((address) => `${watch.network}:${address}`)),
  ).size;
}

function distribution(values) {
  if (values.length === 0) return { min: 0, median: 0, average: 0, max: 0 };
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
  return {
    min: values[0],
    median,
    average: values.reduce((total, value) => total + value, 0) / values.length,
    max: values.at(-1),
  };
}

function printAudienceSummary(output, stats) {
  output.log('Legacy audience');
  output.log(`  Watches (user proxy): ${stats.watches}`);
  output.log(`  Watches with an active channel: ${stats.activeWatches}`);
  output.log(`  Watches without an active channel: ${stats.inactiveWatches}`);
  output.log(`  Telegram chats: ${stats.telegramChats}`);
  output.log(`  PWA subscriptions: ${stats.pwaSubscriptions}`);
  output.log(
    `  Channel mix: ${stats.channelMix.telegramOnly} Telegram only, ` +
    `${stats.channelMix.pwaOnly} PWA only, ${stats.channelMix.both} both`,
  );
  output.log('');
  output.log('Sequencer coverage');
  output.log(`  Unique sequencers: ${stats.uniqueSequencers}`);
  output.log(`  Unique sequencers on reachable watches: ${stats.activeUniqueSequencers}`);
  output.log(`  Watch-to-sequencer entries: ${stats.associations}`);
  output.log(`  Entries on reachable watches: ${stats.activeAssociations}`);
  output.log(
    '  Sequencers per watch: ' +
    `min ${formatNumber(stats.watchSize.min)}, ` +
    `median ${formatNumber(stats.watchSize.median)}, ` +
    `average ${formatNumber(stats.watchSize.average)}, ` +
    `max ${formatNumber(stats.watchSize.max)}`,
  );
  for (const [network, values] of Object.entries(stats.networks)) {
    output.log(
      `  ${network}: ${values.watches} watches, ${values.activeWatches} reachable, ` +
      `${values.uniqueSequencers} unique sequencers`,
    );
  }
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function usage() {
  return `Usage:
  node --env-file=/etc/slashmon-backend.env notify-reset-watchers.mjs \\
    --database /var/backups/slashmon/BACKUP.sqlite

  node --env-file=/etc/slashmon-backend.env notify-reset-watchers.mjs \\
    --database /var/backups/slashmon/BACKUP.sqlite --send

Options:
  --database PATH                  Exact v2 SQLite backup (required)
  --state PATH                     Resume receipt (default: BACKUP.sqlite.reset-announcement.json)
  --channel all|telegram|pwa       Select channels (default: all)
  --limit N                        Send to at most N pending channels
  --send                           Deliver; omission is a read-only dry run
  --help                           Show this help

The script reads the backup without changing it. Keep the old VAPID keys and
Telegram bot token in the env file. Successful and permanently unreachable
channels are recorded in the protected sidecar state so reruns do not repeat them.`;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    await run(options);
  } catch (error) {
    console.error(`Reset announcement failed: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1] ? fs.realpathSync(process.argv[1]) : null;
if (entryPoint === fileURLToPath(import.meta.url)) await main();
