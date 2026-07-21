import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import test from 'node:test';

import { loadConfig } from '../src/config.mjs';

const vapidFixture = createECDH('prime256v1');
vapidFixture.setPrivateKey(Buffer.alloc(32, 1));
const VAPID_PUBLIC_KEY = vapidFixture.getPublicKey().toString('base64url');
const VAPID_PRIVATE_KEY = vapidFixture.getPrivateKey().toString('base64url');

test('loadConfig provides local, conservative defaults', () => {
  const config = loadConfig({}, '/srv/collector');

  assert.equal(config.adminUrl, 'http://127.0.0.1:8880/');
  assert.equal(config.nodeUrl, 'http://127.0.0.1:8080/');
  assert.equal(config.databasePath, '/srv/collector/data/offenses.sqlite');
  assert.equal(config.bindHost, '127.0.0.1');
  assert.equal(config.port, 8790);
  assert.equal(config.withdrawAfterMissedPolls, 3);
  assert.equal(config.adminApiKey, undefined);
  assert.equal(config.nodeApiKey, undefined);
  assert.equal(config.syncMaxL1AgeMs, 300_000);
  assert.equal(config.syncMaxL2StallMs, 300_000);
  assert.equal(config.deliveryConcurrency, 8);
  assert.equal(config.l1ChainId, 1);
  assert.equal(config.l1RegistryAddress, '0x35b22e09Ee0390539439E24f06Da43D83f90e298');
  assert.equal(config.l1SlashLogLookbackBlocks, 50_000);
  assert.equal(config.l1SlashLogChunkSize, 2_000);
  assert.equal(config.l1SlashLogOverlapBlocks, 12);
  assert.equal(config.l1SlashLogReorgRewindBlocks, 512);
  assert.equal(config.l1SlashLogMaxChunksPerPoll, 25);
  assert.equal(config.l1SlashLogMaxRunMs, 20_000);
  assert.equal(config.l1SlashLogProviderTimeoutMs, 5_000);
  assert.equal(config.l1MaxHeadStallMs, 120_000);
});

test('network identity selects matching L1 defaults and rejects mislabeled chains', () => {
  const testnet = loadConfig({ SLASHMON_NETWORK: 'testnet' });
  assert.equal(testnet.l1ChainId, 11_155_111);
  assert.equal(testnet.l1RegistryAddress, '0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba');

  assert.throws(
    () => loadConfig({ SLASHMON_NETWORK: 'mainnet', L1_CHAIN_ID: '11155111' }),
    /must be 1 when SLASHMON_NETWORK=mainnet/,
  );
  assert.throws(
    () => loadConfig({ SLASHMON_NETWORK: 'testnet', L1_CHAIN_ID: '1' }),
    /must be 11155111 when SLASHMON_NETWORK=testnet/,
  );
});

