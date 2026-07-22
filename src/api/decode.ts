import type { Address } from 'viem';
import type {
    BackendHealthStatus,
    CreatedSubscription,
    EventPage,
    ManagedSubscription,
    MonitorEvent,
    MonitorNetwork,
    NotificationChannelState,
    SourceHealth,
    TelegramLink,
    BackendConfig,
    BackendStatus,
} from '@/types/backendApi';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HEALTH_STATUSES = new Set<BackendHealthStatus>(['healthy', 'degraded', 'stale', 'unavailable']);

export class ApiContractError extends Error {
    constructor(message: string) {
        super(`Slashmon API contract error: ${message}`);
        this.name = 'ApiContractError';
    }
}

export function decodePublicConfig(input: unknown): BackendConfig {
    const root = expectApiEnvelope(input, 'config');
    const publicKey = optionalString(root.vapidPublicKey);
    const telegramBotUsername = optionalString(root.telegramBotUsername);

    return {
        network: networkValue(root.network, 'config.network'),
        webPush: {
            enabled: Boolean(publicKey),
            publicKey: publicKey ?? null,
        },
        telegram: {
            enabled: Boolean(telegramBotUsername),
            botUsername: telegramBotUsername ?? null,
        },
        limits: {
            maxSequencers: boundedInteger(
                root.maxSequencers,
                'config.limits.maxSequencers',
                1,
                1_000,
            ),
        },
    };
}

export function decodeStatus(input: unknown, expectedNetwork: MonitorNetwork): BackendStatus {
    const root = expectApiEnvelope(input, 'status');
    const responseNetwork = networkValue(root.network, 'status.network');
    if (responseNetwork !== expectedNetwork) {
        throw new ApiContractError(`status network is ${responseNetwork}, expected ${expectedNetwork}`);
    }
    const sources = expectObject(root.sources, 'status.sources');
    const delivery = expectObject(root.delivery, 'status.delivery');

    return {
        status: healthStatus(root.status, 'status.status'),
        generatedAt: isoString(root.generatedAt, 'status.generatedAt'),
        sources: {
            l1: decodeSourceHealth(sources.l1, 'status.sources.l1'),
            aztec: decodeSourceHealth(sources.aztec, 'status.sources.aztec'),
        },
        delivery: {
            status: healthStatus(delivery.status, 'status.delivery.status'),
        },
    };
}

export function decodeEventPage(input: unknown, expectedNetwork: MonitorNetwork): EventPage {
    const root = expectApiEnvelope(input, 'events');
    const dataValue = root.data;
    const data = expectArray(dataValue, 'events.data').map((event, index) => decodeEvent(
        event,
        expectedNetwork,
        `events.data[${index}]`,
    ));
    const pagination = expectObject(root.pagination, 'events.pagination');

    return {
        data,
        nextCursor: optionalString(pagination.nextCursor) ?? null,
    };
}

export function decodeEventDetail(input: unknown, expectedNetwork: MonitorNetwork): MonitorEvent {
    const envelope = expectApiEnvelope(input, 'event');
    return decodeEvent(expectObject(envelope.data, 'event.data'), expectedNetwork, 'event.data');
}

export function decodeSubscription(input: unknown): ManagedSubscription {
    const envelope = expectApiEnvelope(input, 'subscription');
    return decodeSubscriptionObject(expectObject(envelope.data, 'subscription.data'), 'subscription.data');
}

export function decodeCreatedSubscription(input: unknown): CreatedSubscription {
    const envelope = expectApiEnvelope(input, 'created subscription');
    const root = expectObject(envelope.data, 'created subscription.data');
    const managementToken = optionalString(root.managementToken);
    if (!managementToken) {
        throw new ApiContractError('created subscription is missing managementToken');
    }

    return {
        subscription: decodeSubscriptionObject(root, 'created subscription.data'),
        managementToken,
    };
}

export function decodeTelegramLink(input: unknown): TelegramLink {
    const root = expectApiEnvelope(input, 'Telegram link');
    const url = expectString(root.url, 'Telegram link.url');
    let parsed: URL;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new ApiContractError('Telegram link.url must be an absolute URL');
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 't.me') {
        throw new ApiContractError('Telegram link.url must use https://t.me');
    }

    return {
        url: parsed.href,
        expiresAt: nullableIsoString(root.expiresAt, 'Telegram link.expiresAt'),
    };
}

function decodeSourceHealth(input: unknown, path: string): SourceHealth {
    const value = expectObject(input, path);
    const status = healthStatus(value.status, `${path}.status`);
    return { status };
}

