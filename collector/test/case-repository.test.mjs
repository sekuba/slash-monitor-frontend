import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { CaseRepository } from '../src/case-repository.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import { protocolSnapshot, targetRound } from './v3-fixtures.mjs';

const REGISTRY = '0x1111111111111111111111111111111111111111';
const ROLLUP = '0x2222222222222222222222222222222222222222';
const SLASHER = '0x3333333333333333333333333333333333333333';
const PROPOSER = '0x4444444444444444444444444444444444444444';
const SEQUENCER = '0x5555555555555555555555555555555555555555';
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;

test('CaseRepository projects transitions and queues only matching watched sequencers', () => {
  const repository = createRepository();
  repository.createWatch({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    managementTokenHash: 'hash',
    network: 'mainnet',
    addresses: [SEQUENCER],
    now: 1_700_000_000_000,
  });
  repository.upsertEndpoint({
    watchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    kind: 'telegram',
    destination: '1234',
    now: 1_700_000_000_000,
  });

  const first = repository.recordObservations([
    observation('inactive', 'inactivity_epoch', {
      epoch: 8,
      missed: 8,
      total: 10,
      streak: 1,
      threshold: 2,
      targetPercentage: 0.8,
    }),
  ], { protocol: protocol() });
  assert.equal(first.transitions, 1);
  assert.equal(first.queued, 1);
  assert.equal(repository.getSequencerRecord(SEQUENCER, 'mainnet').cases[0].state.headline,
    '1 of 2 qualifying inactive epochs');

  const duplicate = repository.recordObservations([
    observation('inactive', 'inactivity_epoch', {
      epoch: 8,
      missed: 8,
      total: 10,
      streak: 1,
      threshold: 2,
      targetPercentage: 0.8,
    }),
  ]);
  assert.equal(duplicate.inserted, 0);
  assert.equal(duplicate.transitions, 0);

  const offense = repository.recordObservations([
    observation('offense', 'node_offense', {
      offenseTypeName: 'inactivity',
      status: 'active',
      amount: '1000000000000000000',
      expectedRound: '10',
    }),
  ]);
  assert.equal(offense.transitions, 1);
  assert.equal(repository.getSequencerRecord(SEQUENCER, 'mainnet').cases[0].state.stage,
    'awaiting_round');
  repository.close();
});

test('L1 snapshots preserve a repeated sequencer as two exact target-epoch cases', () => {
  const repository = createRepository();
  repository.recordSuccessfulL1Snapshot('mainnet', {
    chainId: 1,
    blockNumber: '100',
    blockHash: BLOCK_HASH,
    blockTimestamp: '1700000100',
    observedAt: 1_700_000_100_000,
    registryAddress: REGISTRY,
    rollupAddress: ROLLUP,
    l1GenesisTime: '1700000000',
    currentSlot: '100',
    currentEpoch: '10',
    slotDuration: '12',
    epochDuration: '10',
    stacks: [{
      role: 'active',
      rollupAddress: ROLLUP,
      slasherAddress: SLASHER,
      proposerAddress: PROPOSER,
      currentRound: '10',
      isSlashingEnabled: true,
      slashingDisabledUntil: '0',
      parameters: {
        quorum: '2',
        roundSize: '20',
        roundSizeInEpochs: '2',
        executionDelayInRounds: '2',
        lifetimeInRounds: '4',
        slashOffsetInRounds: '1',
        committeeSize: '4',
      },
      rounds: [{
        round: '10',
        status: 'quorum-reached',
        isExecuted: false,
        isVetoed: false,
        isExecutionPaused: false,
        isProtected: false,
        payloadAddress: '0x6666666666666666666666666666666666666666',
        executableSlot: '260',
        expirySlot: '300',
        actions: [
          { sequencer: SEQUENCER, amount: '100' },
          { sequencer: SEQUENCER, amount: '300' },
        ],
        earlyTargets: [],
        actionDetails: [
          {
            sequencer: SEQUENCER,
            targetEpoch: '18',
            epochIndex: 0,
            committeeIndex: 0,
            voteCount: 2,
            support: 2,
            maxSlashUnits: 1,
            unitVoteCounts: [2, 0, 0],
            amount: '100',
          },
          {
            sequencer: SEQUENCER,
            targetEpoch: '19',
            epochIndex: 1,
            committeeIndex: 0,
            voteCount: 2,
            support: 2,
            maxSlashUnits: 3,
            unitVoteCounts: [0, 0, 2],
            amount: '300',
          },
        ],
      }],
    }],
  });
  const cases = repository.getSequencerRecord(SEQUENCER, 'mainnet').cases;
  assert.deepEqual(cases.map((item) => item.targetEpoch).sort(), ['18', '19']);
  assert.deepEqual(
    cases.map((item) => item.state.requestedAmount).sort(),
    ['100', '300'],
  );
  repository.close();
});