test('loadConfig validates secrets and numeric settings without exposing credentials in URLs', () => {
  assert.throws(
    () => loadConfig({ AZTEC_ADMIN_URL: 'http://user:password@localhost:8880' }),
    /must not contain credentials/,
  );
  assert.throws(
    () => loadConfig({ AZTEC_NODE_URL: 'http://user:password@localhost:8080' }),
    /must not contain credentials/,
  );
  assert.throws(
    () => loadConfig({ COLLECTOR_POLL_INTERVAL_MS: '10' }),
    /between 1000 and 3600000/,
  );
  assert.throws(
    () => loadConfig({ AZTEC_SYNC_MAX_L1_AGE_MS: '999' }),
    /between 1000 and 86400000/,
  );
  assert.throws(
    () => loadConfig({ AZTEC_SYNC_MAX_L2_STALL_MS: '86400001' }),
    /between 1000 and 86400000/,
  );
  assert.throws(
    () => loadConfig({ DELIVERY_CONCURRENCY: '0' }),
    /between 1 and 50/,
  );
  assert.throws(
    () => loadConfig({ DELIVERY_CONCURRENCY: '51' }),
    /between 1 and 50/,
  );
  assert.throws(
    () => loadConfig({ L1_SLASH_LOG_CHUNK_SIZE: '12', L1_SLASH_LOG_OVERLAP_BLOCKS: '12' }),
    /must be smaller than L1_SLASH_LOG_CHUNK_SIZE/,
  );
  assert.throws(
    () => loadConfig({ L1_SLASH_LOG_OVERLAP_BLOCKS: '20', L1_SLASH_LOG_REORG_REWIND_BLOCKS: '19' }),
    /must be at least L1_SLASH_LOG_OVERLAP_BLOCKS/,
  );
  assert.throws(
    () => loadConfig({ L1_MAX_HEAD_AGE_MS: '60000', L1_MAX_HEAD_STALL_MS: '120000' }),
    /must not exceed L1_MAX_HEAD_AGE_MS/,
  );
  assert.throws(
    () => loadConfig({ L1_SLASH_LOG_PROVIDER_TIMEOUT_MS: '20000', L1_SLASH_LOG_MAX_RUN_MS: '20000' }),
    /must be smaller than L1_SLASH_LOG_MAX_RUN_MS/,
  );
  assert.throws(
    () => loadConfig({ DELIVERY_REQUEST_TIMEOUT_MS: '20001' }),
    /between 100 and 20000/,
  );
  assert.throws(
    () => loadConfig({
      DELIVERY_POLL_INTERVAL_MS: '1000',
      DELIVERY_LEASE_MS: '10000',
      DELIVERY_REQUEST_TIMEOUT_MS: '9001',
    }),
    /must cover DELIVERY_REQUEST_TIMEOUT_MS plus DELIVERY_POLL_INTERVAL_MS/,
  );

  const config = loadConfig({
    AZTEC_ADMIN_API_KEY: 'secret-key',
    AZTEC_NODE_URL: 'https://aztec-node.example/rpc',
    AZTEC_NODE_API_KEY: 'node-secret-key',
    COLLECTOR_POLL_INTERVAL_MS: '2000',
    COLLECTOR_MAX_BACKOFF_MS: '1000',
    AZTEC_SYNC_MAX_L1_AGE_MS: '60000',
    AZTEC_SYNC_MAX_L2_STALL_MS: '120000',
    DELIVERY_CONCURRENCY: '12',
    DELIVERY_POLL_INTERVAL_MS: '1000',
    DELIVERY_LEASE_MS: '10000',
    DELIVERY_REQUEST_TIMEOUT_MS: '9000',
  });
  assert.equal(config.adminApiKey, 'secret-key');
  assert.equal(config.nodeUrl, 'https://aztec-node.example/rpc');
  assert.equal(config.nodeApiKey, 'node-secret-key');
  assert.equal(config.maxBackoffMs, 2000);
  assert.equal(config.syncMaxL1AgeMs, 60_000);
  assert.equal(config.syncMaxL2StallMs, 120_000);
  assert.equal(config.deliveryConcurrency, 12);
  assert.equal(config.deliveryLeaseMs, 10_000);
});

