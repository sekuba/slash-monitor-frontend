import { createECDH } from 'node:crypto';

export const SEQUENCER_A = '0x1111111111111111111111111111111111111111';
export const SEQUENCER_B = '0x2222222222222222222222222222222222222222';

export const OFFENSE_A = {
  validator: SEQUENCER_A,
  amount: '2000000000000000000000',
  offenseType: 3,
  epochOrSlot: '42',
};

export const OFFENSE_B = {
  validator: SEQUENCER_B,
  amount: '5000000000000000000000',
  offenseType: 8,
  epochOrSlot: '9001',
};

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const pushKeyFixture = createECDH('prime256v1');
pushKeyFixture.setPrivateKey(Buffer.alloc(32, 2));
export const PUSH_KEYS = {
  p256dh: pushKeyFixture.getPublicKey().toString('base64url'),
  auth: Buffer.alloc(16, 3).toString('base64url'),
};
