import path from 'node:path';
import { createECDH } from 'node:crypto';

const DEFAULT_ADMIN_POLL_INTERVAL_MS = 15_000;
const DEFAULT_L1_POLL_INTERVAL_MS = 30_000;
const NETWORK_DEFAULTS = {
  mainnet: {
    chainId: 1,
    registryAddress: '0x35b22e09Ee0390539439E24f06Da43D83f90e298',
  },
  testnet: {
    chainId: 11_155_111,
    registryAddress: '0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba',
  },
};

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const network = readNetwork(env.SLASHMON_NETWORK);
  const networkDefaults = NETWORK_DEFAULTS[network];
  const pollIntervalMs = readInteger(
    env,
    'COLLECTOR_POLL_INTERVAL_MS',
    DEFAULT_ADMIN_POLL_INTERVAL_MS,
    1_000,
    3_600_000,
  );
  const l1PollIntervalMs = readInteger(
    env,
    'L1_POLL_INTERVAL_MS',
    DEFAULT_L1_POLL_INTERVAL_MS,
    1_000,
    3_600_000,
  );
  const defaultStaleAfterMs = Math.max(pollIntervalMs * 3, 60_000);
  const defaultL1StaleAfterMs = Math.max(l1PollIntervalMs * 3, 120_000);
  const adminUrl = readHttpUrl(env.AZTEC_ADMIN_URL ?? 'http://127.0.0.1:8880', 'AZTEC_ADMIN_URL');
  const nodeUrl = readHttpUrl(env.AZTEC_NODE_URL ?? 'http://127.0.0.1:8080', 'AZTEC_NODE_URL');
  const publicUrl = readPublicUrl(env.SLASHMON_PUBLIC_URL ?? 'http://localhost:5173', 'SLASHMON_PUBLIC_URL');
  const corsOrigin = readOrigin(env.COLLECTOR_CORS_ORIGIN ?? 'http://localhost:5173', 'COLLECTOR_CORS_ORIGIN');
  if (new URL(publicUrl).origin !== corsOrigin) {
    throw new Error('SLASHMON_PUBLIC_URL and COLLECTOR_CORS_ORIGIN must use the same browser origin');
  }
  const l1RpcUrls = readUrlList(env.L1_RPC_URL ?? 'http://127.0.0.1:8545', 'L1_RPC_URL');
  const vapid = readVapid(env);
  const telegram = readTelegram(env);
  const deliveryPollIntervalMs = readInteger(env, 'DELIVERY_POLL_INTERVAL_MS', 1_000, 100, 60_000);
  const deliveryLeaseMs = readInteger(env, 'DELIVERY_LEASE_MS', 120_000, 10_000, 3_600_000);
  const deliveryRequestTimeoutMs = readInteger(
    env,
    'DELIVERY_REQUEST_TIMEOUT_MS',
    15_000,
    100,
    20_000,
  );
  if (deliveryLeaseMs < deliveryRequestTimeoutMs + deliveryPollIntervalMs) {
    throw new Error(
      'DELIVERY_LEASE_MS must cover DELIVERY_REQUEST_TIMEOUT_MS plus DELIVERY_POLL_INTERVAL_MS',
    );
  }
  const l1SlashLogChunkSize = readInteger(env, 'L1_SLASH_LOG_CHUNK_SIZE', 2_000, 2, 100_000);
  const l1SlashLogOverlapBlocks = readInteger(env, 'L1_SLASH_LOG_OVERLAP_BLOCKS', 12, 1, 99_999);
  if (l1SlashLogOverlapBlocks >= l1SlashLogChunkSize) {
    throw new Error('L1_SLASH_LOG_OVERLAP_BLOCKS must be smaller than L1_SLASH_LOG_CHUNK_SIZE');
  }
  const l1SlashLogReorgRewindBlocks = readInteger(
    env,
    'L1_SLASH_LOG_REORG_REWIND_BLOCKS',
    512,
    1,
    1_000_000,
  );
  if (l1SlashLogReorgRewindBlocks < l1SlashLogOverlapBlocks) {
    throw new Error('L1_SLASH_LOG_REORG_REWIND_BLOCKS must be at least L1_SLASH_LOG_OVERLAP_BLOCKS');
  }
  const l1SlashLogMaxRunMs = readInteger(
    env,
    'L1_SLASH_LOG_MAX_RUN_MS',
    20_000,
    1_000,
    300_000,
  );
  const l1SlashLogProviderTimeoutMs = readInteger(
    env,
    'L1_SLASH_LOG_PROVIDER_TIMEOUT_MS',
    5_000,
    100,
    120_000,
  );
  if (l1SlashLogProviderTimeoutMs >= l1SlashLogMaxRunMs) {
    throw new Error('L1_SLASH_LOG_PROVIDER_TIMEOUT_MS must be smaller than L1_SLASH_LOG_MAX_RUN_MS');
  }
  const l1MaxHeadAgeMs = readInteger(
    env,
    'L1_MAX_HEAD_AGE_MS',
    15 * 60_000,
    10_000,
    86_400_000,
  );
  const l1MaxHeadStallMs = readInteger(
    env,
    'L1_MAX_HEAD_STALL_MS',
    2 * 60_000,
    30_000,
    86_400_000,
  );
  if (l1MaxHeadStallMs > l1MaxHeadAgeMs) {
    throw new Error('L1_MAX_HEAD_STALL_MS must not exceed L1_MAX_HEAD_AGE_MS');
  }

  return {
    network,
    publicUrl,
    adminUrl,
    adminApiKey: readOptionalSecret(env.AZTEC_ADMIN_API_KEY),
    nodeUrl,
    nodeApiKey: readOptionalSecret(env.AZTEC_NODE_API_KEY),
    databasePath: path.resolve(cwd, env.COLLECTOR_DATABASE_PATH ?? './data/offenses.sqlite'),
    pollIntervalMs,
    maxBackoffMs: Math.max(
      pollIntervalMs,
      readInteger(env, 'COLLECTOR_MAX_BACKOFF_MS', 60_000, 1_000, 3_600_000),
    ),
    requestTimeoutMs: readInteger(env, 'COLLECTOR_REQUEST_TIMEOUT_MS', 10_000, 100, 300_000),
    staleAfterMs: readInteger(env, 'COLLECTOR_STALE_AFTER_MS', defaultStaleAfterMs, 1_000, 86_400_000),
    syncMaxL1AgeMs: readInteger(env, 'AZTEC_SYNC_MAX_L1_AGE_MS', 5 * 60_000, 1_000, 86_400_000),
    syncMaxL2StallMs: readInteger(env, 'AZTEC_SYNC_MAX_L2_STALL_MS', 5 * 60_000, 1_000, 86_400_000),
    withdrawAfterMissedPolls: readInteger(env, 'COLLECTOR_WITHDRAW_AFTER_MISSED_POLLS', 3, 1, 100),
    maxOffensesPerPoll: readInteger(env, 'COLLECTOR_MAX_OFFENSES_PER_POLL', 100_000, 1, 1_000_000),
    maxResponseBytes: readInteger(env, 'COLLECTOR_MAX_RESPONSE_BYTES', 2 * 1024 * 1024, 1_024, 100 * 1024 * 1024),

    l1RpcUrls,
    l1ChainId: readExpectedChainId(env, networkDefaults.chainId, network),
    l1RegistryAddress: readAddress(
      env.L1_REGISTRY_ADDRESS ?? networkDefaults.registryAddress,
      'L1_REGISTRY_ADDRESS',
    ),
    l1Confirmations: readInteger(env, 'L1_CONFIRMATIONS', 2, 0, 1_024),
    l1PollIntervalMs,
    l1MaxBackoffMs: Math.max(
      l1PollIntervalMs,
      readInteger(env, 'L1_MAX_BACKOFF_MS', 120_000, 1_000, 3_600_000),
    ),
    l1RequestTimeoutMs: readInteger(env, 'L1_REQUEST_TIMEOUT_MS', 15_000, 100, 300_000),
    l1SnapshotTimeoutMs: readInteger(env, 'L1_SNAPSHOT_TIMEOUT_MS', 120_000, 1_000, 900_000),
    l1StaleAfterMs: readInteger(env, 'L1_STALE_AFTER_MS', defaultL1StaleAfterMs, 1_000, 86_400_000),
    l1MaxHeadAgeMs,
    l1MaxHeadStallMs,
    l1MaxFutureSkewMs: readInteger(env, 'L1_MAX_FUTURE_SKEW_MS', 2 * 60_000, 0, 3_600_000),
    l1SlashLogLookbackBlocks: readInteger(
      env,
      'L1_SLASH_LOG_LOOKBACK_BLOCKS',
      50_000,
      1,
      10_000_000,
    ),
    l1SlashLogChunkSize,
    l1SlashLogOverlapBlocks,
    l1SlashLogReorgRewindBlocks,
    l1SlashLogMaxChunksPerPoll: readInteger(
      env,
      'L1_SLASH_LOG_MAX_CHUNKS_PER_POLL',
      25,
      1,
      1_000,
    ),
    l1SlashLogMaxRunMs,
    l1SlashLogProviderTimeoutMs,

    bindHost: readString(env.COLLECTOR_BIND_HOST, '127.0.0.1'),
    port: readInteger(env, 'COLLECTOR_PORT', 8_790, 1, 65_535),
    corsOrigin,
    maxRequestBodyBytes: readInteger(env, 'API_MAX_REQUEST_BODY_BYTES', 64 * 1024, 1_024, 2 * 1024 * 1024),
    rateLimitWindowMs: readInteger(env, 'API_RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 3_600_000),
    rateLimitMaxMutations: readInteger(env, 'API_RATE_LIMIT_MAX_MUTATIONS', 60, 1, 10_000),
    trustLoopbackProxy: readBoolean(env.API_TRUST_LOOPBACK_PROXY, false, 'API_TRUST_LOOPBACK_PROXY'),
    maxSequencersPerWatchlist: readInteger(env, 'MAX_SEQUENCERS_PER_WATCHLIST', 100, 1, 1_000),

    deliveryPollIntervalMs,
    deliveryBatchSize: readInteger(env, 'DELIVERY_BATCH_SIZE', 50, 1, 1_000),
    deliveryConcurrency: readInteger(env, 'DELIVERY_CONCURRENCY', 8, 1, 50),
    deliveryMaxAttempts: readInteger(env, 'DELIVERY_MAX_ATTEMPTS', 12, 1, 100),
    deliveryLeaseMs,
    deliveryRequestTimeoutMs,
    linkTokenTtlMs: readInteger(env, 'TELEGRAM_LINK_TTL_MS', 10 * 60_000, 60_000, 86_400_000),
    vapid,
    telegram,
    logLevel: readLogLevel(env.COLLECTOR_LOG_LEVEL),
  };
}

