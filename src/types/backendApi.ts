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
    l1: EventL1Context | null;
    occurredAt: string;
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
    amount: string | null;
    actions: EventL1Action[];
}

export interface EventL1Action {
    sequencer: Address;
    amount: string;
}

export interface EventPage {
    data: MonitorEvent[];
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
