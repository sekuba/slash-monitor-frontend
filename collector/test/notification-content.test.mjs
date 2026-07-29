import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dashtecReferenceLines,
  etherscanReferenceLines,
  formatNotificationBody,
} from '../src/notification-content.mjs';

const SEQUENCER = '0x1111111111111111111111111111111111111111';

test('case transition content identifies one sequencer and preserves educational copy', () => {
  const transition = {
    network: 'mainnet',
    body: 'Candidate slash. Target epoch 24. L1 does not encode an offense reason.',
    targets: [SEQUENCER],
    data: { sequencer: SEQUENCER },
  };
  assert.equal(
    formatNotificationBody(transition),
    'Sequencer: 0x1111…1111\n' + transition.body,
  );
  assert.deepEqual(dashtecReferenceLines(transition), [
    `Dashtec: https://dashtec.xyz/sequencers/${SEQUENCER}`,
  ]);
});

test('case transition references use only its exact L1 facts', () => {
  const transactionHash = `0x${'12'.repeat(32)}`;
  const payloadAddress = '0x2222222222222222222222222222222222222222';
  assert.deepEqual(etherscanReferenceLines({
    network: 'testnet',
    data: {
      transactionHash,
      blockNumber: '42',
      payloadAddress,
    },
  }), [
    `Etherscan transaction: https://sepolia.etherscan.io/tx/${transactionHash}`,
    'Etherscan block: https://sepolia.etherscan.io/block/42',
    `Etherscan candidate payload: https://sepolia.etherscan.io/address/${payloadAddress}`,
  ]);
});
