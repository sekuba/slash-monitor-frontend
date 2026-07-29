import path from 'node:path';
import { createECDH } from 'node:crypto';

const DEFAULT_ADMIN_POLL_INTERVAL_MS = 15_000;
const DEFAULT_SENTINEL_POLL_INTERVAL_MS = 60_000;
const DEFAULT_L1_POLL_INTERVAL_MS = 30_000;
const DEFAULT_L1_SLASH_LOG_PROVIDER_TIMEOUT_MS = 30_000;
const L1_SLASH_LOG_MAX_RUN_MS = 60_000;
const DEFAULT_DATABASE_PATH = './data/slashmon.sqlite';
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
  const adminUrl = readHttpUrl(env.AZTEC_ADMIN_URL ?? 'http://127.0.0.1:8880', 'AZTEC_ADMIN_URL');
  const nodeUrl = readHttpUrl(env.AZTEC_NODE_URL ?? 'http://127.0.0.1:8080', 'AZTEC_NODE_URL');
  const publicUrl = readPublicUrl(env.SLASHMON_PUBLIC_URL ?? 'http://localhost:5173', 'SLASHMON_PUBLIC_URL');
  const corsOrigin = readOrigin(env.BACKEND_CORS_ORIGIN ?? 'http://localhost:5173', 'BACKEND_CORS_ORIGIN');
  if (new URL(publicUrl).origin !== corsOrigin) {
    throw new Error('SLASHMON_PUBLIC_URL and BACKEND_CORS_ORIGIN must use the same browser origin');
  }
  const l1RpcUrls = [
    readHttpUrl(env.L1_RPC_URL ?? 'http://127.0.0.1:8545', 'L1_RPC_URL'),
  ];
  const vapid = readVapid(env);
  const telegram = readTelegram(env);

  return {
    network,
    publicUrl,
    adminUrl,
    adminApiKey: readOptionalSecret(env.AZTEC_ADMIN_API_KEY),
    nodeUrl,
    nodeApiKey: readOptionalSecret(env.AZTEC_NODE_API_KEY),
    databasePath: path.resolve(cwd, env.BACKEND_DATABASE_PATH ?? DEFAULT_DATABASE_PATH),
    pollIntervalMs: DEFAULT_ADMIN_POLL_INTERVAL_MS,
    maxBackoffMs: 60_000,
    requestTimeoutMs: 10_000,
    staleAfterMs: 60_000,
    syncMaxL1AgeMs: 5 * 60_000,
    syncMaxL2StallMs: 5 * 60_000,
    withdrawAfterMissedPolls: 3,
    maxOffensesPerPoll: 100_000,
    maxResponseBytes: 2 * 1024 * 1024,
    maxSingleValidatorStatsResponseBytes: readInteger(
      env,
      'AZTEC_SENTINEL_VALIDATOR_MAX_RESPONSE_BYTES',
      2 * 1024 * 1024,
      1024,
      16 * 1024 * 1024,
    ),
    sentinelPollIntervalMs: readInteger(
      env,
      'AZTEC_SENTINEL_POLL_INTERVAL_MS',
      DEFAULT_SENTINEL_POLL_INTERVAL_MS,
      5_000,
      60 * 60_000,
    ),
    sentinelLookbackEpochs: readInteger(
      env,
      'AZTEC_SENTINEL_LOOKBACK_EPOCHS',
      3,
      1,
      24,
    ),
    sentinelEpochEndBufferSlots: readInteger(
      env,
      'AZTEC_SENTINEL_EPOCH_END_BUFFER_SLOTS',
      2,
      0,
      10_000,
    ),
    sentinelValidatorConcurrency: readInteger(
      env,
      'AZTEC_SENTINEL_VALIDATOR_CONCURRENCY',
      8,
      1,
      128,
    ),

    l1RpcUrls,
    l1ChainId: networkDefaults.chainId,
    l1RegistryAddress: readAddress(
      env.L1_REGISTRY_ADDRESS ?? networkDefaults.registryAddress,
      'L1_REGISTRY_ADDRESS',
    ),
    l1Confirmations: 2,
    l1PollIntervalMs: DEFAULT_L1_POLL_INTERVAL_MS,
    l1MaxBackoffMs: 120_000,
    l1RequestTimeoutMs: 15_000,
    l1SnapshotTimeoutMs: 120_000,
    l1StaleAfterMs: 120_000,
    l1MaxHeadAgeMs: 15 * 60_000,
    l1MaxHeadStallMs: 2 * 60_000,
    l1MaxFutureSkewMs: 2 * 60_000,
    l1SlashLogStartBlock: readOptionalInteger(
      env,
      'L1_SLASH_LOG_START_BLOCK',
      0,
      1_000_000_000,
    ),
    l1SlashLogLookbackBlocks: readInteger(
      env,
      'L1_SLASH_LOG_LOOKBACK_BLOCKS',
      50_000,
      1,
      10_000_000,
    ),
    l1SlashLogChunkSize: 1_000,
    l1SlashLogOverlapBlocks: 12,
    l1SlashLogReorgRewindBlocks: 512,
    l1SlashLogMaxChunksPerPoll: 25,
    l1SlashLogMaxRunMs: L1_SLASH_LOG_MAX_RUN_MS,
    l1SlashLogProviderTimeoutMs: readInteger(
      env,
      'L1_SLASH_LOG_PROVIDER_TIMEOUT_MS',
      DEFAULT_L1_SLASH_LOG_PROVIDER_TIMEOUT_MS,
      5_000,
      45_000,
    ),

    bindHost: readString(env.BACKEND_BIND_HOST, '127.0.0.1'),
    port: readInteger(env, 'BACKEND_PORT', 8_790, 1, 65_535),
    corsOrigin,
    maxRequestBodyBytes: 64 * 1024,
    rateLimitWindowMs: 60_000,
    rateLimitMaxMutations: readInteger(
      env,
      'BACKEND_MUTATION_RATE_LIMIT_MAX_PER_MINUTE',
      20,
      1,
      100_000,
    ),
    trustLoopbackProxy: readBoolean(env.BACKEND_TRUST_PROXY, false, 'BACKEND_TRUST_PROXY'),
    maxWatchedSequencers: 100,

    deliveryPollIntervalMs: 1_000,
    deliveryBatchSize: 50,
    deliveryConcurrency: 8,
    deliveryMaxAttempts: 12,
    deliveryLeaseMs: 120_000,
    deliveryRequestTimeoutMs: 15_000,
    linkTokenTtlMs: 10 * 60_000,
    telegramSendMaxPerSecond: readInteger(
      env,
      'TELEGRAM_SEND_MAX_PER_SECOND',
      20,
      1,
      100,
    ),
    telegramLowPrioritySendMaxPerSecond: readInteger(
      env,
      'TELEGRAM_LOW_PRIORITY_SEND_MAX_PER_SECOND',
      5,
      1,
      100,
    ),
    telegramChatSendIntervalMs: readInteger(
      env,
      'TELEGRAM_CHAT_SEND_INTERVAL_MS',
      1_000,
      1,
      60_000,
    ),
    vapid,
    telegram,
    logLevel: readLogLevel(env.BACKEND_LOG_LEVEL),
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
    pollTimeoutSeconds: 25,
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

function readOptionalInteger(env, name, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  return readInteger(env, name, undefined, min, max);
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
    throw new Error('BACKEND_LOG_LEVEL must be debug, info, warn, or error');
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
