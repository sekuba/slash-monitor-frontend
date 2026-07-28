import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dashtecReferenceLines,
  etherscanReferenceLines,
  formatAztecAmount,
  formatEpochRange,
  formatNotificationBody,
} from '../src/notification-content.mjs';

const SEQUENCER_A = '0x1111111111111111111111111111111111111111';
const SEQUENCER_B = '0x2222222222222222222222222222222222222222';

test('AZTEC amounts are converted from 18-decimal onchain values without losing precision', () => {
  assert.equal(formatAztecAmount('2000000000000000000000'), '2,000');
  assert.equal(formatAztecAmount('5000000000000000000000'), '5,000');
  assert.equal(formatAztecAmount('1234567890123456789'), '1.234567890123456789');
  assert.equal(formatAztecAmount('0'), '0');
});

test('epoch ranges distinguish consecutive and nonconsecutive target epochs', () => {
  assert.equal(formatEpochRange(['1020']), 'epoch 1020');
  assert.equal(formatEpochRange(['1020', '1021', '1022']), 'epochs 1020–1022');
  assert.equal(formatEpochRange(['1020', '1022']), 'epochs 1020, 1022');
});

test('notification bodies and references identify watched sequencers and useful explorers', () => {
  const event = {
    type: 'onchain_targeted',
    network: 'mainnet',
    body: 'A slash payload was proposed in active round 257 for target epochs 1016–1019.',
    targets: [SEQUENCER_A, SEQUENCER_B],
    data: {
      chainId: 1,
      blockNumber: '25587802',
      blockHash: `0x${'12'.repeat(32)}`,
      payloadAddress: '0x3333333333333333333333333333333333333333',
    },
  };

  assert.equal(
    formatNotificationBody(event),
    'Watched sequencers (2): 0x1111…1111, 0x2222…2222\n' +
      'A slash payload was proposed in active round 257 for target epochs 1016–1019.',
  );
  assert.deepEqual(dashtecReferenceLines(event), [
    `Dashtec 0x1111…1111: https://dashtec.xyz/sequencers/${SEQUENCER_A}`,
    `Dashtec 0x2222…2222: https://dashtec.xyz/sequencers/${SEQUENCER_B}`,
  ]);
  assert.deepEqual(etherscanReferenceLines(event), [
    'Etherscan block: https://etherscan.io/block/25587802',
    'Etherscan slash payload: https://etherscan.io/address/0x3333333333333333333333333333333333333333',
  ]);
});

test('reorg notifications label the original transaction and link the replacement block', () => {
  const transactionHash = `0x${'34'.repeat(32)}`;
  assert.deepEqual(etherscanReferenceLines({
    type: 'l1_slash_reorged',
    network: 'testnet',
    data: {
      chainId: 11_155_111,
      transactionHash,
      blockNumber: '100',
      replacementCheckpoint: { blockNumber: '120' },
    },
  }), [
    `Etherscan original tx (may be unavailable): https://sepolia.etherscan.io/tx/${transactionHash}`,
    'Etherscan replacement block: https://sepolia.etherscan.io/block/120',
  ]);
});

test('testnet Dashtec links and exact prior-veto evidence use the matching explorers', () => {
  const currentPayload = '0x3333333333333333333333333333333333333333';
  const previousPayload = '0x4444444444444444444444444444444444444444';
  const event = {
    type: 'onchain_payload_changed',
    network: 'testnet',
    targets: [SEQUENCER_A],
    data: {
      chainId: 11_155_111,
      payloadAddress: currentPayload,
      previousPayloadAddress: previousPayload,
      previousPayloadWasVetoed: true,
      slasherAddress: '0x5555555555555555555555555555555555555555',
    },
  };
  assert.deepEqual(dashtecReferenceLines(event), [
    `Dashtec: https://testnet.dashtec.xyz/sequencers/${SEQUENCER_A}`,
  ]);
  assert.deepEqual(etherscanReferenceLines(event), [
    `Etherscan slash payload: https://sepolia.etherscan.io/address/${currentPayload}`,
    `Etherscan previous vetoed payload: https://sepolia.etherscan.io/address/${previousPayload}`,
    'Etherscan Slasher contract: ' +
      'https://sepolia.etherscan.io/address/0x5555555555555555555555555555555555555555',
  ]);
});
