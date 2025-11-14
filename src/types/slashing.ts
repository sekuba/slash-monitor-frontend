import type { Address } from 'viem';
export interface SlashingMonitorConfig {
    l1RpcUrl: string | string[];
    tallySlashingProposerAddress: Address;
    slasherAddress: Address;
    rollupAddress: Address;
    nodeAdminUrl: string;
    slashingRoundSize: number;
    slashingRoundSizeInEpochs: number;
    executionDelayInRounds: number;
    lifetimeInRounds: number;
    slashOffsetInRounds: number;
    quorum: number;
    committeeSize: number;
    slotDuration: number;
    epochDuration: number;
    l2PollInterval: number;
    realtimeCountdownInterval: number;
    l1RoundCacheTTL: number;
    detailsCacheTTL: number;
    copyFeedbackDuration: number;
    hoursThresholdForDayDisplay: number;
    consoleLogProbability: number;
}
export interface SlashAction {
    validator: Address;
    slashAmount: bigint;
}
export interface RoundInfo {
    round: bigint;
    voteCount: bigint;
    isExecuted: boolean;
}
export type RoundStatus = 'voting' | 'quorum-reached' | 'in-veto-window' | 'executable' | 'executed' | 'expired';
export interface DetectedSlashing {
    round: bigint;
    status: RoundStatus;
    voteCount: bigint;
    isExecuted: boolean;
    isVetoed: boolean;
    committees?: Address[][];
    slashActions?: SlashAction[];
    payloadAddress?: Address;
    slotWhenExecutable?: bigint;
    slotWhenExpires?: bigint;
    secondsUntilExecutable?: number;
    secondsUntilExpires?: number;
    lastUpdatedTimestamp?: number;
    targetEpochs?: bigint[];
    totalSlashAmount?: bigint;
    affectedValidatorCount?: number;
}
export enum OffenseType {
    UNKNOWN = 0,
    DATA_WITHHOLDING = 1,
    VALID_EPOCH_PRUNED = 2,
    INACTIVITY = 3,
    BROADCASTED_INVALID_BLOCK_PROPOSAL = 4,
    PROPOSED_INSUFFICIENT_ATTESTATIONS = 5,
    PROPOSED_INCORRECT_ATTESTATIONS = 6,
    ATTESTED_DESCENDANT_OF_INVALID = 7
}
export interface Offense {
    validator: Address;
    offenseType: OffenseType;
    amount: bigint;
    epoch?: bigint;
    blockNumber?: bigint;
    round?: bigint;
}
export interface SlashingStats {
    currentRound: bigint;
    totalRoundsMonitored: number;
    activeSlashings: number;
    vetoedPayloads: number;
    executedRounds: number;
    totalValidatorsSlashed: number;
    totalSlashAmount: bigint;
}
