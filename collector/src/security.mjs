import { createHash, ECDH, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

export function normalizeAddress(value, label = 'sequencer') {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    throw new InputError('invalid_address', `${label} must be a 20-byte hex address`);
  }
  return value.toLowerCase();
}

export function normalizeAddresses(value, max = 100) {
  if (!Array.isArray(value)) {
    throw new InputError('invalid_addresses', 'addresses must be an array');
  }
  const addresses = [...new Set(value.map((address) => normalizeAddress(address)))];
  if (addresses.length === 0) {
    throw new InputError('empty_addresses', 'At least one sequencer address is required');
  }
  if (addresses.length > max) {
    throw new InputError('too_many_addresses', `At most ${max} sequencer addresses may be watched`);
  }
  return addresses;
}

export function normalizeNetwork(value, expected) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) {
    throw new InputError('invalid_network', 'network must be a short lowercase identifier');
  }
  if (expected && value !== expected) {
    throw new InputError('unsupported_network', `This Slashmon backend watches ${expected}`);
  }
  return value;
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new InputError('invalid_token', 'Token is malformed');
  }
  return createHash('sha256').update(token).digest('hex');
}

export function safeHashMatches(token, expectedHash) {
  let actual;
  try {
    actual = Buffer.from(hashToken(token), 'hex');
  } catch {
    return false;
  }
  const expected = Buffer.from(expectedHash ?? '', 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function readBearerToken(header) {
  if (typeof header !== 'string') {
    throw new InputError('missing_management_token', 'Authorization: Bearer token is required', 401);
  }
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(header);
  if (!match) {
    throw new InputError('invalid_management_token', 'Management token is malformed', 401);
  }
  return match[1];
}

export function parsePushSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('invalid_push_subscription', 'subscription must be an object');
  }
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2_048) {
    throw new InputError('invalid_push_endpoint', 'Push endpoint is invalid');
  }
  let endpoint;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new InputError('invalid_push_endpoint', 'Push endpoint is invalid');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port || endpoint.hash) {
    throw new InputError('invalid_push_endpoint', 'Push endpoint must be a credential-free HTTPS URL on port 443');
  }
  const hostname = endpoint.hostname.toLowerCase();
  const allowed = PUSH_HOSTS.includes(hostname) || PUSH_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  if (!allowed || isIP(hostname) || hostname === 'localhost') {
    throw new InputError('unsupported_push_service', 'Push endpoint is not a recognized browser push service');
  }
  const keys = value.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new InputError('invalid_push_keys', 'Push subscription keys are required');
  }
  const p256dh = decodePushKey(keys.p256dh, 'p256dh', 65);
  if (p256dh[0] !== 0x04) {
    throw new InputError('invalid_push_keys', 'Push p256dh key is invalid');
  }
  try {
    ECDH.convertKey(p256dh, 'prime256v1', undefined, undefined, 'uncompressed');
  } catch {
    throw new InputError('invalid_push_keys', 'Push p256dh key is invalid');
  }
  decodePushKey(keys.auth, 'auth', 16);
  const expirationTime = value.expirationTime ?? null;
  if (expirationTime !== null && (!Number.isSafeInteger(expirationTime) || expirationTime < 0)) {
    throw new InputError('invalid_push_expiration', 'Push expirationTime must be a non-negative integer or null');
  }
  return {
    endpoint: endpoint.toString(),
    expirationTime,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

function decodePushKey(value, name, expectedBytes) {
  if (typeof value !== 'string' || value.length > 256 || !BASE64URL_PATTERN.test(value)) {
    throw new InputError('invalid_push_keys', `Push ${name} key is invalid`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedBytes || decoded.toString('base64url') !== value.replace(/=+$/, '')) {
    throw new InputError('invalid_push_keys', `Push ${name} key is invalid`);
  }
  return decoded;
}

export class InputError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
