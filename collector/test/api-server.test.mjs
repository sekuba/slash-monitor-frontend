import assert from 'node:assert/strict';
import test from 'node:test';

import { CollectorApiServer } from '../src/api-server.mjs';
import { OffenseRepository } from '../src/database.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import { OFFENSE_A, SEQUENCER_A, SEQUENCER_B, silentLogger } from './helpers.mjs';

test('API reports health and serves normalized offense records', async (t) => {
  const repository = new OffenseRepository(':memory:');
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: 10_000 });
  const server = new CollectorApiServer({
    repository,
    host: '127.0.0.1',
    port: 0,
    corsOrigin: 'https://monitor.example',
    staleAfterMs: 60_000,
    publicConfig: { pollIntervalMs: 15_000 },
    logger: silentLogger,
    now: () => 20_000,
  });
  const address = await server.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await server.close();
    repository.close();
  });

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).status, 'healthy');

  const listResponse = await fetch(`${baseUrl}/api/v1/offenses`);
  assert.equal(listResponse.headers.get('access-control-allow-origin'), 'https://monitor.example');
  const list = await listResponse.json();
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].offenseTypeName, 'inactivity');
  assert.equal(list.data[0].sequencer, SEQUENCER_A);
  assert.equal(list.pagination.total, 1);

  const filteredResponse = await fetch(`${baseUrl}/api/v1/offenses?sequencer=${SEQUENCER_A}&sequencer=${SEQUENCER_B}`);
  const filtered = await filteredResponse.json();
  assert.equal(filtered.data.length, 1);
  assert.deepEqual(filtered.pagination.sequencers, [
    SEQUENCER_A,
    SEQUENCER_B,
  ]);

  const commaSeparatedResponse = await fetch(`${baseUrl}/api/v1/offenses?sequencer=${SEQUENCER_A},${SEQUENCER_B}`);
  assert.equal((await commaSeparatedResponse.json()).data.length, 1);

  const detailResponse = await fetch(`${baseUrl}/api/v1/offenses/${offense.id}`);
  assert.equal(detailResponse.status, 200);
  assert.equal((await detailResponse.json()).data.id, offense.id);

  const invalidResponse = await fetch(`${baseUrl}/api/v1/offenses?status=invalid`);
  assert.equal(invalidResponse.status, 400);

  const invalidSequencerResponse = await fetch(`${baseUrl}/api/v1/offenses?sequencer=0x1234`);
  assert.equal(invalidSequencerResponse.status, 400);
});

test('health becomes stale without discarding the last snapshot', async (t) => {
  const repository = new OffenseRepository(':memory:');
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);
  repository.recordSuccessfulPoll([offense], { observedAt: 1_000 });
  repository.recordFailure('node unavailable', 2_000);
  const server = new CollectorApiServer({
    repository,
    host: '127.0.0.1',
    port: 0,
    corsOrigin: '*',
    staleAfterMs: 5_000,
    publicConfig: {},
    logger: silentLogger,
    now: () => 10_000,
  });
  const address = await server.listen();
  t.after(async () => {
    await server.close();
    repository.close();
  });

  const healthResponse = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(healthResponse.status, 503);
  assert.equal((await healthResponse.json()).status, 'stale');

  const listResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/offenses`);
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).data.length, 1);
});
