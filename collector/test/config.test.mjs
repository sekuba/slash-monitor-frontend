import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import test from 'node:test';

import { loadConfig } from '../src/config.mjs';

const vapidFixture = createECDH('prime256v1');
vapidFixture.setPrivateKey(Buffer.alloc(32, 1));
const VAPID_PUBLIC_KEY = vapidFixture.getPublicKey().toString('base64url');
const VAPID_PRIVATE_KEY = vapidFixture.getPrivateKey().toString('base64url');

test('loadConfig provides a complete local configuration', () => {
  const config = loadConfig({}, '/srv/slashmon');

  assert.equal(config.network, 'mainnet');
  assert.equal(config.adminUrl, 'http://127.0.0.1:8880/');
  assert.equal(config.nodeUrl, 'http://127.0.0.1:8080/');
  assert.equal(config.databasePath, '/srv/slashmon/data/slashmon.sqlite');
  assert.equal(config.bindHost, '127.0.0.1');
  assert.equal(config.port, 8790);
  assert.equal(config.l1ChainId, 1);
  assert.equal(config.l1RegistryAddress, '0x35b22e09Ee0390539439E24f06Da43D83f90e298');
  assert.equal(config.l1SlashLogLookbackBlocks, 50_000);
  assert.equal(config.sentinelPollIntervalMs, 60_000);
  assert.equal(config.sentinelLookbackEpochs, 3);
  assert.equal(config.sentinelEpochEndBufferSlots, 2);
  assert.equal(config.sentinelValidatorConcurrency, 8);
  assert.equal(config.maxSingleValidatorStatsResponseBytes, 2 * 1024 * 1024);
  assert.equal(config.telegram, undefined);
  assert.equal(config.vapid, undefined);
});

test('network selects the chain and default Registry', () => {
  const config = loadConfig({ SLASHMON_NETWORK: 'testnet' });
  assert.equal(config.l1ChainId, 11_155_111);
  assert.equal(config.l1RegistryAddress, '0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba');

  assert.throws(() => loadConfig({ SLASHMON_NETWORK: 'sepolia' }), /must be mainnet or testnet/);
  assert.throws(
    () => loadConfig({ L1_REGISTRY_ADDRESS: 'not-an-address' }),
    /must be a 20-byte hex address/,
  );
});

test('operator-facing URLs and process settings are validated', () => {
  assert.throws(
    () => loadConfig({ AZTEC_ADMIN_URL: 'http://user:password@localhost:8880' }),
    /must not contain credentials/,
  );
  assert.throws(() => loadConfig({ BACKEND_CORS_ORIGIN: '*' }), /must be a valid URL/);
  assert.throws(
    () => loadConfig({ BACKEND_CORS_ORIGIN: 'https://slashmon.example/api' }),
    /must be an origin without a path/,
  );
  assert.throws(
    () => loadConfig({ SLASHMON_PUBLIC_URL: 'https://slashmon.example/app?token=1' }),
    /must not contain a query or fragment/,
  );
  assert.throws(
    () => loadConfig({
      SLASHMON_PUBLIC_URL: 'https://slashmon.example',
      BACKEND_CORS_ORIGIN: 'https://api.example',
    }),
    /must use the same browser origin/,
  );
  assert.throws(() => loadConfig({ BACKEND_PORT: '0' }), /between 1 and 65535/);
  assert.throws(
    () => loadConfig({ AZTEC_SENTINEL_POLL_INTERVAL_MS: '1000' }),
    /between 5000 and 3600000/,
  );
  assert.throws(
    () => loadConfig({ AZTEC_SENTINEL_LOOKBACK_EPOCHS: '0' }),
    /between 1 and 24/,
  );
  assert.throws(
    () => loadConfig({ AZTEC_SENTINEL_EPOCH_END_BUFFER_SLOTS: '-1' }),
    /between 0 and 10000/,
  );
  assert.throws(
    () => loadConfig({ AZTEC_SENTINEL_VALIDATOR_CONCURRENCY: '0' }),
    /between 1 and 128/,
  );
  assert.throws(() => loadConfig({ BACKEND_TRUST_PROXY: 'yes' }), /must be true or false/);
  assert.throws(() => loadConfig({ BACKEND_LOG_LEVEL: 'trace' }), /debug, info, warn, or error/);

  const config = loadConfig({
    SLASHMON_PUBLIC_URL: 'https://slashmon.example/app',
    BACKEND_CORS_ORIGIN: 'https://slashmon.example',
    L1_RPC_URL: 'https://rpc-one.example, https://rpc-two.example/path',
    L1_SLASH_LOG_LOOKBACK_BLOCKS: '75000',
    BACKEND_DATABASE_PATH: '../state/slashmon.sqlite',
    BACKEND_PORT: '9000',
    BACKEND_TRUST_PROXY: 'true',
    BACKEND_LOG_LEVEL: 'debug',
  }, '/srv/slashmon');
  assert.equal(config.publicUrl, 'https://slashmon.example/app/');
  assert.equal(config.corsOrigin, 'https://slashmon.example');
  assert.deepEqual(config.l1RpcUrls, ['https://rpc-one.example/', 'https://rpc-two.example/path']);
  assert.equal(config.l1SlashLogLookbackBlocks, 75_000);
  assert.equal(config.databasePath, '/srv/state/slashmon.sqlite');
  assert.equal(config.port, 9000);
  assert.equal(config.trustLoopbackProxy, true);
  assert.equal(config.logLevel, 'debug');
});

test('notification channels require complete, valid credentials', () => {
  assert.throws(
    () => loadConfig({ TELEGRAM_BOT_TOKEN: 'secret-token' }),
    /must be set together/,
  );
  assert.throws(
    () => loadConfig({ VAPID_SUBJECT: 'mailto:operator@example.com' }),
    /must be set together/,
  );
  assert.throws(
    () => loadConfig({
      VAPID_SUBJECT: 'ftp://example.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    }),
    /must use mailto or https/,
  );

  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'secret-token',
    TELEGRAM_BOT_USERNAME: '@slashmon_bot',
    VAPID_SUBJECT: 'mailto:operator@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  });
  assert.deepEqual(config.telegram, {
    token: 'secret-token',
    username: 'slashmon_bot',
    pollTimeoutSeconds: 25,
  });
  assert.deepEqual(config.vapid, {
    subject: 'mailto:operator@example.com',
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  });
});
