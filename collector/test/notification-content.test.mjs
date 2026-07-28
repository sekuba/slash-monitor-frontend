import assert from 'node:assert/strict';
import test from 'node:test';

import {
  etherscanReferenceLines,
  formatAztecAmount,
  formatEpochRange,
  formatNotificationBody,
  notificationContent,
} from '../src/notification-content.mjs';

const VALIDATOR = '0x1111111111111111111111111111111111111111';
const VALIDATOR_2 = '0x2222222222222222222222222222222222222222';

test('AZTEC amounts and epoch ranges retain exact values', () => {
  assert.equal(formatAztecAmount('2000000000000000000000'), '2,000');
  assert.equal(formatAztecAmount('1234567890123456789'), '1.234567890123456789');
  assert.equal(formatEpochRange(['1020']), 'epoch 1020');
  assert.equal(formatEpochRange(['1020', '1021', '1022']), 'epochs 1020–1022');
});

test('notification copy is derived from current event facts', () => {
  const event = {
    type: 'onchain_ready',
    network: 'mainnet',
    targets: [VALIDATOR],
    data: {
      round: '257',
      targetEpochs: ['1016', '1017'],
      actions: [
        { validator: VALIDATOR, amount: '1000000000000000000000' },
        { validator: VALIDATOR, amount: '2000000000000000000000' },
      ],
      expirySlot: '37376',
      expiryAt: '2026-08-01T00:00:00.000Z',
    },
  };

  assert.deepEqual(notificationContent(event), {
    title: 'Slash proposal ready to execute',
    body: 'Round 257 · epochs 1016–1017 can now be executed. Proposed slash: 3,000 AZTEC. ' +
      'Expires at slot 37376 (2026-08-01T00:00:00.000Z).',
  });
  assert.match(formatNotificationBody(event), /^Validator: 0x1111…1111\n/);
  assert.match(
    formatNotificationBody({ ...event, targets: [VALIDATOR, VALIDATOR_2] }),
    /^Watched validators \(2\): 0x1111…1111, 0x2222…2222\n/,
  );
});

test('node offenses label configured penalties without implying an L1 proposal', () => {
  assert.deepEqual(notificationContent({
    type: 'node_offense_detected',
    data: {
      offenseTypeName: 'inactivity',
      timeUnit: 'epoch',
      epochOrSlot: '42',
      configuredPenalty: '2000000000000000000000',
    },
  }), {
    title: 'Node reported a slash offense',
    body: 'inactivity at epoch 42. Node-configured penalty: 2,000 AZTEC. ' +
      'This is node evidence; no L1 proposal exists yet.',
  });
  assert.match(notificationContent({
    type: 'node_offense_detected',
    data: {
      offenseTypeName: 'unknown_255',
      timeUnit: 'unknown',
      epochOrSlot: '9',
    },
  }).body, /^unknown_255 at position 9\./);
});

test('quorum copy distinguishes open voting without treating ballot count as target support', () => {
  const content = notificationContent({
    type: 'onchain_quorum_candidate',
    targets: [VALIDATOR],
    data: {
      round: '9',
      targetEpochs: ['40'],
      votingOpen: true,
      votesCast: '99',
      quorum: 3,
      actions: [{ validator: VALIDATOR, amount: '1000000000000000000' }],
    },
  });
  assert.equal(
    content.body,
    'The current L1 tally has quorum-backed slash actions in Round 9 · epoch 40. ' +
      'Proposed slash: 1 AZTEC. Voting is open; actions may change.',
  );
  assert.doesNotMatch(content.body, /99|3 votes|of 3/);
});

test('grouped slash copy uses summed amount, log count, and useful L1 links', () => {
  const transactionHash = `0x${'34'.repeat(32)}`;
  const event = {
    type: 'l1_slash_confirmed',
    network: 'testnet',
    targets: [VALIDATOR],
    data: {
      chainId: 11_155_111,
      actualAmount: '3000000000000000000000',
      logCount: 2,
      transactionHash,
      blockNumber: '100',
    },
  };

  assert.equal(
    notificationContent(event).body,
    'A confirmed L1 transaction slashed this validator. Amount: 3,000 AZTEC. ' +
      '2 Slashed logs were grouped. L1 block 100.',
  );
  assert.deepEqual(etherscanReferenceLines(event), [
    `L1 transaction: https://sepolia.etherscan.io/tx/${transactionHash}`,
    'L1 block: https://sepolia.etherscan.io/block/100',
  ]);
});

test('unsupported internal event types fail instead of sending vague copy', () => {
  assert.throws(
    () => notificationContent({ type: 'unknown_internal_event' }),
    /Unsupported notification event type/,
  );
});

test('reorg copy links the replacement block without claiming the old tx is canonical', () => {
  const transactionHash = `0x${'56'.repeat(32)}`;
  assert.deepEqual(etherscanReferenceLines({
    type: 'l1_slash_reorged',
    network: 'mainnet',
    data: {
      chainId: 1,
      transactionHash,
      blockNumber: '100',
      replacementCheckpoint: { blockNumber: '120' },
    },
  }), [
    `Original transaction (may be unavailable): https://etherscan.io/tx/${transactionHash}`,
    'Replacement L1 block: https://etherscan.io/block/120',
  ]);
});
