import type { Address } from 'viem';
import type {
    BackendHealthStatus,
    CreatedSubscription,
    EventPage,
    ManagedSubscription,
    MonitorEvent,
    MonitorNetwork,
    NotificationChannelState,
    PendingOffense,
    SourceHealth,
    TelegramLink,
    V2PublicConfig,
    V2Status,
} from '@/types/v2Api';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HEALTH_STATUSES = new Set<BackendHealthStatus>(['healthy', 'degraded', 'stale', 'unavailable']);

export class ApiContractError extends Error {
    constructor(message: string) {
        super(`Slashmon API contract error: ${message}`);
        this.name = 'ApiContractError';
    }
}

export function decodePublicConfig(input: unknown): V2PublicConfig {
    const envelope = expectV2Envelope(input, 'config');
    const root = optionalObject(envelope.data) ?? envelope;
    const channels = optionalObject(root.channels) ?? root;
    const webPush = optionalObject(channels.webPush) ?? {};
    const telegram = optionalObject(channels.telegram) ?? {};
    const limits = optionalObject(root.limits) ?? {};
    const publicKey = optionalString(webPush.publicKey) ?? optionalString(root.vapidPublicKey);
    const telegramBotUsername = optionalString(telegram.botUsername) ?? optionalString(root.telegramBotUsername);

    return {
        network: networkValue(root.network ?? envelope.network, 'config.network'),
        webPush: {
            enabled: optionalBoolean(webPush.enabled) ?? Boolean(publicKey),
            publicKey: publicKey ?? null,
        },
        telegram: {
            enabled: optionalBoolean(telegram.enabled) ?? Boolean(telegramBotUsername),
            botUsername: telegramBotUsername ?? null,
        },
        limits: {
            maxSequencers: boundedInteger(
                limits.maxSequencers ?? root.maxSequencers,
                'config.limits.maxSequencers',
                1,
                1_000,
                100,
            ),
        },
    };
}

export function decodeStatus(input: unknown, fallbackNetwork: MonitorNetwork): V2Status {
    const envelope = expectV2Envelope(input, 'status');
    const root = optionalObject(envelope.data) ?? envelope;
    const responseNetwork = optionalNetwork(root.network);
    if (responseNetwork && responseNetwork !== fallbackNetwork) {
        throw new ApiContractError(`status network is ${responseNetwork}, expected ${fallbackNetwork}`);
    }
    const sources = expectObject(root.sources, 'status.sources');
    const offenses = optionalArray(root.pendingOffenses) ?? [];
    const delivery = optionalObject(root.delivery);

    return {
        status: healthStatus(root.status, 'status.status'),
        generatedAt: isoString(root.generatedAt, 'status.generatedAt'),
        sources: {
            l1: decodeSourceHealth(sources.l1, 'status.sources.l1'),
            aztec: decodeSourceHealth(sources.aztec, 'status.sources.aztec'),
        },
        delivery: {
            status: delivery
                ? healthStatus(delivery.status, 'status.delivery.status')
                : 'healthy',
            overdueDeliveries: boundedInteger(
                delivery?.overdueDeliveries,
                'status.delivery.overdueDeliveries',
                0,
                Number.MAX_SAFE_INTEGER,
                0,
            ),
            expiredLeases: boundedInteger(
                delivery?.expiredLeases,
                'status.delivery.expiredLeases',
                0,
                Number.MAX_SAFE_INTEGER,
                0,
            ),
            recentTerminalFailures: boundedInteger(
                delivery?.recentTerminalFailures,
                'status.delivery.recentTerminalFailures',
                0,
                Number.MAX_SAFE_INTEGER,
                0,
            ),
        },
        pendingOffenses: offenses.map((offense, index) => decodePendingOffense(
            offense,
            fallbackNetwork,
            `status.pendingOffenses[${index}]`,
        )),
    };
}

export function decodeEventPage(input: unknown, fallbackNetwork: MonitorNetwork): EventPage {
    const root = expectV2Envelope(input, 'events');
    const dataValue = root.data;
    const data = expectArray(dataValue, 'events.data').map((event, index) => decodeEvent(
        event,
        fallbackNetwork,
        `events.data[${index}]`,
    ));
    const pagination = optionalObject(root.pagination);

    return {
        data,
        nextCursor: optionalString(pagination?.nextCursor ?? root.nextCursor) ?? null,
    };
}

export function decodeEventDetail(input: unknown, fallbackNetwork: MonitorNetwork): MonitorEvent {
    const envelope = expectV2Envelope(input, 'event');
    const root = optionalObject(envelope.data) ?? envelope;
    return decodeEvent(root, fallbackNetwork, 'event');
}

export function decodeSubscription(input: unknown): ManagedSubscription {
    const envelope = expectV2Envelope(input, 'subscription');
    const root = optionalObject(envelope.data) ?? envelope;
    return decodeSubscriptionObject(root, 'subscription');
}

export function decodeCreatedSubscription(input: unknown): CreatedSubscription {
    const envelope = expectV2Envelope(input, 'created subscription');
    const root = optionalObject(envelope.data) ?? envelope;
    const subscriptionValue = optionalObject(root.subscription) ?? root;
    const managementToken = optionalString(root.managementToken) ?? optionalString(envelope.managementToken);
    if (!managementToken) {
        throw new ApiContractError('created subscription is missing managementToken');
    }

    return {
        subscription: decodeSubscriptionObject(subscriptionValue, 'created subscription'),
        managementToken,
    };
}