function decodeEvent(input: unknown, expectedNetwork: MonitorNetwork, path: string): MonitorEvent {
    const value = expectObject(input, path);
    const source = expectString(value.source, `${path}.source`);
    const data = expectObject(value.data, `${path}.data`);
    const certaintyValue = expectString(value.certainty, `${path}.certainty`);
    if (certaintyValue !== 'pending' && certaintyValue !== 'confirmed') {
        throw new ApiContractError(`${path}.certainty must be pending or confirmed`);
    }
    const network = networkValue(value.network, `${path}.network`);
    if (network !== expectedNetwork) {
        throw new ApiContractError(`${path}.network is ${network}, expected ${expectedNetwork}`);
    }
    const targets = expectArray(value.targets, `${path}.targets`).map((target, index) =>
        address(target, `${path}.targets[${index}]`));
    const sequencer = value.sequencer === null
        ? null
        : address(value.sequencer, `${path}.sequencer`);
    if (sequencer !== (targets[0] ?? null)) {
        throw new ApiContractError(`${path}.sequencer must match the first target`);
    }

    return {
        id: expectString(value.id, `${path}.id`),
        network,
        type: expectString(value.type, `${path}.type`),
        source,
        certainty: certaintyValue,
        sequencer,
        targets,
        title: expectString(value.title, `${path}.title`),
        body: expectText(value.body, `${path}.body`),
        offense: decodeEventOffense(data, `${path}.data`),
        occurredAt: isoString(value.occurredAt, `${path}.occurredAt`),
    };
}

function decodeEventOffense(data: Record<string, unknown> | null, path: string): MonitorEvent['offense'] {
    const reason = optionalString(data?.offenseTypeName);
    if (!reason) {
        return null;
    }

    return {
        type: nullableInteger(data?.offenseType, `${path}.offenseType`),
        reason,
        epochOrSlot: optionalDecimalString(data?.epochOrSlot, `${path}.epochOrSlot`),
        timeUnit: optionalString(data?.timeUnit) ?? null,
        amount: optionalDecimalString(data?.amount, `${path}.amount`),
    };
}

function decodeSubscriptionObject(value: Record<string, unknown>, path: string): ManagedSubscription {
    const network = networkValue(value.network, `${path}.network`);
    const sequencers = expectArray(value.addresses, `${path}.addresses`).map((item, index) =>
        address(item, `${path}.addresses[${index}]`));
    const channels = expectObject(value.channels, `${path}.channels`);

    return {
        id: expectString(value.id, `${path}.id`),
        network,
        sequencers,
        channels: {
            webPush: decodeChannel(channels.webPush, `${path}.channels.webPush`),
            telegram: decodeChannel(channels.telegram, `${path}.channels.telegram`),
        },
    };
}

function decodeChannel(input: unknown, path: string): NotificationChannelState {
    const value = expectObject(input, path);
    return {
        connected: expectBoolean(value.connected, `${path}.connected`),
        enabled: expectBoolean(value.enabled, `${path}.enabled`),
        verified: expectBoolean(value.verified, `${path}.verified`),
    };
}

function expectApiEnvelope(input: unknown, path: string): Record<string, unknown> {
    const envelope = expectObject(input, `${path} response`);
    if (envelope.schemaVersion !== 2) {
        throw new ApiContractError(`${path}.schemaVersion must be 2`);
    }
    return envelope;
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
    const object = optionalObject(value);
    if (!object) {
        throw new ApiContractError(`${path} must be an object`);
    }
    return object;
}

function optionalObject(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function expectArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new ApiContractError(`${path} must be an array`);
    }
    return value;
}

function expectString(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ApiContractError(`${path} must be a non-empty string`);
    }
    return value;
}

function expectText(value: unknown, path: string): string {
    if (typeof value !== 'string') {
        throw new ApiContractError(`${path} must be a string`);
    }
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

function expectBoolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
        throw new ApiContractError(`${path} must be a boolean`);
    }
    return value;
}

function address(value: unknown, path: string): Address {
    const result = expectString(value, path);
    if (!ADDRESS_PATTERN.test(result)) {
        throw new ApiContractError(`${path} must be a 20-byte Ethereum address`);
    }
    return result as Address;
}

function optionalNetwork(value: unknown): MonitorNetwork | null {
    return value === 'mainnet' || value === 'testnet' ? value : null;
}

function networkValue(value: unknown, path: string): MonitorNetwork {
    const result = optionalNetwork(value);
    if (!result) {
        throw new ApiContractError(`${path} must be mainnet or testnet`);
    }
    return result;
}

function healthStatus(value: unknown, path: string): BackendHealthStatus {
    if (typeof value !== 'string' || !HEALTH_STATUSES.has(value as BackendHealthStatus)) {
        throw new ApiContractError(`${path} must be healthy, degraded, stale, or unavailable`);
    }
    return value as BackendHealthStatus;
}

function isoString(value: unknown, path: string): string {
    const result = expectString(value, path);
    if (Number.isNaN(Date.parse(result))) {
        throw new ApiContractError(`${path} must be an ISO date`);
    }
    return result;
}

function nullableIsoString(value: unknown, path: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    return isoString(value, path);
}

function optionalDecimalString(value: unknown, path: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new ApiContractError(`${path} must be an unsigned decimal string`);
    }
    return value;
}

function nullableInteger(value: unknown, path: string): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (!Number.isSafeInteger(value)) {
        throw new ApiContractError(`${path} must be an integer or null`);
    }
    return value as number;
}

function boundedInteger(
    value: unknown,
    path: string,
    minimum: number,
    maximum: number,
): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new ApiContractError(`${path} must be an integer between ${minimum} and ${maximum}`);
    }
    return value as number;
}
