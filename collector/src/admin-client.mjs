import { parseOffenseSnapshot } from './offenses.mjs';

export class AztecAdminClient {
  constructor({ url, apiKey, timeoutMs = 10_000, maxResponseBytes = 2 * 1024 * 1024, maxOffenses = 100_000, fetchImpl = fetch }) {
    this.url = url;
    this.apiKey = apiKey;
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

  async call(method, params, signal) {
    if (method !== 'aztecAdmin_getSlashOffenses') {
      throw new Error(`Admin method is not allowed: ${method}`);
    }

    const id = this.nextId++;
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
    };

    let response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: requestSignal,
      });
    } catch (error) {
      if (requestSignal.aborted && !signal?.aborted) {
        throw new Error(`Aztec admin request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`Aztec admin request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const body = await readLimitedBody(response, this.maxResponseBytes);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`Aztec admin returned invalid JSON with HTTP ${response.status}`);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Aztec admin returned an invalid JSON-RPC response');
    }
    if (payload.id !== id) {
      throw new Error(`Aztec admin response id mismatch: expected ${id}`);
    }
    if (payload.error) {
      const message = typeof payload.error.message === 'string' ? payload.error.message : 'unknown JSON-RPC error';
      throw new Error(`Aztec admin JSON-RPC error: ${message}`);
    }
    if (!response.ok) {
      throw new Error(`Aztec admin returned HTTP ${response.status}`);
    }
    if (!Object.hasOwn(payload, 'result')) {
      throw new Error('Aztec admin response did not include a result');
    }
    return payload.result;
  }
}

async function readLimitedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Aztec admin response exceeds ${maxBytes} bytes`);
  }

  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    throw new Error(`Aztec admin response exceeds ${maxBytes} bytes`);
  }
  return body;
}
