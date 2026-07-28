import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L1Scanner,
  annotateSlashActions,
  calculateStatus,
  deduplicateStacks,
  scanRound,
} from '../src/l1-scanner.mjs';

const REGISTRY = '0x35b22e09Ee0390539439E24f06Da43D83f90e298';
const SLASHER = '0x2000000000000000000000000000000000000002';
const PROPOSER = '0x3000000000000000000000000000000000000003';
const TARGET = '0x5000000000000000000000000000000000000005';
const SECOND_TARGET = '0x6000000000000000000000000000000000000006';
const PAYLOAD = '0x7000000000000000000000000000000000000007';

test('L1 head freshness and progress checks fail closed', () => {
  const scanner = new L1Scanner({
    rpcUrls: ['https://rpc.example'],
    chainId: 1,
    registryAddress: REGISTRY,
    confirmations: 1,
    maxHeadAgeMs: 1_000,
    maxFutureSkewMs: 1_000,
    maxHeadStallMs: 120_000,
    now: () => 1_000_000,
  });

  assert.doesNotThrow(() => scanner.assertFreshTimestamp(999n));
  assert.doesNotThrow(() => scanner.assertFreshTimestamp(1_001n));
  assert.throws(() => scanner.assertFreshTimestamp(998n), /L1 head is 2000ms old/);
  assert.throws(() => scanner.assertFreshTimestamp(1_002n), /2000ms in the future/);
  assert.throws(() => scanner.assertHeadProgress(
    { number: 101n, timestamp: 879n },
    { lastBlockNumber: '100' },
    100n,
  ), /has not advanced for 121000ms/);
});

test('round status preserves execution, expiry, quorum, and execution boundaries', () => {
  const common = {
    round: 100n,
    currentRound: 100n,
    currentSlot: 12_800n,
    isExecuted: false,
    isVetoed: false,
    hasActions: true,
    executableSlot: 16_512n,
    lifetimeInRounds: 34n,
    executionDelayInRounds: 28n,
  };

  assert.equal(calculateStatus({ ...common, isExecuted: true }), 'executed');
  assert.equal(calculateStatus({ ...common, currentRound: 135n }), 'expired');
  assert.equal(calculateStatus({ ...common, hasActions: false }), 'below-quorum');
  assert.equal(calculateStatus({ ...common, currentRound: 101n, hasActions: false }), 'no-consensus');
  assert.equal(calculateStatus({ ...common, currentRound: 101n, isVetoed: true }), 'vetoed');
  assert.equal(calculateStatus({ ...common, isVetoed: true }), 'quorum-reached');
  assert.equal(calculateStatus({ ...common, currentRound: 129n, currentSlot: 16_511n }), 'quorum-reached');
  assert.equal(calculateStatus({ ...common, currentRound: 129n, currentSlot: 16_512n }), 'newly-executable');
  assert.equal(calculateStatus({ ...common, currentRound: 130n, currentSlot: 16_640n }), 'executable');
});

test('only active and currently authorized legacy stack roles survive deduplication', () => {
  assert.deepEqual(deduplicateStacks([
    { role: 'legacy', slasherAddress: SLASHER },
    { role: 'active', slasherAddress: SLASHER },
    { role: 'pending', slasherAddress: SECOND_TARGET },
  ]), [
    { role: 'active', slasherAddress: SLASHER },
  ]);
});

test('below-quorum rounds do not read committees, per-vote state, tallies, or payloads', async () => {
  const calls = [];
  const client = {
    async readContract({ functionName }) {
      calls.push(functionName);
      if (functionName === 'getRound') return [false, 2n];
      throw new Error(`unexpected ${functionName}`);
    },
  };

  const round = await scanRound(client, roundInput({ quorum: 3n }));

  assert.deepEqual(calls, ['getRound']);
  assert.equal(round.status, 'below-quorum');
  assert.deepEqual(round.actions, []);
  assert.equal(round.payloadAddress, null);
});

test('quorum reads the final tally and preserves every raw action with committee provenance', async () => {
  const calls = [];
  const client = {
    async readContract({ functionName }) {
      calls.push(functionName);
      if (functionName === 'getRound') return [false, 3n];
      if (functionName === 'getSlashTargetCommittees') {
        return [[TARGET, TARGET], [SECOND_TARGET]];
      }
      if (functionName === 'getTally') {
        return [
          { validator: TARGET, slashAmount: 10n },
          { validator: TARGET, slashAmount: 20n },
          { validator: SECOND_TARGET, slashAmount: 30n },
        ];
      }
      if (functionName === 'getPayloadAddress') return PAYLOAD;
      if (functionName === 'vetoedPayloads') return false;
      throw new Error(`unexpected ${functionName}`);
    },
  };

  const round = await scanRound(client, roundInput({ quorum: 3n }));

  assert.deepEqual(calls, [
    'getRound',
    'getSlashTargetCommittees',
    'getTally',
    'getPayloadAddress',
    'vetoedPayloads',
  ]);
  assert.deepEqual(round.actions, [
    {
      validator: TARGET.toLowerCase(),
      amount: '10',
      actionIndex: 0,
      epoch: '0',
      epochIndex: 0,
      committeeIndex: 0,
    },
    {
      validator: TARGET.toLowerCase(),
      amount: '20',
      actionIndex: 1,
      epoch: '0',
      epochIndex: 0,
      committeeIndex: 1,
    },
    {
      validator: SECOND_TARGET.toLowerCase(),
      amount: '30',
      actionIndex: 2,
      epoch: '1',
      epochIndex: 1,
      committeeIndex: 0,
    },
  ]);
});

test('action annotation does not merge duplicate validator actions', () => {
  assert.equal(annotateSlashActions(
    [
      { validator: TARGET, slashAmount: 1n },
      { validator: TARGET, slashAmount: 2n },
    ],
    [[TARGET, TARGET]],
    ['42'],
  ).length, 2);
});

function roundInput({ quorum }) {
  return {
    proposerAddress: PROPOSER,
    slasherAddress: SLASHER,
    blockNumber: 100n,
    round: 2n,
    currentRound: 2n,
    currentSlot: 20n,
    config: {
      quorum,
      roundSize: 10n,
      roundSizeInEpochs: 2n,
      executionDelayInRounds: 2n,
      lifetimeInRounds: 4n,
      slashOffsetInRounds: 2n,
    },
    isSlashingEnabled: true,
  };
}
