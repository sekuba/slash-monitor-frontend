import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  AztecAdminClient,
  parseNodeInfo,
  parseNodeSyncStatus,
} from '../src/admin-client.mjs';
import { OFFENSE_A } from './helpers.mjs';

test('AztecAdminClient calls getSlashOffenses(all) with the admin API key', async (t) => {
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers['x-api-key'], 'test-secret');
    const body = JSON.parse(await readBody(request));
    assert.deepEqual(body, {
      jsonrpc: '2.0',
      id: 1,
      method: 'aztecAdmin_getSlashOffenses',
      params: ['all'],
    });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: [OFFENSE_A] }));
  });
  const address = await listen(server);
  t.after(() => close(server));

  const client = new AztecAdminClient({
    url: `http://127.0.0.1:${address.port}`,
    apiKey: 'test-secret',
  });
  const offenses = await client.getAllSlashOffenses();

  assert.equal(offenses.length, 1);
  assert.equal(offenses[0].offenseTypeName, 'inactivity');
  await assert.rejects(() => client.call('aztecAdmin_pauseValidator', []), /not allowed/);
});

test('AztecAdminClient reports JSON-RPC errors without accepting partial data', async (t) => {
  const server = http.createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request));
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32000, message: 'Unauthorized' },
    }));
  });
  const address = await listen(server);
  t.after(() => close(server));

  const client = new AztecAdminClient({ url: `http://127.0.0.1:${address.port}` });
  await assert.rejects(() => client.getAllSlashOffenses(), /JSON-RPC error: Unauthorized/);
});

test('AztecAdminClient fetches and strictly normalizes identity from the node RPC', async (t) => {
  const registryAddress = '0xAa00000000000000000000000000000000000001';
  const rollupAddress = '0xBb00000000000000000000000000000000000002';
  const requestedMethods = [];
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers['x-api-key'], 'node-secret');
    const body = JSON.parse(await readBody(request));
    requestedMethods.push(body.method);
    assert.deepEqual(body.params, []);
    const result = {
      aztec_getNodeInfo: {
        l1ChainId: '0x1',
        l1ContractAddresses: { registryAddress, rollupAddress },
      },
      aztec_isReady: true,
      aztec_getSyncedL1Timestamp: '0x65',
      aztec_getSyncedL2SlotNumber: '102',
      aztec_getSyncedL2EpochNumber: 7,
    }[body.method];
    assert.notEqual(result, undefined);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result,
    }));
  });
  const address = await listen(server);
  t.after(() => close(server));

  const client = new AztecAdminClient({
    url: 'http://127.0.0.1:8880',
    nodeUrl: `http://127.0.0.1:${address.port}`,
    nodeApiKey: 'node-secret',
  });
  assert.deepEqual(await client.getNodeInfo(), {
    l1ChainId: 1,
    registryAddress: registryAddress.toLowerCase(),
    rollupAddress: rollupAddress.toLowerCase(),
  });
  assert.deepEqual(await client.getNodeSyncStatus(), {
    ready: true,
    l1Timestamp: '101',
    l2Slot: '102',
    l2Epoch: '7',
  });
  assert.deepEqual(requestedMethods.sort(), [
    'aztec_getNodeInfo',
    'aztec_getSyncedL2SlotNumber',
    'aztec_isReady',
    'aztec_getSyncedL1Timestamp',
    'aztec_getSyncedL2EpochNumber',
  ].sort());
  await assert.rejects(() => client.call('aztec_getNodeInfo', ['unexpected']), /not allowed/);
});

test('parseNodeInfo rejects ambiguous or incomplete identity data', () => {
  const valid = {
    l1ChainId: 1,
    l1ContractAddresses: {
      registryAddress: '0x0000000000000000000000000000000000000001',
      rollupAddress: '0x0000000000000000000000000000000000000002',
    },
  };
  assert.throws(() => parseNodeInfo(null), /must be an object/);
  assert.throws(() => parseNodeInfo({ ...valid, l1ChainId: 1.5 }), /positive integer/);
  assert.throws(() => parseNodeInfo({ ...valid, l1ChainId: '9007199254740992' }), /safe integer/);
  assert.throws(() => parseNodeInfo({ ...valid, l1ContractAddresses: {} }), /registryAddress/);
  assert.throws(() => parseNodeInfo({
    ...valid,
    l1ContractAddresses: { ...valid.l1ContractAddresses, rollupAddress: `0x${'0'.repeat(40)}` },
  }), /rollupAddress/);
});

test('parseNodeSyncStatus rejects ambiguous cursors and preserves large integers', () => {
  assert.deepEqual(parseNodeSyncStatus({
    ready: false,
    l1Timestamp: null,
    l2Slot: '9007199254740992000',
    l2Epoch: '0x10',
  }), {
    ready: false,
    l1Timestamp: undefined,
    l2Slot: '9007199254740992000',
    l2Epoch: '16',
  });
  assert.throws(() => parseNodeSyncStatus({
    ready: 1,
    l1Timestamp: '1',
    l2Slot: '2',
    l2Epoch: '3',
  }), /readiness must be a boolean/);
  assert.throws(() => parseNodeSyncStatus({
    ready: true,
    l1Timestamp: -1,
    l2Slot: '2',
    l2Epoch: '3',
  }), /synced L1 timestamp/);
  assert.throws(() => parseNodeSyncStatus({
    ready: true,
    l1Timestamp: '1',
    l2Slot: 9_007_199_254_740_992,
    l2Epoch: '3',
  }), /synced L2 slot/);
});

test('AztecAdminClient applies a request timeout', async () => {
  const fetchImpl = async (_url, { signal }) => await new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const client = new AztecAdminClient({ url: 'http://127.0.0.1:8880', timeoutMs: 10, fetchImpl });

  await assert.rejects(() => client.getAllSlashOffenses(), /timed out after 10ms/);
});

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
