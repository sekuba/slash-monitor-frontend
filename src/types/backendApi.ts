import type {
    Network,
    NetworkSummary,
    ProtocolSnapshot,
    SlashingCase,
    SourceStatus,
} from '../../shared/protocol/types.ts';

export type MonitorNetwork = Network;

export interface BackendConfig {
    apiVersion: 3;
    network: MonitorNetwork;
    maxSequencers: number;
    notifications: {
        webPush: { enabled: boolean; publicKey: string | null };
        telegram: { enabled: boolean; username: string | null };
    };
}

export interface BackendStatus {
    status: 'healthy' | 'degraded' | 'starting';
    network: MonitorNetwork;
    observedAt: string;
    protocol: ProtocolSnapshot | null;
    sources: SourceStatus[];
}

export interface NetworkCases {
    protocol: ProtocolSnapshot | null;
    summary: NetworkSummary;
    cases: SlashingCase[];
    sources: SourceStatus[];
}

export interface NotificationEndpoint {
    id: string;
    kind: 'web_push' | 'telegram';
    enabled: boolean;
    verified: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface ManagedWatch {
    id: string;
    network: MonitorNetwork;
    addresses: string[];
    endpoints: NotificationEndpoint[];
    cases: SlashingCase[];
    createdAt: string;
    updatedAt: string;
}

export interface CreatedWatch {
    watch: ManagedWatch;
    managementToken: string;
}

export interface SequencerCases {
    sequencer: string;
    protocol: ProtocolSnapshot | null;
    cases: SlashingCase[];
}

export interface TelegramLink {
    url: string;
    expiresAt: string;
}

export type {
    NetworkSummary,
    ProtocolSnapshot,
    SlashingCase,
    SourceStatus,
};