test('loadConfig requires complete Telegram and VAPID credential sets', () => {
  assert.throws(
    () => loadConfig({ TELEGRAM_BOT_TOKEN: 'secret-token' }),
    /TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME must be set together/,
  );
  assert.throws(
    () => loadConfig({ TELEGRAM_BOT_USERNAME: 'slashmon_bot' }),
    /TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME must be set together/,
  );
  assert.throws(
    () => loadConfig({ TELEGRAM_BOT_TOKEN: 'secret-token', TELEGRAM_BOT_USERNAME: 'bad-name!' }),
    /TELEGRAM_BOT_USERNAME is invalid/,
  );
  assert.throws(
    () => loadConfig({ VAPID_SUBJECT: 'mailto:operator@example.com' }),
    /VAPID_SUBJECT, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY must be set together/,
  );
  assert.throws(
    () => loadConfig({
      VAPID_SUBJECT: 'ftp://example.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    }),
    /VAPID_SUBJECT must use mailto or https/,
  );
  assert.throws(
    () => loadConfig({
      VAPID_SUBJECT: 'mailto:not-an-address',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    }),
    /valid mailto or HTTPS URL/,
  );
  assert.throws(
    () => loadConfig({
      VAPID_SUBJECT: 'https://',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    }),
    /valid mailto or HTTPS URL/,
  );
  assert.throws(
    () => loadConfig({
      VAPID_SUBJECT: 'mailto:operator@example.com',
      VAPID_PUBLIC_KEY: `${VAPID_PUBLIC_KEY}=`,
      VAPID_PRIVATE_KEY,
    }),
    /base64url-encoded VAPID key/,
  );
  assert.throws(
    () => loadConfig({
      VAPID_SUBJECT: 'mailto:operator@example.com',
      VAPID_PUBLIC_KEY: 'not-a-public-key',
      VAPID_PRIVATE_KEY,
    }),
    /VAPID_PUBLIC_KEY is not a valid VAPID key/,
  );
  assert.throws(
    () => loadConfig({
      VAPID_SUBJECT: 'mailto:operator@example.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: Buffer.alloc(32, 4).toString('base64url'),
    }),
    /must be a valid keypair/,
  );

  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'secret-token',
    TELEGRAM_BOT_USERNAME: '@slashmon_bot',
    TELEGRAM_POLL_TIMEOUT_SECONDS: '40',
    VAPID_SUBJECT: 'mailto:operator@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  });
  assert.deepEqual(config.telegram, {
    token: 'secret-token',
    username: 'slashmon_bot',
    pollTimeoutSeconds: 40,
  });
  assert.deepEqual(config.vapid, {
    subject: 'mailto:operator@example.com',
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  });
});

test('loadConfig enforces one exact CORS origin and parses L1 failover URLs', () => {
  assert.throws(
    () => loadConfig({ SLASHMON_NETWORK: 'sepolia' }),
    /must be mainnet or testnet/,
  );
  assert.throws(
    () => loadConfig({ COLLECTOR_CORS_ORIGIN: '*' }),
    /COLLECTOR_CORS_ORIGIN must be a valid URL/,
  );
  assert.throws(
    () => loadConfig({ COLLECTOR_CORS_ORIGIN: 'https://slashmon.example/api' }),
    /must be an origin without a path/,
  );
  assert.throws(
    () => loadConfig({ SLASHMON_PUBLIC_URL: 'https://slashmon.example/app?leak=1' }),
    /must not contain a query or fragment/,
  );
  assert.throws(
    () => loadConfig({
      SLASHMON_PUBLIC_URL: 'http://slashmon.example',
      COLLECTOR_CORS_ORIGIN: 'http://slashmon.example',
    }),
    /must use HTTPS outside localhost\/loopback development/,
  );
  assert.throws(
    () => loadConfig({
      SLASHMON_PUBLIC_URL: 'https://slashmon.example',
      COLLECTOR_CORS_ORIGIN: 'https://app.example',
    }),
    /must use the same browser origin/,
  );
  assert.throws(
    () => loadConfig({ API_TRUST_LOOPBACK_PROXY: 'yes' }),
    /must be true or false/,
  );
  assert.throws(
    () => loadConfig({ L1_RPC_URL: 'https://user:secret@rpc.example' }),
    (error) => {
      assert.match(error.message, /must not contain credentials/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );

  const config = loadConfig({
    SLASHMON_PUBLIC_URL: 'https://slashmon.example/slashmon',
    COLLECTOR_CORS_ORIGIN: 'https://slashmon.example',
    L1_RPC_URL: 'https://rpc-one.example, https://rpc-two.example/path',
    L1_CONFIRMATIONS: '4',
    API_TRUST_LOOPBACK_PROXY: 'true',
  });
  assert.equal(config.corsOrigin, 'https://slashmon.example');
  assert.equal(config.publicUrl, 'https://slashmon.example/slashmon/');
  assert.deepEqual(config.l1RpcUrls, [
    'https://rpc-one.example/',
    'https://rpc-two.example/path',
  ]);
  assert.equal(config.l1Confirmations, 4);
  assert.equal(config.trustLoopbackProxy, true);
});
