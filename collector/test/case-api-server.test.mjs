import assert from 'node:assert/strict';
import test from 'node:test';

import { CaseApiServer } from '../src/case-api-server.mjs';
import { CaseRepository } from '../src/case-repository.mjs';
import { SEQUENCER_A, SEQUENCER_B, silentLogger } from './helpers.mjs';
import {
  REGISTRY,
  protocolSnapshot,
  targetRound,
} from './case-fixtures.mjs';

test('API exposes current cases and capability-authenticated watches only', async (t) => {
  const apiLogs = [];
  const repository = new CaseRepository(':memory:');
  repository.bindRuntimeIdentity({
    network: 'mainnet',
    chainId: 1,
    registryAddress: REGISTRY,
  });
  repository.recordSuccessfulL1Snapshot('mainnet', protocolSnapshot({
    rounds: [targetRound({ sequencer: SEQUENCER_A, targetEpoch: '24' })],
  }), { observedAt: 1_700_000_200_000 });
  repository.recordSourceSuccess('aztec_node', {}, 1_700_000_200_000);
  repository.recordSourceSuccess('aztec_sentinel', {}, 1_700_000_200_000);
  repository.recordSourceSuccess('l1_slash_logs', {}, 1_700_000_200_000);

  const api = new CaseApiServer({
    repository,
    host: '127.0.0.1',
    port: 0,
    corsOrigin: 'https://slashveto.example',
    network: 'mainnet',
    maxSequencers: 2,
    logger: {
      debug(message, data) {
        apiLogs.push({ level: 'debug', message, data });
      },
      error(message, data) {
        apiLogs.push({ level: 'error', message, data });
      },
    },
    now: () => 1_700_000_201_000,
  });
  const address = await api.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await api.close();
    repository.close();
  });

  const status = await json(base, '/api/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.status, 'healthy');
  assert.deepEqual(
    status.body.sources.map((source) => source.source),
    ['ethereum_l1', 'aztec_node', 'aztec_sentinel'],
  );

  const config = await json(base, '/api/config');
  assert.equal(config.response.status, 200);
  assert.equal(config.body.network, 'mainnet');
  assert.equal('apiVersion' in config.body, false);

  const network = await json(base, '/api/network');
  assert.equal(network.body.cases.length, 1);
  assert.equal(network.body.cases[0].targetEpoch, '24');
  assert.equal(network.body.summary.candidates, 1);

  const created = await json(base, '/api/watches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      network: 'mainnet',
      addresses: [SEQUENCER_A],
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.watch.cases.length, 1);
  assert.match(created.body.managementToken, /^[A-Za-z0-9_-]+$/);

  const watchPath = `/api/watches/${created.body.watch.id}`;
  assert.equal((await json(base, watchPath)).response.status, 401);
  const updated = await json(base, watchPath, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${created.body.managementToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ addresses: [SEQUENCER_A, SEQUENCER_B] }),
  });
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body.addresses, [SEQUENCER_A, SEQUENCER_B]);
  assert.equal(updated.response.headers.get('access-control-allow-origin'), 'https://slashveto.example');

  const versionedApi = await json(base, '/api/v3/network');
  assert.equal(versionedApi.response.status, 404);
  assert.equal(versionedApi.body.error.code, 'not_found');
  assert.deepEqual(apiLogs.at(-1), {
    level: 'debug',
    message: 'API request rejected',
    data: {
      method: 'GET',
      path: '/api/v3/network',
      status: 404,
      code: 'not_found',
      error: 'Route not found',
    },
  });
});

test('API links an encoded case id without an event-feed lookup', async (t) => {
  const repository = new CaseRepository(':memory:');
  repository.bindRuntimeIdentity({
    network: 'mainnet',
    chainId: 1,
    registryAddress: REGISTRY,
  });
  repository.recordSuccessfulL1Snapshot('mainnet', protocolSnapshot({
    rounds: [targetRound({ sequencer: SEQUENCER_A, targetEpoch: '24' })],
  }));
  const [item] = repository.listCases({ network: 'mainnet' });
  const api = new CaseApiServer({
    repository,
    host: '127.0.0.1',
    port: 0,
    corsOrigin: 'https://slashveto.example',
    network: 'mainnet',
    logger: silentLogger,
  });
  const address = await api.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await api.close();
    repository.close();
  });

  const found = await json(base, `/api/cases/${encodeURIComponent(item.id)}`);
  assert.equal(found.response.status, 200);
  assert.equal(found.body.id, item.id);
  assert.ok(found.body.transitions.length >= 1);
});

async function json(base, path, options) {
  const response = await fetch(`${base}${path}`, options);
  return { response, body: await response.json() };
}
