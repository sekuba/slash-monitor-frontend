import type { SlashingMonitorConfig } from '@/types/slashing';

export interface ProtectedRoundRange {
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
 * - Become executable during the pause window
 * - But expire before the pause ends
 *
 * This creates a "shift effect" where rounds voted on before the pause
 * may still be protected, while rounds voted late in the pause can be
 * slashed after it ends.
 */
export function calculateProtectedRoundRange(
  config: SlashingMonitorConfig,
  currentSlot: bigint,
  slashingDisabledUntil: bigint,
  slashingDisableDuration: bigint
): ProtectedRoundRange {
  const now = Math.floor(Date.now() / 1000);
  const pauseEndsAt = Number(slashingDisabledUntil);
  const secondsUntilPauseEnds = Math.max(0, pauseEndsAt - now);
  const slotsUntilPauseEnds = Math.floor(secondsUntilPauseEnds / config.slotDuration);
  const slotWhenPauseEnds = currentSlot + BigInt(slotsUntilPauseEnds);

  const roundSize = BigInt(config.slashingRoundSize);
  const pauseDurationInSlots = BigInt(Math.floor(Number(slashingDisableDuration) / config.slotDuration));
  const slotWhenPauseStarted = slotWhenPauseEnds - pauseDurationInSlots;

  const executionDelay = BigInt(config.executionDelayInRounds);
  const lifetime = BigInt(config.lifetimeInRounds);

  const roundWhenPauseEnds = slotWhenPauseEnds / roundSize;
  const roundWhenPauseStarted = slotWhenPauseStarted / roundSize;

  // First protected round: becomes executable when pause starts
  const firstProtectedRound = roundWhenPauseStarted - executionDelay;

  // Last protected round: expires before pause ends
  const lastProtectedRound = roundWhenPauseEnds - lifetime - 1n;

  // Convert to target epochs for display purposes
  const slashOffset = BigInt(config.slashOffsetInRounds);
  const roundSizeInEpochs = BigInt(config.slashingRoundSizeInEpochs);
  const firstProtectedEpoch = (firstProtectedRound - slashOffset) * roundSizeInEpochs;
  const lastProtectedEpoch = (lastProtectedRound - slashOffset + 1n) * roundSizeInEpochs - 1n;

  return {
    firstProtectedRound,
    lastProtectedRound,
    slotWhenPauseEnds,
    slotWhenPauseStarted,
    roundWhenPauseEnds,
    roundWhenPauseStarted,
    firstProtectedEpoch,
    lastProtectedEpoch,
  };
}

/**
 * Determines if a specific round is protected by the global pause.
 * A round is protected if it expires before the pause ends AND
 * is within the protected round range.
 */
export function isRoundProtectedByPause(
  round: bigint,
  config: SlashingMonitorConfig,
  currentSlot: bigint,
  isSlashingEnabled: boolean,
  slashingDisabledUntil: bigint | null,
  slashingDisableDuration: bigint | null
): boolean {
  // No protection if slashing is enabled or pause parameters are missing
  if (isSlashingEnabled || !slashingDisabledUntil || !slashingDisableDuration || !currentSlot) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const pauseEndsAt = Number(slashingDisabledUntil);
  const secondsUntilPauseEnds = Math.max(0, pauseEndsAt - now);
  const slotsUntilPauseEnds = Math.floor(secondsUntilPauseEnds / config.slotDuration);
  const slotWhenPauseEnds = currentSlot + BigInt(slotsUntilPauseEnds);

  // Check if this round expires before the pause ends
  const roundSize = BigInt(config.slashingRoundSize);
  const lifetime = BigInt(config.lifetimeInRounds);
  const roundExpiresAtSlot = (round + 1n + lifetime) * roundSize;

  if (roundExpiresAtSlot > slotWhenPauseEnds) {
    return false; // Round expires after pause, so NOT protected
  }

  // Calculate the protected round range
  const { firstProtectedRound, lastProtectedRound } = calculateProtectedRoundRange(
    config,
    currentSlot,
    slashingDisabledUntil,
    slashingDisableDuration
  );

  return round >= firstProtectedRound && round <= lastProtectedRound;
}
