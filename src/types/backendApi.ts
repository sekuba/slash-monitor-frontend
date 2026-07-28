import type { Address } from 'viem';

export type MonitorNetwork = 'mainnet' | 'testnet';
export type BackendHealthStatus = 'healthy' | 'degraded' | 'stale' | 'unavailable';

export interface SourceHealth {
    status: BackendHealthStatus;
}

export interface BackendConfig {
    network: MonitorNetwork;
    webPush: {
        enabled: boolean;
        publicKey: string | null;
    };
    telegram: {
        enabled: boolean;
        botUsername: string | null;
    };
    limits: {
        maxSequencers: number;
    };
}

export interface BackendStatus {
    status: BackendHealthStatus;
    generatedAt: string;
    sources: {
        l1: SourceHealth;
        aztec: SourceHealth;
    };
    delivery: {
        status: BackendHealthStatus;
    };
}

export interface MonitorEvent {
    id: string;
    network: MonitorNetwork;
    type: string;
    source: string;
    certainty: 'pending' | 'confirmed';
    sequencer: Address | null;
    targets: Address[];
    title: string;
    body: string;
    offense: EventOffense | null;
    nodeEvidence: NodeEvidence[];
    l1: EventL1Context | null;
    occurredAt: string;
}

export interface NodeEvidence {
    kind: 'slash_offense' | 'inactivity_epoch';
    sequencer: Address;
    epoch: string;
    offenseId: string | null;
    offenseType: number | null;
    offenseTypeName: string;
    epochOrSlot: string;
    timeUnit: 'epoch' | 'slot';
    amount: string | null;
    firstSeenAt: string;
    missed: number | null;
    total: number | null;
    firstMissedSlot: string | null;
    lastMissedSlot: string | null;
    inactiveStreak: number | null;
    slashableThreshold: number | null;
    targetPercentage: number | null;
}

export interface EventOffense {
    type: number | null;
    reason: string;
    epochOrSlot: string | null;
    timeUnit: string | null;
    amount: string | null;
    epoch: string | null;
    slot: string | null;
    offenseRound: string | null;
    proposalRound: string | null;
}

export interface EventL1Context {
    chainId: number;
    role: string | null;
    round: string | null;
    status: string | null;
    targetEpochs: string[];
    currentSlot: string | null;
    currentEpoch: string | null;
    executableSlot: string | null;
    executableAt: string | null;
    expirySlot: string | null;
    expiryAt: string | null;
    blockNumber: string | null;
    blockHash: string | null;
    transactionHash: string | null;
    payloadAddress: Address | null;
    slasherAddress?: Address | null;
    previousPayloadAddress?: Address | null;
    previousPayloadWasVetoed?: boolean | null;
    amount: string | null;
    isVetoed: boolean | null;
    isExecuted: boolean | null;
    isSlashingEnabled: boolean | null;
    isExecutionPaused: boolean | null;
    isProtected: boolean | null;
    pauseStartedAtSlot: string | null;
    pauseEndsAtSlot: string | null;
    actions: EventL1Action[];
    actionChanges?: EventL1ActionChange[];
}

export interface EventL1Action {
    sequencer: Address;
    amount: string;
}

export interface EventL1ActionChange {
    sequencer: Address;
    kind: 'added' | 'removed' | 'amount_changed';
    previousAmount: string | null;
    currentAmount: string | null;
}

export interface EventPage {
    data: MonitorEvent[];
    nextCursor: string | null;
}

export interface SlashingProtocolSnapshot {
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
    inactivity: {
        targetPercentage: number;
        consecutiveEpochs: number;
    } | null;
}

export interface SequencerRecordPage {
    sequencer: Address;
    protocol: SlashingProtocolSnapshot | null;
    events: MonitorEvent[];
    nextCursor: string | null;
}

export interface NotificationChannelState {
    connected: boolean;
    enabled: boolean;
    verified: boolean;
}

export interface ManagedSubscription {
    id: string;
    network: MonitorNetwork;
    sequencers: Address[];
    channels: {
        webPush: NotificationChannelState;
        telegram: NotificationChannelState;
    };
}

export interface CreatedSubscription {
    subscription: ManagedSubscription;
    managementToken: string;
}

export interface TelegramLink {
    url: string;
    expiresAt: string | null;
}
