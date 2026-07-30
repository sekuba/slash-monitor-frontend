import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dashtecReferenceLines,
  etherscanReferenceLines,
  formatNotificationBody,
} from '../src/notification-content.mjs';

const SEQUENCER = '0x1111111111111111111111111111111111111111';

test('case transition content identifies the full sequencer without repeating the heading', () => {
  const transition = {
    network: 'mainnet',
    body: 'Event: Quorum reached for a 2,000 AZTEC slash\nEpoch: 24',
    targets: [SEQUENCER],
    data: { sequencer: SEQUENCER },
  };
  assert.equal(
    formatNotificationBody(transition),
    `Sequencer: ${SEQUENCER}\n${transition.body}`,
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
    `Transaction: https://sepolia.etherscan.io/tx/${transactionHash}`,
  ]);
});
