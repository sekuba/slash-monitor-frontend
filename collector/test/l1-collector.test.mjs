import assert from 'node:assert/strict';
import test from 'node:test';

import { OffenseRepository } from '../src/database.mjs';
import { L1Collector } from '../src/l1-collector.mjs';
import { SEQUENCER_A } from './helpers.mjs';

const WATCHLIST_ID = '11111111-1111-4111-8111-111111111111';

test('L1 collector catches up confirmed slash logs from its durable chunk checkpoint', async () => {
  const repository = new OffenseRepository(':memory:');
  let logCalls = 0;
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    const scanner = {
      async scan() {
        return snapshot(200);
      },
      async scanSlashLogChunk(previous) {
        logCalls += 1;
        if (!previous.lastBlockNumber) {
          return slashChunk({
            from: 1,
            to: 2,
            confirmed: 4,
            hasMore: true,
            logs: [slashLog(1)],
            initial: true,
            initialBackfill: true,
          });
        }
        assert.equal(previous.lastBlockNumber, '2', 'chunk one committed before chunk two was requested');
        return slashChunk({ from: 3, to: 4, confirmed: 4, hasMore: false, logs: [] });
      },
    };
    const collector = new L1Collector({
      scanner,
      repository,
      network: 'mainnet',
      pollIntervalMs: 1_000,
      maxBackoffMs: 10_000,
      maxSlashLogChunksPerPoll: 5,
      maxSlashLogRunMs: 5_000,
      logger: silentLogger(),
      now: () => 1_000,
    });

    const result = await collector.runOnce();

    assert.equal(result.ok, true);
    assert.equal(result.slashLogs.ok, true);
    assert.equal(result.slashLogs.chunks, 2);
    assert.equal(result.slashLogs.inserted, 1);
    assert.equal(logCalls, 2);
    assert.equal(repository.getSourceState('l1_slash_logs').lastBlockNumber, '4');
    assert.equal(repository.getDeliveryCounts().pending, 1);
    assert.equal(
      repository.listEvents({ network: 'mainnet' }).data.some((event) => event.type === 'l1_slash_confirmed'),
      true,
    );
  } finally {
    repository.close();
  }
});

test('log backfill yields at its time budget so the next fresh snapshot is not starved', async () => {
  const repository = new OffenseRepository(':memory:');
  let snapshots = 0;
  try {
    const scanner = {
      async scan() {
        snapshots += 1;
        return snapshot(200 + snapshots);
      },
      async scanSlashLogChunk(_previous, signal) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 10_000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason);
          }, { once: true });
        });
        throw new Error('unreachable');
      },
    };
    const collector = new L1Collector({
      scanner,
      repository,
      network: 'mainnet',
      pollIntervalMs: 1_000,
      maxBackoffMs: 10_000,
      maxSlashLogChunksPerPoll: 25,
      maxSlashLogRunMs: 20,
      logger: silentLogger(),
      now: () => 1_000,
    });

    const first = await collector.runOnce();
    const second = await collector.runOnce();

    assert.equal(first.ok, true);
    assert.equal(first.slashLogs.yielded, true);
    assert.equal(second.ok, true);
    assert.equal(snapshots, 2, 'each poll refreshes snapshot state before spending time on backfill');
  } finally {
    repository.close();
  }
});

function snapshot(block) {
  return {
    chainId: 1,
    blockNumber: String(block),
    blockHash: hash(block),
    blockTimestamp: String(block),
    registryAddress: '0x0000000000000000000000000000000000000001',
    rollupAddress: '0x0000000000000000000000000000000000000002',
    rollupVersion: '1',
    currentSlot: '1',
    currentEpoch: '1',
    stackErrors: [],
    degraded: false,
    reorgDetected: false,
    stacks: [],
  };
}

function slashChunk({ from, to, confirmed, logs, hasMore, initial = false, initialBackfill = false }) {
  return {
    chainId: 1,
    fromBlock: String(from),
    toBlock: String(to),
    toBlockHash: hash(to),
    confirmedBlockNumber: String(confirmed),
    registryAddress: '0x0000000000000000000000000000000000000001',
    rollupAddresses: ['0x0000000000000000000000000000000000000002'],
    logs,
    hasMore,
    initial,
    initialBackfill,
    reorgDetected: false,
  };
}

function slashLog(block) {
  return {
    rollupAddress: '0x0000000000000000000000000000000000000002',
    blockNumber: String(block),
    blockHash: hash(block),
    transactionHash: hash(block + 1_000),
    logIndex: 0,
    sequencer: SEQUENCER_A,
    amount: '42',
  };
}

function hash(value) {
  return `0x${Number(value).toString(16).padStart(64, '0')}`;
}

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}
