import path from 'node:path';

const DEFAULT_POLL_INTERVAL_MS = 15_000;

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const pollIntervalMs = readInteger(env, 'COLLECTOR_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS, 1_000, 3_600_000);
  const defaultStaleAfterMs = Math.max(pollIntervalMs * 3, 60_000);
  const adminUrl = readUrl(env.AZTEC_ADMIN_URL ?? 'http://127.0.0.1:8880');

  return {
    adminUrl,
    adminApiKey: readOptionalSecret(env.AZTEC_ADMIN_API_KEY),
    databasePath: path.resolve(cwd, env.COLLECTOR_DATABASE_PATH ?? './data/offenses.sqlite'),
    pollIntervalMs,
    maxBackoffMs: Math.max(
      pollIntervalMs,
      readInteger(env, 'COLLECTOR_MAX_BACKOFF_MS', 60_000, 1_000, 3_600_000),
    ),
    requestTimeoutMs: readInteger(env, 'COLLECTOR_REQUEST_TIMEOUT_MS', 10_000, 100, 300_000),
    staleAfterMs: readInteger(env, 'COLLECTOR_STALE_AFTER_MS', defaultStaleAfterMs, 1_000, 86_400_000),
    withdrawAfterMissedPolls: readInteger(env, 'COLLECTOR_WITHDRAW_AFTER_MISSED_POLLS', 3, 1, 100),
    maxOffensesPerPoll: readInteger(env, 'COLLECTOR_MAX_OFFENSES_PER_POLL', 100_000, 1, 1_000_000),
    maxResponseBytes: readInteger(env, 'COLLECTOR_MAX_RESPONSE_BYTES', 2 * 1024 * 1024, 1_024, 100 * 1024 * 1024),
    bindHost: readString(env.COLLECTOR_BIND_HOST, '127.0.0.1'),
    port: readInteger(env, 'COLLECTOR_PORT', 8_790, 1, 65_535),
    corsOrigin: readString(env.COLLECTOR_CORS_ORIGIN, '*'),
    logLevel: readLogLevel(env.COLLECTOR_LOG_LEVEL),
  };
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

function readUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('AZTEC_ADMIN_URL must be a valid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('AZTEC_ADMIN_URL must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('AZTEC_ADMIN_URL must not contain credentials; use AZTEC_ADMIN_API_KEY');
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
  return value ? value : defaultValue;
}

function readLogLevel(raw) {
  const level = readString(raw, 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throw new Error('COLLECTOR_LOG_LEVEL must be debug, info, warn, or error');
  }
  return level;
}