test('a repeated sequencer slash uses receipt action order to select the exact epoch', () => {
  const repository = createRepository();
  repository.recordSuccessfulL1Snapshot('mainnet', protocolSnapshot({
    rounds: [{
      ...targetRound({ sequencer: SEQUENCER, targetEpoch: '18', amount: '100' }),
      actions: [
        { sequencer: SEQUENCER, amount: '100' },
        { sequencer: SEQUENCER, amount: '300' },
      ],
      actionDetails: [
        {
          ...targetRound({
            sequencer: SEQUENCER,
            targetEpoch: '18',
            amount: '100',
          }).actionDetails[0],
          actionIndex: 0,
        },
        {
          ...targetRound({
            sequencer: SEQUENCER,
            targetEpoch: '19',
            amount: '300',
          }).actionDetails[0],
          actionIndex: 1,
        },
      ],
    }],
  }));
  repository.recordSuccessfulL1SlashLogChunk('mainnet', {
    fromBlock: '101',
    toBlock: '101',
    toBlockHash: BLOCK_HASH,
    confirmedBlockNumber: '101',
    rollupAddresses: [ROLLUP],
    initialBackfill: false,
    hasMore: false,
    reorgDetected: false,
    logs: [{
      rollupAddress: ROLLUP,
      blockNumber: '101',
      blockHash: BLOCK_HASH,
      transactionHash: `0x${'cd'.repeat(32)}`,
      logIndex: 2,
      transactionSlashIndex: 1,
      sequencer: SEQUENCER,
      amount: '250',
      executionCandidates: [{ proposerAddress: PROPOSER, round: '14' }],
      ejected: false,
    }],
  });
  const cases = repository.getSequencerRecord(SEQUENCER, 'mainnet').cases;
  assert.equal(
    cases.find((item) => item.targetEpoch === '19').state.stage,
    'stake_removed',
  );
  assert.equal(
    cases.find((item) => item.targetEpoch === '18').state.stage,
    'candidate',
  );
  repository.close();
});

test('L1 target removal and restoration produce one corrected case lineage', () => {
  const repository = createRepository();
  repository.recordSuccessfulL1Snapshot('mainnet', protocolSnapshot({
    block: 100,
    rounds: [targetRound({ sequencer: SEQUENCER, targetEpoch: '24' })],
  }));
  assert.equal(repository.listCases({ network: 'mainnet' })[0].state.stage, 'candidate');

  repository.recordSuccessfulL1Snapshot('mainnet', protocolSnapshot({
    block: 101,
    rounds: [{
      ...targetRound({ sequencer: SEQUENCER, targetEpoch: '24', amount: null }),
      actionDetails: [],
    }],
  }));
  assert.equal(repository.listCases({ network: 'mainnet' })[0].state.stage, 'reorged');

  repository.recordSuccessfulL1Snapshot('mainnet', protocolSnapshot({
    block: 102,
    rounds: [targetRound({ sequencer: SEQUENCER, targetEpoch: '24' })],
  }));
  const restored = repository.listCases({ network: 'mainnet' })[0];
  assert.equal(restored.state.stage, 'candidate');
  assert.equal(repository.getCase(restored.id).transitions.length, 3);
  repository.close();
});

test('withdrawn node evidence can reactivate the same exact offense case', () => {
  const repository = createRepository();
  repository.recordSuccessfulL1Snapshot('mainnet', protocolSnapshot(), {
    observedAt: 1_000,
  });
  const [offense] = parseOffenseSnapshot([{
    validator: SEQUENCER,
    amount: '1000',
    offenseType: 3,
    epochOrSlot: '24',
  }]);
  repository.recordSuccessfulPoll([offense], {
    network: 'mainnet',
    observedAt: 2_000,
  });
  repository.recordSuccessfulPoll([], {
    network: 'mainnet',
    observedAt: 3_000,
    withdrawAfterMissedPolls: 1,
    absenceEvidence: {
      epoch: { advanced: true, value: '25' },
      slot: { advanced: false, value: '0' },
    },
  });
  assert.equal(repository.listCases({ network: 'mainnet' })[0].state.stage, 'resolved');

  repository.recordSuccessfulPoll([offense], {
    network: 'mainnet',
    observedAt: 4_000,
  });
  const reactivated = repository.listCases({ network: 'mainnet' })[0];
  assert.equal(reactivated.state.stage, 'node_offense');
  assert.deepEqual(
    reactivated.observations.map((item) => item.data.status),
    ['active', 'withdrawn', 'active'],
  );
  repository.close();
});

test('v3 refuses a nonempty legacy database instead of migrating it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-v3-'));
  const databasePath = path.join(directory, 'legacy.sqlite');
  try {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec('CREATE TABLE events(id TEXT PRIMARY KEY); PRAGMA user_version = 1');
    legacy.close();
    assert.throws(
      () => new CaseRepository(databasePath),
      /requires an empty database; found schema 1/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository() {
  const repository = new CaseRepository(':memory:');
  repository.bindRuntimeIdentity({
    network: 'mainnet',
    chainId: 1,
    registryAddress: REGISTRY,
  });
  return repository;
}

function protocol() {
  return {
    network: 'mainnet',
    chainId: 1,
    observedAt: '2023-11-14T22:13:20.000Z',
    blockNumber: '100',
    blockHash: BLOCK_HASH,
    registryAddress: REGISTRY,
    rollupAddress: ROLLUP,
    genesisTime: '1700000000',
    currentSlot: '100',
    currentEpoch: '10',
    slotDurationSeconds: 12,
    epochDurationSlots: 10,
    inactivity: { targetPercentage: 0.8, consecutiveEpochs: 2 },
    lineages: [{
      role: 'active',
      rollupAddress: ROLLUP,
      slasherAddress: SLASHER,
      proposerAddress: PROPOSER,
      currentRound: '9',
      isSlashingEnabled: true,
      disabledUntil: null,
      parameters: {
        quorum: 2,
        roundSizeSlots: 20,
        roundSizeEpochs: 2,
        executionDelayRounds: 2,
        lifetimeRounds: 4,
        slashOffsetRounds: 6,
        committeeSize: 4,
      },
    }],
  };
}

function observation(id, kind, data) {
  return {
    id,
    network: 'mainnet',
    source: kind === 'node_offense' ? 'aztec_node' : 'aztec_sentinel',
    kind,
    sequencer: SEQUENCER,
    lineageId: PROPOSER,
    targetEpoch: '8',
    provenance: {
      observedAt: id === 'inactive'
        ? '2023-11-14T22:13:20.000Z'
        : '2023-11-14T22:14:20.000Z',
      canonical: true,
    },
    data,
  };
}
