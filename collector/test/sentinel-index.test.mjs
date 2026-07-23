import assert from 'node:assert/strict';
import test from 'node:test';

import { OffenseRepository } from '../src/database.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import {
  SentinelCollector,
  latestReadyEpoch,
  validateSentinelProgress,
} from '../src/sentinel-collector.mjs';
import {
  OFFENSE_A,
  SEQUENCER_A,
  SEQUENCER_B,
  silentLogger,
} from './helpers.mjs';

const REGISTRY = '0x0000000000000000000000000000000000000001';
const ROLLUP = '0x0000000000000000000000000000000000000002';
const BLOCK_HASH = `0x${'10'.repeat(32)}`;

test('sentinel collector reports an unavailable L1 dependency before parsing its metadata', async () => {
  const repository = new OffenseRepository(':memory:');
  try {
    const collector = new SentinelCollector({
      client: {},
      committeeScanner: {},
      repository,
      expectedChainId: 1,
      expectedRegistryAddress: REGISTRY,
      pollIntervalMs: 60_000,
      maxBackoffMs: 60_000,
      logger: silentLogger,
      now: () => 1_000,
    });

    const result = await collector.runOnce();
    assert.equal(result.ok, false);
    assert.match(result.error, /Canonical L1 Rollup is unavailable/);
  } finally {
    repository.close();
  }
});

test('sentinel collector indexes only L1 committee members for the shared three-epoch lookback', async () => {
  const repository = new OffenseRepository(':memory:');
  let now = 1_000;
  let syncedSlot = 17;
  let l1Slot = 17;
  const committeeEpochs = [];
  const validatorCalls = [];
  const administrativeCalls = [];
  try {
    recordL1(repository, l1Slot);
    const collector = new SentinelCollector({
      client: {
        async getNodeInfo() {
          administrativeCalls.push('identity');
          return { l1ChainId: 1, registryAddress: REGISTRY, rollupAddress: ROLLUP };
        },
        async getSentinelSyncStatus() {
          administrativeCalls.push('sync');
          return { ready: true, l2Slot: String(syncedSlot) };
        },
        async getValidatorStats(sequencer, fromSlot, toSlot) {
          validatorCalls.push({ sequencer, fromSlot, toSlot });
          if (sequencer === SEQUENCER_B) return undefined;
          const epoch = Number(fromSlot) / 4;
          return validatorStats(sequencer, epoch, Number(fromSlot), Number(toSlot), [
            missed(Number(fromSlot)),
          ]);
        },
        async getInactivityConfig() {
          administrativeCalls.push('config');
          return config();
        },
      },
      committeeScanner: {
        async getEpochCommittee(checkpoint) {
          committeeEpochs.push(Number(checkpoint.epoch));
          return {
            epoch: checkpoint.epoch,
            committee: [SEQUENCER_A, SEQUENCER_B],
            rollupAddress: ROLLUP,
            blockNumber: checkpoint.blockNumber,
            blockHash: checkpoint.blockHash,
          };
        },
      },
      repository,
      network: 'mainnet',
      expectedChainId: 1,
      expectedRegistryAddress: REGISTRY,
      pollIntervalMs: 60_000,
      maxBackoffMs: 60_000,
      lookbackEpochs: 3,
      validatorConcurrency: 2,
      logger: silentLogger,
      now: () => now,
    });

    const bootstrap = await collector.runOnce();
    assert.equal(bootstrap.ok, true);
    assert.equal(bootstrap.epochsIndexed, 3);
    assert.deepEqual(committeeEpochs, [1, 2, 3]);
    assert.equal(validatorCalls.length, 6);
    assert.deepEqual(
      [...new Set(validatorCalls.map(({ sequencer }) => sequencer))],
      [SEQUENCER_A, SEQUENCER_B],
    );
    assert.deepEqual(
      validatorCalls.map(({ fromSlot, toSlot }) => [fromSlot, toSlot]),
      [
        ['4', '7'], ['4', '7'],
        ['8', '11'], ['8', '11'],
        ['12', '15'], ['12', '15'],
      ],
    );
    assert.equal(repository.listEvents({ network: 'mainnet' }).data.length, 0);
    assert.deepEqual(
      repository.db.prepare(`
        SELECT epoch, missed, total
        FROM validator_epoch_performance
        WHERE sequencer = ?
        ORDER BY epoch ASC
      `).all(SEQUENCER_B)
        .map(({ epoch, missed: count, total }) => ({
          epoch: String(epoch),
          missed: count,
          total,
        })),
      [
        { epoch: '1', missed: 0, total: 0 },
        { epoch: '2', missed: 0, total: 0 },
        { epoch: '3', missed: 0, total: 0 },
      ],
    );

    administrativeCalls.length = 0;
    validatorCalls.length = 0;
    committeeEpochs.length = 0;
    now = 2_000;
    const idle = await collector.runOnce();
    assert.equal(idle.epochsIndexed, 0);
    assert.deepEqual(administrativeCalls, ['sync']);
    assert.deepEqual(validatorCalls, []);
    assert.deepEqual(committeeEpochs, []);

    now = 3_000;
    syncedSlot = 21;
    l1Slot = 21;
    recordL1(repository, l1Slot, '101');
    const forward = await collector.runOnce();
    assert.equal(forward.epochsIndexed, 1);
    assert.equal(forward.events, 2);
    assert.deepEqual(committeeEpochs, [4]);
    assert.deepEqual(
      repository.listEvents({ network: 'mainnet' }).data.map((event) => event.type).sort(),
      ['inactivity_epoch_completed', 'inactivity_first_miss'],
    );
  } finally {
    repository.close();
  }
});

