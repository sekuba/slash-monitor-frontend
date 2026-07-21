import http from 'node:http';

const ID_PATTERN = /^[0-9a-f]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const MAX_SEQUENCER_FILTERS = 100;

export class CollectorApiServer {
  constructor({ repository, host, port, corsOrigin, staleAfterMs, publicConfig, logger, now = Date.now }) {
    this.repository = repository;
    this.host = host;
    this.port = port;
    this.corsOrigin = corsOrigin;
    this.staleAfterMs = staleAfterMs;
    this.publicConfig = publicConfig;
    this.logger = logger;
    this.now = now;
    this.server = http.createServer((request, response) => this.handle(request, response));
  }

  listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', onError);
        const address = this.server.address();
        this.logger.info('Collector API listening', { address });
        resolve(address);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  async handle(request, response) {
    setCommonHeaders(response, this.corsOrigin);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'method_not_allowed', message: 'Only GET is supported' } }, { allow: 'GET, OPTIONS' });
      return;
    }

    try {
      const url = new URL(request.url ?? '/', 'http://collector.local');
      if (url.pathname === '/live') {
        writeJson(response, 200, { status: 'ok', now: new Date(this.now()).toISOString() });
        return;
      }
      if (url.pathname === '/health') {
        const health = this.buildHealth();
        writeJson(response, health.httpStatus, health.body);
        return;
      }
      if (url.pathname === '/api/v1/status') {
        const health = this.buildHealth();
        writeJson(response, 200, {
          ...health.body,
          counts: this.repository.getCounts(),
          config: this.publicConfig,
        });
        return;
      }
      if (url.pathname === '/api/v1/offenses') {
        const query = parseListQuery(url.searchParams);
        const offenses = this.repository.listOffenses(query);
        const totalForQuery = this.repository.countOffenses(query);
        writeJson(response, 200, {
          data: offenses,
          pagination: {
            status: query.status,
            limit: query.limit,
            offset: query.offset,
            returned: offenses.length,
            total: totalForQuery,
            sequencers: query.sequencers,
          },
          generatedAt: new Date(this.now()).toISOString(),
        });
        return;
      }
      if (url.pathname.startsWith('/api/v1/offenses/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/v1/offenses/'.length));
        if (!ID_PATTERN.test(id)) {
          throw new HttpError(400, 'invalid_offense_id', 'Offense id must be a 64-character lowercase hex string');
        }
        const offense = this.repository.getOffense(id);
        if (!offense) {
          throw new HttpError(404, 'offense_not_found', 'Offense not found');
        }
        writeJson(response, 200, { data: offense, generatedAt: new Date(this.now()).toISOString() });
        return;
      }
      throw new HttpError(404, 'not_found', 'Route not found');
    } catch (error) {
      if (error instanceof HttpError) {
        writeJson(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      this.logger.error('Collector API request failed', { error: error instanceof Error ? error.message : String(error) });
      writeJson(response, 500, { error: { code: 'internal_error', message: 'Internal server error' } });
    }
  }

  buildHealth() {
    const state = this.repository.getSyncState();
    const now = this.now();
    const ageMs = state.lastSuccessAt === null ? null : Math.max(0, now - state.lastSuccessAt);
    const dataFresh = ageMs !== null && ageMs <= this.staleAfterMs;
    const upstreamReachable = state.lastSuccessAt !== null && state.consecutiveFailures === 0;
    let status;
    let httpStatus;

    if (state.lastSuccessAt === null) {
      status = 'unavailable';
      httpStatus = 503;
    } else if (!dataFresh) {
      status = 'stale';
      httpStatus = 503;
    } else if (!upstreamReachable) {
      status = 'degraded';
      httpStatus = 200;
    } else {
      status = 'healthy';
      httpStatus = 200;
    }

    return {
      httpStatus,
      body: {
        status,
        upstreamReachable,
        dataFresh,
        dataAgeMs: ageMs,
        lastAttemptAt: toIso(state.lastAttemptAt),
        lastSuccessAt: toIso(state.lastSuccessAt),
        consecutiveFailures: state.consecutiveFailures,
        successfulPolls: state.successfulPolls,
        lastError: state.lastError,
        now: new Date(now).toISOString(),
      },
    };
  }
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseListQuery(searchParams) {
  const status = searchParams.get('status') ?? 'active';
  if (!['active', 'withdrawn', 'all'].includes(status)) {
    throw new HttpError(400, 'invalid_status', 'status must be active, withdrawn, or all');
  }
  return {
    status,
    sequencers: parseSequencers(searchParams),
    limit: parseQueryInteger(searchParams.get('limit'), 'limit', 100, 1, 1_000),
    offset: parseQueryInteger(searchParams.get('offset'), 'offset', 0, 0, 1_000_000),
  };
}

function parseSequencers(searchParams) {
  const values = searchParams.getAll('sequencer')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length > MAX_SEQUENCER_FILTERS) {
    throw new HttpError(
      400,
      'too_many_sequencers',
      `At most ${MAX_SEQUENCER_FILTERS} sequencer addresses may be queried at once`,
    );
  }

  const sequencers = [];
  const seen = new Set();
  for (const value of values) {
    if (!ADDRESS_PATTERN.test(value)) {
      throw new HttpError(400, 'invalid_sequencer', 'sequencer must be a 20-byte hex address');
    }
    const normalized = value.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      sequencers.push(normalized);
    }
  }
  return sequencers;
}

function parseQueryInteger(raw, name, defaultValue, min, max) {
  if (raw === null) {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, `invalid_${name}`, `${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function setCommonHeaders(response, corsOrigin) {
  response.setHeader('access-control-allow-origin', corsOrigin);
  response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('x-content-type-options', 'nosniff');
}

function writeJson(response, status, body, headers = {}) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    ...headers,
  });
  response.end(encoded);
}

function toIso(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}
