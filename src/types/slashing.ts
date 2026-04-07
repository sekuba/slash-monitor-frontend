import type { Address } from 'viem';

export interface MonitorConfigInput {
    l1RpcUrl: string | string[];
    tallySlashingProposerAddress: Address;
    slasherAddress: Address;
    rollupAddress: Address;
    l2PollInterval: number;
    realtimeCountdownInterval: number;
    l1RoundCacheTTL: number;
    detailsCacheTTL: number;
    copyFeedbackDuration: number;
    hoursThresholdForDayDisplay: number;
    consoleLogProbability: number;
    lookbackRounds: number;
}

export interface SlashingContractParameters {
    slashingRoundSize: number;
    slashingRoundSizeInEpochs: number;
    executionDelayInRounds: number;
    lifetimeInRounds: number;
    slashOffsetInRounds: number;
    quorum: number;
    committeeSize: number;
    slotDuration: number;
    epochDuration: number;
}

export type ResolvedMonitorConfig = MonitorConfigInput & SlashingContractParameters;

export interface CurrentChainState {
    currentRound: bigint;
    currentSlot: bigint;
    currentEpoch: bigint;
    isSlashingEnabled: boolean;
    slashingDisabledUntil: bigint;
    slashingDisableDuration: bigint;
    activeAttesterCount: bigint;
    entryQueueLength: bigint;
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
export type RoundStatus = 'quorum-reached' | 'in-veto-window' | 'executable' | 'executed' | 'expired';
export type VerificationStatus = 'verified' | 'partial';
export interface DetectedSlashing {
    round: bigint; // The voting round (payload/committees indexed by this number on-chain)
    status: RoundStatus;
    voteCount: bigint;
    isExecuted: boolean;
    isVetoed: boolean;
    verificationStatus: VerificationStatus;
    issues?: string[];
    committees?: Address[][];
    slashActions?: SlashAction[];
    payloadAddress?: Address;
    slotWhenExecutable?: bigint;
    slotWhenExpires?: bigint;
    secondsUntilExecutable?: number;
    secondsUntilExpires?: number;
    lastUpdatedTimestamp?: number;
    targetEpochs?: bigint[]; // Epochs from the target round (for reference)
    totalSlashAmount?: bigint;
    affectedValidatorCount?: number;
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

export interface MonitorIssue {
    source: 'l1-rpc';
    scope: 'chain-state' | 'rounds' | 'round-details';
    message: string;
    round?: bigint;
}

export interface MonitorAudit {
    status: 'ok' | 'partial';
    issues: MonitorIssue[];
    updatedAt: number | null;
}

export interface MonitorSnapshot extends CurrentChainState {
    detectedSlashings: Map<bigint, DetectedSlashing>;
    stats: SlashingStats;
    audit: MonitorAudit;
}
