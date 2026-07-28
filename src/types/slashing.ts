import type { Address, Hash } from 'viem';

export interface MonitorConfigInput {
    l1RpcUrl: string | string[];
    chainId: number;
    registryAddress: Address;
}

export interface DeploymentAddresses {
    deploymentBlockNumber: bigint;
    deploymentBlockHash: Hash;
    deploymentTimestamp: bigint;
    rollupAddress: Address;
    slasherAddress: Address;
    slashingProposerAddress: Address;
    rollupVersion: bigint;
    legacySlasherAddress: Address;
    legacySlashingProposerAddress: Address;
    legacySlasherAuthorizedUntil: bigint;
}

export type RuntimeMonitorConfig = MonitorConfigInput & DeploymentAddresses;

export interface SlashingContractParameters {
    l1GenesisTime: bigint;
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

export interface RoundInfo {
    round: bigint;
    ballotCount: bigint;
    isExecuted: boolean;
}
export interface DetectedL1Round {
    round: bigint;
    ballotCount: bigint;
    isExecuted: boolean;
    isVetoed: boolean;
    slashActions: SlashAction[];
    payloadAddress?: Address;
    slotWhenExecutable: bigint;
    slotWhenExpires: bigint;
    targetEpochs: bigint[];
}
export interface MonitorIssue {
    source: 'l1-rpc' | 'deployment';
    scope: 'deployment' | 'chain-state' | 'rounds' | 'round-details';
    severity?: 'warning' | 'error';
    message: string;
    round?: bigint;
}
