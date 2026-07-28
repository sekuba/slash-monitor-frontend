import type { Address, Hash } from 'viem';

export type MonitorNetwork = 'mainnet' | 'testnet';
export type HealthStatus = 'healthy' | 'degraded' | 'stale' | 'unavailable';

export interface PublicConfig {
    network: MonitorNetwork;
    maxWatchlistAddresses: number;
    channels: {
        webPush: {
            available: boolean;
            publicKey: string | null;
        };
        telegram: {
            available: boolean;
            botUsername: string | null;
        };
    };
}

export interface BackendStatus {
    network: MonitorNetwork;
    status: HealthStatus;
    observedAt: string;
    sources: {
        l1: {
            status: HealthStatus;
            lastSuccessAt: string | null;
            dataAgeMs: number | null;
            blockNumber: string | null;
            blockHash: Hash | null;
        };
        node: {
            status: HealthStatus;
            lastSuccessAt: string | null;
            dataAgeMs: number | null;
        };
    };
    notifications: {
        status: HealthStatus;
        channels: {
            webPush: { status: HealthStatus };
            telegram: { status: HealthStatus };
        };
    };
}

export interface ProtocolSnapshot {
    chainId: number;
    observedAt: string;
    currentSlot: string;
    currentEpoch: string;
    currentRound: string;
    slotDurationSeconds: number;
    epochDurationSlots: number;
    quorum: number;
    roundSizeSlots: number;
    roundSizeEpochs: number;
    executionDelayRounds: number;
    lifetimeRounds: number;
    slashOffsetRounds: number;
    roundDurationSeconds: number;
    executionDelaySeconds: number;
    executionWindowSeconds: number;
    isSlashingEnabled: boolean;
    pauseDurationSeconds: number | null;
    slashingDisabledUntil: string | null;
    pauseStartedAtSlot: string | null;
    pauseEndsAtSlot: string | null;
}

export type ApiCasePhase = 'voting' | 'review' | 'ready' | 'paused' | 'closed';
export type ApiCaseOutcome =
    | 'no-consensus'
    | 'vetoed'
    | 'executed'
    | 'expired'
    | 'stack-retired';

export interface ApiCaseTarget {
    address: Address;
    proposedAmount: string;
    actionCount: number;
}

export interface ApiSlashingCase {
    id: string;
    role: 'active' | 'legacy';
    round: string;
    phase: ApiCasePhase;
    outcome: ApiCaseOutcome | null;
    votesCast: string;
    quorum: number;
    targetEpochs: string[];
    targets: ApiCaseTarget[];
    proposerAddress: Address;
    slasherAddress: Address;
    payloadAddress: Address | null;
    currentPayloadVetoed: boolean;
    executableSlot: string;
    executableAt: string;
    expirySlot: string;
    expiryAt: string;
    isExecutionPaused: boolean;
    pauseEndsAtSlot: string | null;
    pauseEndsAt: string | null;
    blockNumber: string;
    blockHash: Hash;
    firstObservedAt: string;
    observedAt: string;
}

export interface ConfirmedSlash {
    id: string;
    address: Address;
    actualAmount: string;
    logCount: number;
    logIndexes: number[];
    canonical: boolean;
    chainId: number;
    rollupAddress: Address;
    blockNumber: string;
    blockHash: Hash;
    transactionHash: Hash;
    firstObservedAt: string;
    observedAt: string;
}

export interface L1DatasetCoverage {
    observedAt: string | null;
    blockNumber: string | null;
    blockHash: Hash | null;
    complete: boolean;
}

export interface SlashDatasetCoverage {
    observedAt: string | null;
    fromBlock: string | null;
    blockNumber: string | null;
    blockHash: Hash | null;
    confirmedBlockNumber: string | null;
    complete: boolean;
}

export interface SlashOutcomes {
    confirmed: ConfirmedSlash[];
    removed: ConfirmedSlash[];
}

export interface MonitorSnapshot {
    network: MonitorNetwork;
    coverage: {
        cases: L1DatasetCoverage;
        slashes: SlashDatasetCoverage;
    };
    protocol: ProtocolSnapshot | null;
    cases: ApiSlashingCase[];
    slashes: SlashOutcomes;
}

export interface NodeOffense {
    id: string;
    address: Address;
    configuredPenalty: string;
    offenseType: number;
    offenseTypeName: string;
    epochOrSlot: string;
    timeUnit: 'epoch' | 'slot' | 'unknown';
    status: 'active' | 'resolved';
    firstObservedAt: string;
    lastObservedAt: string;
    resolvedAt: string | null;
}

export interface ValidatorSnapshot {
    address: Address;
    observedAt: string | null;
    cases: ApiSlashingCase[];
    nodeOffenses: NodeOffense[];
    slashes: SlashOutcomes;
}

export interface ChannelState {
    connected: boolean;
    enabled: boolean;
    verified: boolean;
}

export interface Watchlist {
    id: string;
    addresses: Address[];
    channels: {
        webPush: ChannelState;
        telegram: ChannelState;
    };
}

export interface CreatedWatchlist extends Watchlist {
    managementToken: string;
}

export interface TelegramLink {
    url: string;
    expiresAt: string;
}

export interface WebPushConnectionResult {
    connected: boolean;
    enabled: boolean;
    verified: boolean;
    verificationQueued: number;
}

export interface WebPushVerificationResult {
    verified: boolean;
    queued: number;
}

export interface NotificationTestResult {
    queued: number;
}
