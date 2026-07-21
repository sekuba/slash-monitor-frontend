import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { AztecAdminClient } from '../src/admin-client.mjs';
import { OFFENSE_A } from './helpers.mjs';

test('AztecAdminClient calls only getSlashOffenses(all) with the API key', async (t) => {
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
  await assert.rejects(() => client.call('aztecAdmin_pauseSequencer', []), /not allowed/);
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
