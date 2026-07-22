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
