import { createHash } from 'node:crypto';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;

export function network(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (!['mainnet', 'testnet'].includes(normalized)) {
    throw new Error(`unsupported network: ${value}`);
  }
  return normalized;
}

export function address(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!ADDRESS.test(normalized)) throw new Error(`${label} must be a 20-byte hex address`);
  return normalized;
}

export function hash(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!HASH.test(normalized)) throw new Error(`${label} must be a 32-byte hex value`);
  return normalized;
}

export function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

export function unsignedInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return number;
}

export function unsignedString(value, label) {
  try {
    const result = BigInt(value);
    if (result < 0n) throw new Error();
    return result.toString();
  } catch {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

export function toIso(value) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('observation time is invalid');
  const milliseconds = number < 10_000_000_000 ? number * 1_000 : number;
  return new Date(milliseconds).toISOString();
}

export function parseJson(value, fallback) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

export function truncate(value, max = 1_000) {
  return String(value?.message ?? value ?? 'Unknown error').slice(0, max);
}

export function stableId(...parts) {
  return createHash('sha256').update(parts.map(String).join('|')).digest('hex');
}
