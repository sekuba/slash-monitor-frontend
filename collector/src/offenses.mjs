import { createHash } from 'node:crypto';

const OFFENSE_METADATA = new Map([
  [0, ['unknown', 'epoch']],
  [1, ['data_withholding', 'slot']],
  [3, ['inactivity', 'epoch']],
  [4, ['broadcasted_invalid_block_proposal', 'slot']],
  [5, ['proposed_insufficient_attestations', 'slot']],
  [6, ['proposed_incorrect_attestations', 'slot']],
  [7, ['proposed_descendant_of_checkpoint_with_invalid_attestations', 'slot']],
  [8, ['duplicate_proposal', 'slot']],
  [9, ['duplicate_attestation', 'slot']],
  [10, ['attested_to_invalid_checkpoint_proposal', 'slot']],
  [11, ['broadcasted_invalid_checkpoint_proposal', 'slot']],
]);

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function parseOffenseSnapshot(value, maxOffenses = 100_000) {
  if (!Array.isArray(value)) {
    throw new Error('Aztec admin result must be an array');
  }
  if (value.length > maxOffenses) {
    throw new Error(`Aztec admin returned ${value.length} offenses, exceeding the configured maximum of ${maxOffenses}`);
  }

  const offenses = new Map();
  value.forEach((entry, index) => {
    const offense = parseOffense(entry, index);
    offenses.set(offense.id, offense);
  });
  return [...offenses.values()];
}

export function parseOffense(value, index = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Offense at index ${index} must be an object`);
  }

  // Aztec's admin wire schema still calls this field `validator`.
  const validator = parseAddress(value.validator, index);
  const penalty = parseUnsignedBigInt(value.amount, `amount at index ${index}`);
  const epochOrSlot = parseUnsignedBigInt(value.epochOrSlot, `epochOrSlot at index ${index}`);
  const offenseType = Number(value.offenseType);
  if (!Number.isSafeInteger(offenseType) || offenseType < 0 || offenseType > 255) {
    throw new Error(`offenseType at index ${index} must be an integer between 0 and 255`);
  }

  const [offenseTypeName, timeUnit] = OFFENSE_METADATA.get(offenseType) ?? [`unknown_${offenseType}`, 'unknown'];
  const id = offenseId({ validator, offenseType, epochOrSlot });

  return {
    id,
    validator,
    penalty: penalty.toString(),
    offenseType,
    offenseTypeName,
    epochOrSlot: epochOrSlot.toString(),
    timeUnit,
  };
}

export function offenseId({ validator, offenseType, epochOrSlot }) {
  return createHash('sha256')
    .update(`${validator.toLowerCase()}|${offenseType}|${epochOrSlot.toString()}`)
    .digest('hex');
}

function parseAddress(value, index) {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    throw new Error(`validator at index ${index} must be a 20-byte hex address`);
  }
  return value.toLowerCase();
}

function parseUnsignedBigInt(value, label) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must not be an unsafe JSON number`);
  }
  if (!['string', 'number', 'bigint'].includes(typeof value)) {
    throw new Error(`${label} must be an integer string or number`);
  }

  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer string or number`);
  }
  if (parsed < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
  return parsed;
}