function readVapid(env) {
  const subject = readOptionalSecret(env.VAPID_SUBJECT);
  const publicKey = readOptionalSecret(env.VAPID_PUBLIC_KEY);
  const privateKey = readOptionalSecret(env.VAPID_PRIVATE_KEY);
  const supplied = [subject, publicKey, privateKey].filter(Boolean).length;
  if (supplied !== 0 && supplied !== 3) {
    throw new Error('VAPID_SUBJECT, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY must be set together');
  }
  if (subject) validateVapidSubject(subject);
  if (supplied === 3) {
    const publicBytes = decodeVapidKey(publicKey, 'VAPID_PUBLIC_KEY', 65, 0x04);
    const privateBytes = decodeVapidKey(privateKey, 'VAPID_PRIVATE_KEY', 32);
    try {
      const key = createECDH('prime256v1');
      key.setPrivateKey(privateBytes);
      if (!key.getPublicKey().equals(publicBytes)) throw new Error('mismatch');
    } catch {
      throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be a valid keypair');
    }
    return { subject, publicKey, privateKey };
  }
  return undefined;
}

function decodeVapidKey(value, name, expectedBytes, firstByte) {
  // `web-push` requires canonical, unpadded base64url. Accepting a key that
  // Buffer can decode but the sender later rejects would make startup look
  // healthy while every notification fails.
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must be a base64url-encoded VAPID key`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length !== expectedBytes ||
    decoded.toString('base64url') !== value ||
    (firstByte !== undefined && decoded[0] !== firstByte)
  ) {
    throw new Error(`${name} is not a valid VAPID key`);
  }
  return decoded;
}

function validateVapidSubject(subject) {
  let url;
  try {
    url = new URL(subject);
  } catch {
    throw new Error('VAPID_SUBJECT must be a valid mailto or HTTPS URL');
  }
  if (url.protocol === 'https:') {
    if (!url.hostname || url.username || url.password) {
      throw new Error('VAPID_SUBJECT must be a valid mailto or HTTPS URL');
    }
    return;
  }
  if (url.protocol === 'mailto:') {
    const address = decodeURIComponent(url.pathname);
    if (
      url.search ||
      url.hash ||
      !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(address)
    ) {
      throw new Error('VAPID_SUBJECT must be a valid mailto or HTTPS URL');
    }
    return;
  }
  throw new Error('VAPID_SUBJECT must use mailto or https');
}

function readTelegram(env) {
  const token = readOptionalSecret(env.TELEGRAM_BOT_TOKEN);
  const username = readOptionalSecret(env.TELEGRAM_BOT_USERNAME)?.replace(/^@/, '');
  if ((token && !username) || (!token && username)) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME must be set together');
  }
  if (username && !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new Error('TELEGRAM_BOT_USERNAME is invalid');
  }
  return token ? {
    token,
    username,
    pollTimeoutSeconds: readInteger(env, 'TELEGRAM_POLL_TIMEOUT_SECONDS', 25, 1, 50),
  } : undefined;
}

function readInteger(env, name, defaultValue, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readHttpUrl(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials`);
  }
  return url.toString();
}

