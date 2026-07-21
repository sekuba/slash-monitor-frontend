import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.mjs';

test('loadConfig provides local, conservative defaults', () => {
  const config = loadConfig({}, '/srv/collector');

  assert.equal(config.adminUrl, 'http://127.0.0.1:8880/');
  assert.equal(config.databasePath, '/srv/collector/data/offenses.sqlite');
  assert.equal(config.bindHost, '127.0.0.1');
  assert.equal(config.port, 8790);
  assert.equal(config.withdrawAfterMissedPolls, 3);
  assert.equal(config.adminApiKey, undefined);
});

test('loadConfig validates secrets and numeric settings without exposing credentials in URLs', () => {
  assert.throws(
    () => loadConfig({ AZTEC_ADMIN_URL: 'http://user:password@localhost:8880' }),
    /must not contain credentials/,
  );
  assert.throws(
    () => loadConfig({ COLLECTOR_POLL_INTERVAL_MS: '10' }),
    /between 1000 and 3600000/,
  );

  const config = loadConfig({
    AZTEC_ADMIN_API_KEY: 'secret-key',
    COLLECTOR_POLL_INTERVAL_MS: '2000',
    COLLECTOR_MAX_BACKOFF_MS: '1000',
  });
  assert.equal(config.adminApiKey, 'secret-key');
  assert.equal(config.maxBackoffMs, 2000);
});