test('a cursor gap applies the same three epochs to L1 committees and node histories', async () => {
  const repository = new OffenseRepository(':memory:');
  const committeeEpochs = [];
  try {
    repository.recordValidatorEpoch(epochSnapshot(0), config(), {
      epochDuration: 4,
      network: 'mainnet',
      observedAt: 100,
      bootstrap: true,
    });
    repository.recordSourceSuccess('aztec_sentinel', {
      version: 2,
      bootstrapComplete: true,
      coverageGeneration: 0,
      nodeSyncedSlot: '5',
      lastSyncProgressAt: 100,
      targetPercentage: 0.7,
      consecutiveEpochThreshold: 2,
    }, 100);
    recordL1(repository, 45);
    const collector = new SentinelCollector({
      client: {
        async getNodeInfo() {
          return { l1ChainId: 1, registryAddress: REGISTRY, rollupAddress: ROLLUP };
        },
        async getSentinelSyncStatus() {
          return { ready: true, l2Slot: '45' };
        },
        async getInactivityConfig() {
          return config();
        },
        async getValidatorStats(sequencer, fromSlot, toSlot) {
          const epoch = Number(fromSlot) / 4;
          return validatorStats(sequencer, epoch, Number(fromSlot), Number(toSlot), [
            observed(Number(fromSlot)),
          ]);
        },
      },
      committeeScanner: {
        async getEpochCommittee(checkpoint) {
          committeeEpochs.push(Number(checkpoint.epoch));
          return {
            ...checkpoint,
            committee: [SEQUENCER_A],
          };
        },
      },
      repository,
      network: 'mainnet',
      expectedChainId: 1,
      expectedRegistryAddress: REGISTRY,
      pollIntervalMs: 60_000,
      maxBackoffMs: 60_000,
      lookbackEpochs: 3,
      validatorConcurrency: 8,
      logger: silentLogger,
      now: () => 2_000,
    });

    const result = await collector.runOnce();
    assert.equal(result.ok, true);
    assert.equal(result.coverageReset, true);
    assert.deepEqual(committeeEpochs, [8, 9, 10]);
    assert.deepEqual(
      repository.db.prepare(`
        SELECT epoch, coverage_generation AS coverageGeneration
        FROM validator_indexed_epochs
        ORDER BY epoch ASC
      `).all().map(({ epoch, coverageGeneration }) => ({
        epoch: String(epoch),
        coverageGeneration,
      })),
      [
        { epoch: '0', coverageGeneration: 0 },
        { epoch: '8', coverageGeneration: 1 },
        { epoch: '9', coverageGeneration: 1 },
        { epoch: '10', coverageGeneration: 1 },
      ],
    );
  } finally {
    repository.close();
  }
});

test('epoch persistence rejects node aggregates that disagree with exact-range history', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    const snapshot = epochSnapshot(1);
    snapshot.validators[0].allTimeEpochPerformance[0].missed = 0;
    assert.throws(() => repository.recordValidatorEpoch(snapshot, config(), {
      epochDuration: 4,
      network: 'mainnet',
    }), /history disagrees/);
  } finally {
    repository.close();
  }
});

test('L1 target events carry exact per-address, per-epoch node evidence without claiming an L1 reason', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.recordSuccessfulPoll(parseOffenseSnapshot([OFFENSE_A]), {
      observedAt: 1_000,
      network: 'mainnet',
    });
    repository.recordValidatorEpoch({
      ...epochSnapshot(42, 1),
      fromSlot: '42',
      toSlot: '42',
      validators: [validatorStats(SEQUENCER_A, 42, 42, 42, [missed(42)])],
    }, config(), {
      epochDuration: 1,
      network: 'mainnet',
      observedAt: 1_100,
      bootstrap: true,
    });
    repository.recordSuccessfulL1Snapshot('mainnet', targetingL1Snapshot(), { observedAt: 2_000 });

    const event = repository.listEvents({ network: 'mainnet' }).data
      .find((candidate) => candidate.type === 'onchain_targeted');
    assert.ok(event);
    assert.deepEqual(event.data.nodeEvidence.map((evidence) => ({
      kind: evidence.kind,
      sequencer: evidence.sequencer,
      epoch: evidence.epoch,
      offenseTypeName: evidence.offenseTypeName,
    })), [
      {
        kind: 'inactivity_epoch',
        sequencer: SEQUENCER_A,
        epoch: '42',
        offenseTypeName: 'inactivity precursor',
      },
      {
        kind: 'slash_offense',
        sequencer: SEQUENCER_A,
        epoch: '42',
        offenseTypeName: 'inactivity',
      },
    ]);
  } finally {
    repository.close();
  }
});