function readUrlList(raw, name) {
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.length > 10) {
    throw new Error(`${name} must contain between 1 and 10 URLs`);
  }
  return values.map((value) => readHttpUrl(value, name));
}

function readOptionalSecret(raw) {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return raw;
}

function readString(raw, defaultValue) {
  const value = raw?.trim();
  return value || defaultValue;
}

function readBoolean(raw, defaultValue, name) {
  if (raw === undefined || raw === '') return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function readLogLevel(raw) {
  const level = readString(raw, 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throw new Error('COLLECTOR_LOG_LEVEL must be debug, info, warn, or error');
  }
  return level;
}

function readNetwork(raw) {
  const value = readString(raw, 'mainnet').toLowerCase();
  if (!['mainnet', 'testnet'].includes(value)) {
    throw new Error('SLASHMON_NETWORK must be mainnet or testnet');
  }
  return value;
}

function readExpectedChainId(env, expected, network) {
  const value = readInteger(env, 'L1_CHAIN_ID', expected, 1, Number.MAX_SAFE_INTEGER);
  if (value !== expected) {
    throw new Error(`L1_CHAIN_ID must be ${expected} when SLASHMON_NETWORK=${network}`);
  }
  return value;
}

function readOrigin(raw, name) {
  const url = readHttpUrl(raw, name);
  const parsed = new URL(url);
  requireSecureBrowserUrl(parsed, name);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an origin without a path`);
  }
  return parsed.origin;
}

function readPublicUrl(raw, name) {
  const url = new URL(readHttpUrl(raw, name));
  requireSecureBrowserUrl(url, name);
  if (url.search || url.hash) {
    throw new Error(`${name} must not contain a query or fragment`);
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function requireSecureBrowserUrl(url, name) {
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error(`${name} must use HTTPS outside localhost/loopback development`);
  }
}

function readAddress(raw, name) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`${name} must be a 20-byte hex address`);
  }
  return raw;
}
