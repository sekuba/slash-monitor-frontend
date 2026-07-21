import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InputError,
  createOpaqueToken,
  hashToken,
  normalizeAddress,
  normalizeAddresses,
  normalizeNetwork,
  parsePushSubscription,
  readBearerToken,
  safeHashMatches,
} from '../src/security.mjs';
import { PUSH_KEYS } from './helpers.mjs';

const ADDRESS_A = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADDRESS_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
test('address and network normalization is strict and deduplicated', () => {
  assert.equal(normalizeAddress(ADDRESS_A), ADDRESS_A.toLowerCase());
  assert.deepEqual(
    normalizeAddresses([ADDRESS_A, ADDRESS_A.toLowerCase(), ADDRESS_B]),
    [ADDRESS_A.toLowerCase(), ADDRESS_B],
  );
  assert.equal(normalizeNetwork('mainnet', 'mainnet'), 'mainnet');

  assertInputError(() => normalizeAddress('0x1234'), 'invalid_address');
  assertInputError(() => normalizeAddresses([]), 'empty_addresses');
  assertInputError(() => normalizeAddresses([ADDRESS_A, ADDRESS_B], 1), 'too_many_addresses');
  assertInputError(() => normalizeNetwork('Mainnet'), 'invalid_network');
  assertInputError(() => normalizeNetwork('testnet', 'mainnet'), 'unsupported_network');
});

test('opaque management tokens hash and compare without accepting malformed input', () => {
  const token = createOpaqueToken();
  assert.match(token, /^[A-Za-z0-9_-]{32,128}$/);
  assert.equal(hashToken(token).length, 64);
  assert.equal(safeHashMatches(token, hashToken(token)), true);
  assert.equal(safeHashMatches(`${token}x`, hashToken(token)), false);
  assert.equal(safeHashMatches('too-short', hashToken(token)), false);

  assert.equal(readBearerToken(`Bearer ${token}`), token);
  assertInputError(() => readBearerToken(undefined), 'missing_management_token', 401);
  assertInputError(() => readBearerToken(`bearer ${token}`), 'invalid_management_token', 401);
  assertInputError(() => hashToken('short'), 'invalid_token');
});

test('Web Push subscriptions accept recognized providers and normalize their shape', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/example',
    'https://updates.push.services.mozilla.com/wpush/v2/example',
    'https://web.push.apple.com/Q/example',
    'https://edge.notify.windows.com/w/?token=example',
  ]) {
    const parsed = parsePushSubscription({ endpoint, keys: PUSH_KEYS });
    assert.equal(parsed.endpoint, endpoint);
    assert.deepEqual(parsed.keys, PUSH_KEYS);
    assert.equal(parsed.expirationTime, null);
  }
});

test('Web Push endpoint allowlist rejects lookalikes and local destinations', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com.evil.example/push',
    'https://evil-fcm.googleapis.com/push',
    'https://example.com/push',
    'https://127.0.0.1/push',
    'https://localhost/push',
  ]) {
    assertInputError(
      () => parsePushSubscription({ endpoint, keys: PUSH_KEYS }),
      'unsupported_push_service',
    );
  }

  for (const endpoint of [
    'http://fcm.googleapis.com/push',
    'https://user:pass@fcm.googleapis.com/push',
    'https://fcm.googleapis.com:8443/push',
    'https://fcm.googleapis.com/push#duplicate-destination',
  ]) {
    assertInputError(
      () => parsePushSubscription({ endpoint, keys: PUSH_KEYS }),
      'invalid_push_endpoint',
    );
  }

  assertInputError(
    () => parsePushSubscription({
      endpoint: 'https://fcm.googleapis.com/push',
      keys: { ...PUSH_KEYS, auth: 'short' },
    }),
    'invalid_push_keys',
  );
  assertInputError(
    () => parsePushSubscription({
      endpoint: 'https://fcm.googleapis.com/push',
      expirationTime: 'never',
      keys: PUSH_KEYS,
    }),
    'invalid_push_expiration',
  );
});

function assertInputError(action, code, status = 400) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof InputError, true);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}