test('sentinel readiness honors both the slot-processing lag and epoch-end buffer', () => {
  assert.equal(latestReadyEpoch({
    syncedL2Slot: 4,
    confirmedL1Slot: 100,
    epochDuration: 4,
    epochEndBufferSlots: 2,
  }), -1);
  assert.equal(latestReadyEpoch({
    syncedL2Slot: 5,
    confirmedL1Slot: 100,
    epochDuration: 4,
    epochEndBufferSlots: 2,
  }), 0);
  assert.equal(latestReadyEpoch({
    syncedL2Slot: 8,
    confirmedL1Slot: 7,
    epochDuration: 4,
    epochEndBufferSlots: 4,
  }), 0);
});

test('sentinel progress rejects missing, regressing, and stalled node sync cursors', () => {
  assert.doesNotThrow(() => validateSentinelProgress(
    { ready: true, l2Slot: '10' },
    { observedAt: 1_000, maxStallMs: 500 },
  ));
  assert.throws(() => validateSentinelProgress(
    { ready: false, l2Slot: '10' },
    { observedAt: 1_000, maxStallMs: 500 },
  ), /not ready/);
  assert.throws(() => validateSentinelProgress(
    { ready: true },
    { observedAt: 1_000, maxStallMs: 500 },
  ), /no synced/);
  assert.throws(() => validateSentinelProgress(
    { ready: true, l2Slot: '10' },
    {
      prior: { nodeSyncedSlot: '11', lastSyncProgressAt: 900 },
      observedAt: 1_000,
      maxStallMs: 500,
    },
  ), /regressed/);
  assert.throws(() => validateSentinelProgress(
    { ready: true, l2Slot: '10' },
    {
      prior: { nodeSyncedSlot: '10', lastSyncProgressAt: 400 },
      observedAt: 1_000,
      maxStallMs: 500,
    },
  ), /stalled/);
});

function epochSnapshot(epoch, epochDuration = 4) {
  const fromSlot = epoch * epochDuration;
  const toSlot = fromSlot + epochDuration - 1;
  return {
    epoch: String(epoch),
    fromSlot: String(fromSlot),
    toSlot: String(toSlot),
    committee: [SEQUENCER_A],
    validators: [validatorStats(SEQUENCER_A, epoch, fromSlot, toSlot, [missed(fromSlot)])],
    l1BlockNumber: '100',
    l1BlockHash: BLOCK_HASH,
  };
}

function validatorStats(sequencer, epoch, _fromSlot, toSlot, history) {
  return {
    sequencer,
    history,
    allTimeEpochPerformance: [{
      epoch: String(epoch),
      missed: history.filter((entry) => entry.status.endsWith('missed')).length,
      total: history.length,
    }],
    lastProcessedSlot: String(toSlot),
  };
}

function config() {
  return {
    targetPercentage: 0.7,
    consecutiveEpochThreshold: 2,
  };
}

function missed(slot) {
  return { slot: String(slot), status: 'attestation-missed' };
}

function observed(slot) {
  return { slot: String(slot), status: 'attestation-sent' };
}

function recordL1(repository, currentSlot, blockNumber = '100') {
  repository.recordSuccessfulL1Snapshot('mainnet', {
    chainId: 1,
    blockNumber,
    blockHash: BLOCK_HASH,
    blockTimestamp: '100',
    registryAddress: REGISTRY,
    rollupAddress: ROLLUP,
    rollupVersion: '1',
    l1GenesisTime: '0',
    slotDuration: '1',
    epochDuration: '4',
    currentSlot: String(currentSlot),
    currentEpoch: String(Math.floor(currentSlot / 4)),
    stackErrors: [],
    degraded: false,
    reorgDetected: false,
    stacks: [],
  });
}

function targetingL1Snapshot() {
  return {
    chainId: 1,
    blockNumber: '101',
    blockHash: BLOCK_HASH,
    blockTimestamp: '100',
    registryAddress: REGISTRY,
    rollupAddress: ROLLUP,
    rollupVersion: '1',
    l1GenesisTime: '0',
    slotDuration: '1',
    epochDuration: '1',
    currentSlot: '100',
    currentEpoch: '100',
    stackErrors: [],
    degraded: false,
    reorgDetected: false,
    stacks: [{
      role: 'active',
      slasherAddress: '0x0000000000000000000000000000000000000003',
      proposerAddress: '0x0000000000000000000000000000000000000004',
      currentRound: '7',
      isSlashingEnabled: true,
      slashingDisabledUntil: '0',
      pauseStartedAtSlot: null,
      pauseEndsAtSlot: null,
      parameters: {},
      roundErrors: [],
      rounds: [{
        round: '7',
        ballotCount: '2',
        status: 'quorum-reached',
        isExecuted: false,
        isVetoed: false,
        isAuthorized: true,
        isExecutionPaused: false,
        isProtected: false,
        payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        earlyTargets: [],
        actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
        committees: [],
        targetEpochs: ['42'],
        executableSlot: '110',
        expirySlot: '120',
      }],
    }],
  };
}
