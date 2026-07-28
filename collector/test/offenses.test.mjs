import assert from 'node:assert/strict';
import test from 'node:test';

import { offenseId, parseOffenseSnapshot } from '../src/offenses.mjs';
import { OFFENSE_A, VALIDATOR_A } from './helpers.mjs';

test('parseOffenseSnapshot normalizes Aztec bigint and address fields', () => {
  const [offense] = parseOffenseSnapshot([{ ...OFFENSE_A, validator: VALIDATOR_A.toUpperCase().replace('0X', '0x') }]);

  assert.equal(offense.validator, VALIDATOR_A);
  assert.equal(offense.penalty, OFFENSE_A.amount);
  assert.equal(offense.offenseTypeName, 'inactivity');
  assert.equal(offense.timeUnit, 'epoch');
  assert.equal(offense.epochOrSlot, '42');
  assert.equal(offense.id.length, 64);
});

test('unknown future offense types remain collectable', () => {
  const [offense] = parseOffenseSnapshot([{ ...OFFENSE_A, offenseType: 200 }]);
  assert.equal(offense.offenseTypeName, 'unknown_200');
  assert.equal(offense.timeUnit, 'unknown');
});

test('logical offense ids do not depend on amount', () => {
  const first = offenseId({ validator: VALIDATOR_A, offenseType: OFFENSE_A.offenseType, epochOrSlot: 42n });
  const second = offenseId({ validator: VALIDATOR_A, offenseType: OFFENSE_A.offenseType, epochOrSlot: '42' });
  assert.equal(first, second);
});

test('malformed snapshots are rejected atomically', () => {
  assert.throws(() => parseOffenseSnapshot({}), /must be an array/);
  assert.throws(() => parseOffenseSnapshot([{ ...OFFENSE_A, validator: '0x1234' }]), /validator.*20-byte hex address/);
  assert.throws(() => parseOffenseSnapshot([{ ...OFFENSE_A, amount: '-1' }]), /non-negative/);
  assert.throws(() => parseOffenseSnapshot([OFFENSE_A, OFFENSE_A], 1), /exceeding the configured maximum/);
});
