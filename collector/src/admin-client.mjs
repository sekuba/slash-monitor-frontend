import { parseOffenseSnapshot } from './offenses.mjs';

export class AztecAdminClient {
  constructor({
    url,
    nodeUrl = url,
    apiKey,
    nodeApiKey,
    timeoutMs = 10_000,
    maxResponseBytes = 2 * 1024 * 1024,
    maxOffenses = 100_000,
    fetchImpl = fetch,
  }) {
    this.url = url;
    this.nodeUrl = nodeUrl;
    this.apiKey = apiKey;
    this.nodeApiKey = nodeApiKey;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.maxOffenses = maxOffenses;
    this.fetchImpl = fetchImpl;
    this.nextId = 1;
  }

  async getAllSlashOffenses(signal) {
    const result = await this.call('aztecAdmin_getSlashOffenses', ['all'], signal);
    return parseOffenseSnapshot(result, this.maxOffenses);
  }

  async getNodeInfo(signal) {
    const result = await this.call('aztec_getNodeInfo', [], signal);
    return parseNodeInfo(result);
  }

  async getNodeSyncStatus(signal) {
    const [ready, l1Timestamp, l2Slot, l2Epoch] = await Promise.all([
      this.call('aztec_isReady', [], signal),
      this.call('aztec_getSyncedL1Timestamp', [], signal),
      this.call('aztec_getSyncedL2SlotNumber', [], signal),
      this.call('aztec_getSyncedL2EpochNumber', [], signal),
    ]);
    return parseNodeSyncStatus({ ready, l1Timestamp, l2Slot, l2Epoch });
  }

  async call(method, params, signal) {
    let request;
    if (method === 'aztecAdmin_getSlashOffenses' && isExactParams(params, ['all'])) {
      request = { url: this.url, apiKey: this.apiKey, label: 'Aztec admin' };
    } else if (
      [
        'aztec_getNodeInfo',
        'aztec_isReady',
        'aztec_getSyncedL1Timestamp',
        'aztec_getSyncedL2SlotNumber',
        'aztec_getSyncedL2EpochNumber',
      ].includes(method) && isExactParams(params, [])
    ) {
      request = { url: this.nodeUrl, apiKey: this.nodeApiKey, label: 'Aztec node' };
    } else {
      throw new Error(`Aztec RPC method or parameters are not allowed: ${method}`);
    }

    const id = this.nextId++;
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(request.apiKey ? { 'x-api-key': request.apiKey } : {}),
    };

    let response;
    try {
      response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: requestSignal,
      });
    } catch (error) {
      if (requestSignal.aborted && !signal?.aborted) {
        throw new Error(`${request.label} request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`${request.label} request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const body = await readLimitedBody(response, this.maxResponseBytes, request.label);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`${request.label} returned invalid JSON with HTTP ${response.status}`);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`${request.label} returned an invalid JSON-RPC response`);
    }
    if (payload.id !== id) {
      throw new Error(`${request.label} response id mismatch: expected ${id}`);
    }
    if (payload.error) {
      const message = typeof payload.error.message === 'string' ? payload.error.message : 'unknown JSON-RPC error';
      throw new Error(`${request.label} JSON-RPC error: ${message}`);
    }
    if (!response.ok) {
      throw new Error(`${request.label} returned HTTP ${response.status}`);
    }
    if (!Object.hasOwn(payload, 'result')) {
      throw new Error(`${request.label} response did not include a result`);
    }
    return payload.result;
  }
}

export function parseNodeInfo(value) {
  if (!isPlainObject(value)) {
    throw new Error('Aztec node info must be an object');
  }
  const contracts = value.l1ContractAddresses;
  if (!isPlainObject(contracts)) {
    throw new Error('Aztec node info must include l1ContractAddresses');
  }
  return {
    l1ChainId: parseChainId(value.l1ChainId),
    registryAddress: parseIdentityAddress(contracts.registryAddress, 'registryAddress'),
    rollupAddress: parseIdentityAddress(contracts.rollupAddress, 'rollupAddress'),
  };
}

export function parseNodeSyncStatus(value) {
  if (!isPlainObject(value) || typeof value.ready !== 'boolean') {
    throw new Error('Aztec node sync readiness must be a boolean');
  }
  return {
    ready: value.ready,
    l1Timestamp: parseOptionalUnsignedInteger(value.l1Timestamp, 'synced L1 timestamp'),
    l2Slot: parseOptionalUnsignedInteger(value.l2Slot, 'synced L2 slot'),
    l2Epoch: parseOptionalUnsignedInteger(value.l2Epoch, 'synced L2 epoch'),
  };
}

function isExactParams(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseChainId(value) {
  let parsed;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && (/^[0-9]+$/.test(value) || /^0x[0-9a-f]+$/i.test(value))) {
    const bigint = BigInt(value);
    if (bigint > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Aztec node info l1ChainId exceeds the safe integer range');
    }
    parsed = Number(bigint);
  } else {
    throw new Error('Aztec node info l1ChainId must be a positive integer');
  }
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('Aztec node info l1ChainId must be a positive integer');
  }
  return parsed;
}

function parseIdentityAddress(value, name) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`Aztec node info ${name} must be a nonzero 20-byte hex address`);
  }
  return value.toLowerCase();
}

function parseOptionalUnsignedInteger(value, label) {
  if (value === null) return undefined;
  let parsed;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    parsed = BigInt(value);
  } else if (typeof value === 'string' && (/^[0-9]+$/.test(value) || /^0x[0-9a-f]+$/i.test(value))) {
    parsed = BigInt(value);
  } else {
    throw new Error(`Aztec node ${label} must be null or an unsigned integer`);
  }
  return parsed.toString();
}

async function readLimitedBody(response, maxBytes, label) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`${label} response exceeds ${maxBytes} bytes`);
  }

  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} response exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length).toString('utf8');
}