export function decodeTelegramLink(input: unknown): TelegramLink {
    const root = unwrapObject(input, 'Telegram link');
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
    return {
        status,
        dataFresh: optionalBoolean(value.dataFresh) ?? status === 'healthy',
        dataAgeMs: nullableNonNegativeNumber(value.dataAgeMs, `${path}.dataAgeMs`),
        lastAttemptAt: nullableIsoString(value.lastAttemptAt, `${path}.lastAttemptAt`),
        lastSuccessAt: nullableIsoString(value.lastSuccessAt, `${path}.lastSuccessAt`),
        lastError: optionalString(value.lastError) ?? null,
    };
}

function decodePendingOffense(input: unknown, fallbackNetwork: MonitorNetwork, path: string): PendingOffense {
    const value = expectObject(input, path);
    const status = expectString(value.status, `${path}.status`);
    if (status !== 'active' && status !== 'withdrawn') {
        throw new ApiContractError(`${path}.status must be active or withdrawn`);
    }

    return {
        id: expectString(value.id, `${path}.id`),
        network: optionalNetwork(value.network) ?? fallbackNetwork,
        sequencer: address(value.sequencer, `${path}.sequencer`),
        amount: optionalDecimalString(value.amount, `${path}.amount`),
        offenseType: nullableInteger(value.offenseType, `${path}.offenseType`),
        offenseTypeName: expectString(value.offenseTypeName, `${path}.offenseTypeName`),
        epochOrSlot: optionalDecimalString(value.epochOrSlot, `${path}.epochOrSlot`),
        timeUnit: optionalString(value.timeUnit) ?? null,
        status,
        firstSeenAt: isoString(value.firstSeenAt, `${path}.firstSeenAt`),
        lastSeenAt: isoString(value.lastSeenAt, `${path}.lastSeenAt`),
        withdrawnAt: nullableIsoString(value.withdrawnAt, `${path}.withdrawnAt`),
        observationCount: nullableInteger(value.observationCount, `${path}.observationCount`),
    };
}

function decodeEvent(input: unknown, fallbackNetwork: MonitorNetwork, path: string): MonitorEvent {
    const value = expectObject(input, path);
    const source = expectString(value.source, `${path}.source`);
    const data = optionalObject(value.data);
    const certaintyValue = optionalString(value.certainty);
    const certainty = certaintyValue === 'pending' || certaintyValue === 'confirmed'
        ? certaintyValue
        : source.toLowerCase().includes('aztec') || source.toLowerCase().includes('pending')
            ? 'pending'
            : 'confirmed';
    const explicitTargets = optionalArray(value.targets)?.map((target, index) =>
        address(target, `${path}.targets[${index}]`)) ?? [];
    const singletonTarget = value.sequencer ?? data?.sequencer ?? data?.address;
    const targets = explicitTargets.length > 0
        ? explicitTargets
        : singletonTarget === null || singletonTarget === undefined
            ? []
            : [address(singletonTarget, `${path}.sequencer`)];

    return {
        id: expectString(value.id, `${path}.id`),
        network: optionalNetwork(value.network) ?? fallbackNetwork,
        type: expectString(value.type, `${path}.type`),
        source,
        certainty,
        sequencer: targets[0] ?? null,
        targets,
        title: optionalString(value.title) ?? humanize(expectString(value.type, `${path}.type`)),
        body: optionalString(value.body) ?? '',
        offense: decodeEventOffense(data, `${path}.data`),
        occurredAt: isoString(value.occurredAt ?? value.observedAt ?? value.createdAt, `${path}.observedAt`),
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
    const sequencerValues = value.sequencers ?? value.addresses;
    const sequencers = expectArray(sequencerValues, `${path}.addresses`).map((item, index) =>
        address(item, `${path}.sequencers[${index}]`));
    const channels = optionalObject(value.channels) ?? {};

    return {
        id: expectString(value.id, `${path}.id`),
        network,
        sequencers,
        channels: {
            webPush: decodeChannel(channels.webPush, `${path}.channels.webPush`),
            telegram: decodeChannel(channels.telegram, `${path}.channels.telegram`),
        },
        createdAt: nullableIsoString(value.createdAt, `${path}.createdAt`),
        updatedAt: nullableIsoString(value.updatedAt, `${path}.updatedAt`),
    };
}

function decodeChannel(input: unknown, path: string): NotificationChannelState {
    if (typeof input === 'boolean') {
        return { connected: input, enabled: input, verified: input, label: null };
    }
    if (input === null || input === undefined) {
        return { connected: false, enabled: false, verified: false, label: null };
    }
    const value = expectObject(input, path);
    const enabled = optionalBoolean(value.enabled) ?? false;
    return {
        connected: optionalBoolean(value.connected) ?? enabled,
        enabled,
        verified: optionalBoolean(value.verified) ?? enabled,
        label: optionalString(value.label) ?? null,
    };
}

function unwrapObject(input: unknown, path: string): Record<string, unknown> {
    const envelope = expectObject(input, `${path} response`);
    return optionalObject(envelope.data) ?? envelope;
}

function expectV2Envelope(input: unknown, path: string): Record<string, unknown> {
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

function optionalArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
}

function expectString(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ApiContractError(`${path} must be a non-empty string`);
    }
    return value;
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
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

function nullableNonNegativeNumber(value: unknown, path: string): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new ApiContractError(`${path} must be a non-negative number or null`);
    }
    return value;
}

function boundedInteger(
    value: unknown,
    path: string,
    minimum: number,
    maximum: number,
    fallback: number,
): number {
    if (value === null || value === undefined) {
        return fallback;
    }
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new ApiContractError(`${path} must be an integer between ${minimum} and ${maximum}`);
    }
    return value as number;
}

function humanize(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
