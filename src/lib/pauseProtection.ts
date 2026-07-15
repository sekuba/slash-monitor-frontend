import { calculateExpirySlot, type SlashingLifecycleConfig } from './slashingLifecycle';

export interface ProtectedRoundRange {
  hasProtectedRounds: boolean;
  firstProtectedRound: bigint;
  lastProtectedRound: bigint;
  slotWhenPauseEnds: bigint;
  slotWhenPauseStarted: bigint;
  roundWhenPauseEnds: bigint;
  roundWhenPauseStarted: bigint;
  firstProtectedEpoch: bigint;
  lastProtectedEpoch: bigint;
}

/**
 * Calculates the range of rounds protected by a global pause.
 * Protected rounds are those that:
 * - Remain live after the pause begins
 * - Expire no later than the pause ends
 *
 * This creates a "shift effect" where rounds voted on before the pause
 * may still be protected, while rounds voted late in the pause can be
 * slashed after it ends.
 */
export function calculateProtectedRoundRange(
  config: SlashingLifecycleConfig,
  pauseStartedAtSlot: bigint,
  pauseEndsAtSlot: bigint
): ProtectedRoundRange {
  const roundSize = BigInt(config.slashingRoundSize);
  const lifetime = BigInt(config.lifetimeInRounds);

  const roundWhenPauseEnds = pauseEndsAtSlot / roundSize;
  const roundWhenPauseStarted = pauseStartedAtSlot / roundSize;

  // Protected rounds are live when the pause begins and expire no later than it ends.
  const firstCandidateRound = roundWhenPauseStarted - lifetime;
  const lastProtectedRound = roundWhenPauseEnds - lifetime - 1n;
  const minimumVotingRound = BigInt(config.slashOffsetInRounds);
  const firstProtectedRound = firstCandidateRound > minimumVotingRound
    ? firstCandidateRound
    : minimumVotingRound;
  const hasProtectedRounds = firstProtectedRound <= lastProtectedRound;

  // Convert to target epochs for display purposes
  const slashOffset = BigInt(config.slashOffsetInRounds);
  const roundSizeInEpochs = BigInt(config.slashingRoundSizeInEpochs);
  const firstProtectedEpoch = hasProtectedRounds
    ? (firstProtectedRound - slashOffset) * roundSizeInEpochs
    : 0n;
  const lastProtectedEpoch = hasProtectedRounds
    ? (lastProtectedRound - slashOffset + 1n) * roundSizeInEpochs - 1n
    : 0n;

  return {
    hasProtectedRounds,
    firstProtectedRound,
    lastProtectedRound,
    slotWhenPauseEnds: pauseEndsAtSlot,
    slotWhenPauseStarted: pauseStartedAtSlot,
    roundWhenPauseEnds,
    roundWhenPauseStarted,
    firstProtectedEpoch,
    lastProtectedEpoch,
  };
}

/**
 * Determines if a specific round is protected by the global pause.
 * A round is protected if it expires no later than the pause ends AND
 * is within the protected round range.
 */
export function isRoundProtectedByPause(
  round: bigint,
  config: SlashingLifecycleConfig,
  isSlashingEnabled: boolean,
  pauseStartedAtSlot: bigint | null,
  pauseEndsAtSlot: bigint | null
): boolean {
  if (isSlashingEnabled || pauseStartedAtSlot === null || pauseEndsAtSlot === null) {
    return false;
  }

  if (round < BigInt(config.slashOffsetInRounds)) {
    return false;
  }

  const roundExpiresAtSlot = calculateExpirySlot(round, config);

  return roundExpiresAtSlot > pauseStartedAtSlot && roundExpiresAtSlot <= pauseEndsAtSlot;
}
