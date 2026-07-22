import type { Address } from 'viem';

export interface MonitorConfigInput {
    l1RpcUrl: string | string[];
    chainId: number;
    registryAddress: Address;
}

export interface DeploymentAddresses {
    deploymentBlockNumber: bigint;
    deploymentTimestamp: bigint;
    rollupAddress: Address;
    slasherAddress: Address;
    slashingProposerAddress: Address;
    rollupVersion: bigint;
    pendingSlasherAddress: Address;
    pendingSlashingProposerAddress: Address;
    pendingSlasherReadyAt: bigint;
    legacySlasherAddress: Address;
    legacySlashingProposerAddress: Address;
    legacySlasherAuthorizedUntil: bigint;
}

export type RuntimeMonitorConfig = MonitorConfigInput & DeploymentAddresses;

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

export type ResolvedMonitorConfig = RuntimeMonitorConfig & SlashingContractParameters;

export interface CurrentChainState {
    l1BlockNumber: bigint;
    l1Timestamp: bigint;
    currentRound: bigint;
    currentSlot: bigint;
    currentEpoch: bigint;
    isSlashingEnabled: boolean;
    slashingDisabledUntil: bigint;
    slashingDisableDuration: bigint;
    pauseStartedAtSlot: bigint | null;
    pauseEndsAtSlot: bigint | null;
}

export interface SlashAction {
    validator: Address;
    slashAmount: bigint;
}

export interface TargetedSequencer {
    address: Address;
    appearances: number;
    rounds: bigint[];
}

export interface RoundInfo {
    round: bigint;
    ballotCount: bigint;
    isExecuted: boolean;
}
export type RoundStatus = 'below-quorum' | 'quorum-reached' | 'newly-executable' | 'executable' | 'executed' | 'expired';
export type VerificationStatus = 'verified' | 'partial';
export interface DetectedSlashing {
    round: bigint; // The voting round (payload/committees indexed by this number on-chain)
    status: RoundStatus;
    ballotCount: bigint;
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
    source: 'l1-rpc' | 'deployment';
    scope: 'deployment' | 'chain-state' | 'rounds' | 'round-details';
    severity?: 'warning' | 'error';
    message: string;
    round?: bigint;
}

export interface MonitorAudit {
    status: 'ok' | 'partial' | 'stale' | 'fatal';
    issues: MonitorIssue[];
    updatedAt: number | null;
    lastSuccessfulAt: number | null;
}

export interface MonitorSnapshot extends CurrentChainState {
    detectedSlashings: Map<bigint, DetectedSlashing>;
    stats: SlashingStats;
    audit: MonitorAudit;
}
