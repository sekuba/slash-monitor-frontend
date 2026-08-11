import {
    executableSlot,
    expirySlot,
    isRoundProtectedByPause as sharedIsRoundProtectedByPause,
    roundStatus,
    targetEpochs,
    type RoundTiming,
} from '@shared/protocol/index.ts';
import type { ResolvedMonitorConfig, RoundStatus, SlashAction } from '@/types/slashing';

export type SlashingLifecycleConfig = Pick<
    ResolvedMonitorConfig,
    | 'slashingRoundSize'
    | 'slashingRoundSizeInEpochs'
    | 'executionDelayInRounds'
    | 'lifetimeInRounds'
    | 'slashOffsetInRounds'
>;

function timing(config: SlashingLifecycleConfig): RoundTiming {
    return {
        roundSizeSlots: config.slashingRoundSize,
        executionDelayRounds: config.executionDelayInRounds,
        lifetimeRounds: config.lifetimeInRounds,
    };
}

export function calculateExecutableSlot(round: bigint, config: SlashingLifecycleConfig): bigint {
    return executableSlot(round, timing(config));
}

export function calculateExpirySlot(round: bigint, config: SlashingLifecycleConfig): bigint {
    return expirySlot(round, timing(config));
}

export function calculateRoundStatus(
    round: bigint,
    currentRound: bigint,
    currentSlot: bigint,
    isExecuted: boolean,
    hasSlashActions: boolean,
    config: SlashingLifecycleConfig
): RoundStatus {
    return roundStatus({
        round,
        currentRound,
        currentSlot,
        isExecuted,
        hasActions: hasSlashActions,
    }, timing(config));
}

export function isRoundProtectedByPause(
    round: bigint,
    config: SlashingLifecycleConfig,
    isSlashingEnabled: boolean,
    pauseStartedAtSlot: bigint | null,
    pauseEndsAtSlot: bigint | null
): boolean {
    return sharedIsRoundProtectedByPause({
        round,
        isSlashingEnabled,
        pauseStartedAtSlot,
        pauseEndsAtSlot,
        slashOffsetRounds: config.slashOffsetInRounds,
    }, timing(config));
}

export function buildRoundsToCheck(currentRound: bigint, config: SlashingLifecycleConfig): bigint[] {
    const firstRound = currentRound > BigInt(config.lifetimeInRounds)
        ? currentRound - BigInt(config.lifetimeInRounds)
        : 0n;
    const rounds: bigint[] = [];

    for (let round = firstRound; round <= currentRound; round++) {
        rounds.push(round);
    }

    return rounds;
}

export function getTargetEpochs(votingRound: bigint, config: SlashingLifecycleConfig): bigint[] {
    return targetEpochs(votingRound, {
        slashOffsetRounds: config.slashOffsetInRounds,
        roundSizeEpochs: config.slashingRoundSizeInEpochs,
    });
}

export function countUniqueValidators(actions: SlashAction[]): number {
    return new Set(actions.map((action) => action.validator.toLowerCase())).size;
}
