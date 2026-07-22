import type { Address } from 'viem';

export type MonitorNetwork = 'mainnet' | 'testnet';
export type BackendHealthStatus = 'healthy' | 'degraded' | 'stale' | 'unavailable';

export interface SourceHealth {
    status: BackendHealthStatus;
    dataFresh: boolean;
    dataAgeMs: number | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
}

export interface V2PublicConfig {
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

export interface PendingOffense {
    id: string;
    network: MonitorNetwork;
    sequencer: Address;
    amount: string | null;
    offenseType: number | null;
    offenseTypeName: string;
    epochOrSlot: string | null;
    timeUnit: string | null;
    status: 'active' | 'withdrawn';
    firstSeenAt: string;
    lastSeenAt: string;
    withdrawnAt: string | null;
    observationCount: number | null;
}

export interface V2Status {
    status: BackendHealthStatus;
    generatedAt: string;
    sources: {
        l1: SourceHealth;
        aztec: SourceHealth;
    };
    delivery: {
        status: BackendHealthStatus;
        overdueDeliveries: number;
        expiredLeases: number;
        recentTerminalFailures: number;
    };
    pendingOffenses: PendingOffense[];
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
    occurredAt: string;
}

export interface EventOffense {
    type: number | null;
    reason: string;
    epochOrSlot: string | null;
    timeUnit: string | null;
    amount: string | null;
}

export interface EventPage {
    data: MonitorEvent[];
    nextCursor: string | null;
}

export interface NotificationChannelState {
    connected: boolean;
    enabled: boolean;
    verified: boolean;
    label: string | null;
}

export interface ManagedSubscription {
    id: string;
    network: MonitorNetwork;
    sequencers: Address[];
    channels: {
        webPush: NotificationChannelState;
        telegram: NotificationChannelState;
    };
    createdAt: string | null;
    updatedAt: string | null;
}

export interface CreatedSubscription {
    subscription: ManagedSubscription;
    managementToken: string;
}

export interface TelegramLink {
    url: string;
    expiresAt: string | null;
}
