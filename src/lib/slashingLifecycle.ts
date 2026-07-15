import type { ResolvedMonitorConfig, RoundStatus, SlashAction } from '@/types/slashing';

export type SlashingLifecycleConfig = Pick<
    ResolvedMonitorConfig,
    | 'slashingRoundSize'
    | 'slashingRoundSizeInEpochs'
    | 'executionDelayInRounds'
    | 'lifetimeInRounds'
    | 'slashOffsetInRounds'
>;

export function calculateExecutableSlot(round: bigint, config: SlashingLifecycleConfig): bigint {
    return (round + 1n + BigInt(config.executionDelayInRounds)) * BigInt(config.slashingRoundSize);
}

export function calculateExpirySlot(round: bigint, config: SlashingLifecycleConfig): bigint {
    return (round + 1n + BigInt(config.lifetimeInRounds)) * BigInt(config.slashingRoundSize);
}

export function calculateRoundStatus(
    round: bigint,
    currentRound: bigint,
    currentSlot: bigint,
    isExecuted: boolean,
    hasSlashActions: boolean,
    config: SlashingLifecycleConfig
): RoundStatus {
    if (isExecuted) {
        return 'executed';
    }

    if (currentRound > round + BigInt(config.lifetimeInRounds)) {
        return 'expired';
    }

    if (!hasSlashActions) {
        return 'below-quorum';
    }

    const isPastDelay = currentRound > round + BigInt(config.executionDelayInRounds);
    const isAtExecutableSlot = currentSlot >= calculateExecutableSlot(round, config);
    if (isPastDelay && isAtExecutableSlot) {
        return currentRound === round + BigInt(config.executionDelayInRounds) + 1n
            ? 'newly-executable'
            : 'executable';
    }

    return 'quorum-reached';
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
    const slashOffset = BigInt(config.slashOffsetInRounds);
    if (votingRound < slashOffset) {
        return [];
    }

    const roundSizeInEpochs = BigInt(config.slashingRoundSizeInEpochs);
    const startEpoch = (votingRound - slashOffset) * roundSizeInEpochs;

    return Array.from(
        { length: config.slashingRoundSizeInEpochs },
        (_, offset) => startEpoch + BigInt(offset)
    );
}

export function countUniqueValidators(actions: SlashAction[]): number {
    return new Set(actions.map((action) => action.validator.toLowerCase())).size;
}
