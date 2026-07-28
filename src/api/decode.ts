import type { Address } from 'viem';
import type {
    BackendHealthStatus,
    CreatedSubscription,
    EventPage,
    ManagedSubscription,
    MonitorEvent,
    MonitorNetwork,
    NotificationChannelState,
    SequencerRecordPage,
    SlashingProtocolSnapshot,
    SourceHealth,
    TelegramLink,
    BackendConfig,
    BackendStatus,
} from '@/types/backendApi';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEALTH_STATUSES = new Set<BackendHealthStatus>(['healthy', 'degraded', 'stale', 'unavailable']);
const ACTION_CHANGE_KINDS = new Set(['added', 'removed', 'amount_changed']);

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

export function decodeSequencerRecord(
    input: unknown,
    expectedNetwork: MonitorNetwork,
    expectedSequencer: string,
): SequencerRecordPage {
    const envelope = expectApiEnvelope(input, 'sequencer record');
    const root = expectObject(envelope.data, 'sequencer record.data');
    const sequencer = address(root.sequencer, 'sequencer record.data.sequencer');
    if (sequencer.toLowerCase() !== expectedSequencer.toLowerCase()) {
        throw new ApiContractError('sequencer record address does not match the request');
    }
    const pagination = expectObject(envelope.pagination, 'sequencer record.pagination');
    return {
        sequencer,
        protocol: root.protocol === null
            ? null
            : decodeProtocolSnapshot(root.protocol, 'sequencer record.data.protocol'),
        events: expectArray(root.events, 'sequencer record.data.events').map((event, index) =>
            decodeEvent(event, expectedNetwork, `sequencer record.data.events[${index}]`)),
        nextCursor: optionalString(pagination.nextCursor) ?? null,
    };
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
        nodeEvidence: decodeNodeEvidence(data.nodeEvidence, `${path}.data.nodeEvidence`),
        l1: source === 'ethereum_l1' ? decodeEventL1(data, network, `${path}.data`) : null,
        occurredAt: isoString(value.occurredAt, `${path}.occurredAt`),
    };
}

function decodeNodeEvidence(input: unknown, path: string): MonitorEvent['nodeEvidence'] {
    if (input === undefined) return [];
    return expectArray(input, path).map((item, index) => {
        const evidencePath = `${path}[${index}]`;
        const value = expectObject(item, evidencePath);
        const kind = expectString(value.kind, `${evidencePath}.kind`);
        if (kind !== 'slash_offense' && kind !== 'inactivity_epoch') {
            throw new ApiContractError(`${evidencePath}.kind is invalid`);
        }
        const timeUnit = expectString(value.timeUnit, `${evidencePath}.timeUnit`);
        if (timeUnit !== 'epoch' && timeUnit !== 'slot') {
            throw new ApiContractError(`${evidencePath}.timeUnit must be epoch or slot`);
        }
        return {
            kind,
            sequencer: address(value.sequencer, `${evidencePath}.sequencer`),
            epoch: decimalString(value.epoch, `${evidencePath}.epoch`),
            offenseId: optionalString(value.offenseId) ?? null,
            offenseType: nullableInteger(value.offenseType, `${evidencePath}.offenseType`),
            offenseTypeName: expectString(value.offenseTypeName, `${evidencePath}.offenseTypeName`),
            epochOrSlot: decimalString(value.epochOrSlot, `${evidencePath}.epochOrSlot`),
            timeUnit,
            amount: optionalDecimalString(value.amount, `${evidencePath}.amount`),
            firstSeenAt: isoString(value.firstSeenAt, `${evidencePath}.firstSeenAt`),
            missed: nullableBoundedInteger(value.missed, `${evidencePath}.missed`, 0),
            total: nullableBoundedInteger(value.total, `${evidencePath}.total`, 0),
            firstMissedSlot: optionalDecimalString(
                value.firstMissedSlot,
                `${evidencePath}.firstMissedSlot`,
            ),
            lastMissedSlot: optionalDecimalString(
                value.lastMissedSlot,
                `${evidencePath}.lastMissedSlot`,
            ),
            inactiveStreak: nullableBoundedInteger(
                value.inactiveStreak,
                `${evidencePath}.inactiveStreak`,
                0,
            ),
            slashableThreshold: nullableBoundedInteger(
                value.slashableThreshold,
                `${evidencePath}.slashableThreshold`,
                1,
            ),
            targetPercentage: nullableNumberInRange(
                value.targetPercentage,
                `${evidencePath}.targetPercentage`,
                0,
                1,
            ),
        };
    });
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
        epoch: optionalDecimalString(data?.epoch, `${path}.epoch`),
        slot: optionalDecimalString(data?.slot, `${path}.slot`),
        offenseRound: optionalDecimalString(data?.offenseRound, `${path}.offenseRound`),
        proposalRound: optionalDecimalString(data?.proposalRound, `${path}.proposalRound`),
    };
}

function decodeEventL1(
    data: Record<string, unknown>,
    network: MonitorNetwork,
    path: string,
): NonNullable<MonitorEvent['l1']> {
    const actions = data.actions === undefined
        ? []
        : expectArray(data.actions, `${path}.actions`).map((item, index) => {
            const action = expectObject(item, `${path}.actions[${index}]`);
            return {
                sequencer: address(action.sequencer, `${path}.actions[${index}].sequencer`),
                amount: decimalString(action.amount, `${path}.actions[${index}].amount`),
            };
        });
    const targetEpochs = data.targetEpochs === undefined
        ? []
        : expectArray(data.targetEpochs, `${path}.targetEpochs`).map((epoch, index) =>
            decimalString(epoch, `${path}.targetEpochs[${index}]`));
    const actionChanges = data.actionChanges === undefined
        ? []
        : expectArray(data.actionChanges, `${path}.actionChanges`).map((item, index) => {
            const changePath = `${path}.actionChanges[${index}]`;
            const change = expectObject(item, changePath);
            const kind = expectString(change.kind, `${changePath}.kind`);
            if (!ACTION_CHANGE_KINDS.has(kind)) {
                throw new ApiContractError(`${changePath}.kind is invalid`);
            }
            return {
                sequencer: address(change.sequencer, `${changePath}.sequencer`),
                kind: kind as 'added' | 'removed' | 'amount_changed',
                previousAmount: optionalDecimalString(
                    change.previousAmount,
                    `${changePath}.previousAmount`,
                ),
                currentAmount: optionalDecimalString(
                    change.currentAmount,
                    `${changePath}.currentAmount`,
                ),
            };
        });

    return {
        chainId: data.chainId === undefined || data.chainId === null
            ? network === 'mainnet' ? 1 : 11_155_111
            : boundedInteger(data.chainId, `${path}.chainId`, 1, Number.MAX_SAFE_INTEGER),
        role: optionalString(data.role),
        round: optionalDecimalString(data.round, `${path}.round`),
        status: optionalString(data.status),
        targetEpochs,
        currentSlot: optionalDecimalString(data.currentSlot, `${path}.currentSlot`),
        currentEpoch: optionalDecimalString(data.currentEpoch, `${path}.currentEpoch`),
        executableSlot: optionalDecimalString(data.executableSlot, `${path}.executableSlot`),
        executableAt: nullableIsoString(data.executableAt, `${path}.executableAt`),
        expirySlot: optionalDecimalString(data.expirySlot, `${path}.expirySlot`),
        expiryAt: nullableIsoString(data.expiryAt, `${path}.expiryAt`),
        blockNumber: optionalDecimalString(data.blockNumber, `${path}.blockNumber`),
        blockHash: optionalHash(data.blockHash, `${path}.blockHash`),
        transactionHash: optionalHash(data.transactionHash, `${path}.transactionHash`),
        payloadAddress: optionalAddress(data.payloadAddress, `${path}.payloadAddress`),
        slasherAddress: optionalAddress(data.slasherAddress, `${path}.slasherAddress`),
        previousPayloadAddress: optionalAddress(
            data.previousPayloadAddress,
            `${path}.previousPayloadAddress`,
        ),
        previousPayloadWasVetoed: optionalBoolean(
            data.previousPayloadWasVetoed,
            `${path}.previousPayloadWasVetoed`,
        ),
        amount: optionalDecimalString(data.amount, `${path}.amount`),
        isVetoed: optionalBoolean(data.isVetoed, `${path}.isVetoed`),
        isExecuted: optionalBoolean(data.isExecuted, `${path}.isExecuted`),
        isSlashingEnabled: optionalBoolean(data.isSlashingEnabled, `${path}.isSlashingEnabled`),
        isExecutionPaused: optionalBoolean(data.isExecutionPaused, `${path}.isExecutionPaused`),
        isProtected: optionalBoolean(data.isProtected, `${path}.isProtected`),
        pauseStartedAtSlot: optionalDecimalString(
            data.pauseStartedAtSlot,
            `${path}.pauseStartedAtSlot`,
        ),
        pauseEndsAtSlot: optionalDecimalString(data.pauseEndsAtSlot, `${path}.pauseEndsAtSlot`),
        actions,
        actionChanges,
    };
}

function decodeProtocolSnapshot(input: unknown, path: string): SlashingProtocolSnapshot {
    const value = expectObject(input, path);
    const inactivity = value.inactivity === null
        ? null
        : (() => {
            const config = expectObject(value.inactivity, `${path}.inactivity`);
            return {
                targetPercentage: numberInRange(
                    config.targetPercentage,
                    `${path}.inactivity.targetPercentage`,
                    0,
                    1,
                ),
                consecutiveEpochs: boundedInteger(
                    config.consecutiveEpochs,
                    `${path}.inactivity.consecutiveEpochs`,
                    1,
                    Number.MAX_SAFE_INTEGER,
                ),
            };
        })();
    return {
        chainId: boundedInteger(value.chainId, `${path}.chainId`, 1, Number.MAX_SAFE_INTEGER),
        observedAt: isoString(value.observedAt, `${path}.observedAt`),
        currentSlot: decimalString(value.currentSlot, `${path}.currentSlot`),
        currentEpoch: decimalString(value.currentEpoch, `${path}.currentEpoch`),
        currentRound: decimalString(value.currentRound, `${path}.currentRound`),
        slotDurationSeconds: boundedInteger(
            value.slotDurationSeconds,
            `${path}.slotDurationSeconds`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        epochDurationSlots: boundedInteger(
            value.epochDurationSlots,
            `${path}.epochDurationSlots`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        quorum: boundedInteger(value.quorum, `${path}.quorum`, 1, Number.MAX_SAFE_INTEGER),
        roundSizeSlots: boundedInteger(
            value.roundSizeSlots,
            `${path}.roundSizeSlots`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        roundSizeEpochs: boundedInteger(
            value.roundSizeEpochs,
            `${path}.roundSizeEpochs`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        executionDelayRounds: boundedInteger(
            value.executionDelayRounds,
            `${path}.executionDelayRounds`,
            0,
            Number.MAX_SAFE_INTEGER,
        ),
        lifetimeRounds: boundedInteger(
            value.lifetimeRounds,
            `${path}.lifetimeRounds`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        slashOffsetRounds: boundedInteger(
            value.slashOffsetRounds,
            `${path}.slashOffsetRounds`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        roundDurationSeconds: boundedInteger(
            value.roundDurationSeconds,
            `${path}.roundDurationSeconds`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        executionDelaySeconds: boundedInteger(
            value.executionDelaySeconds,
            `${path}.executionDelaySeconds`,
            0,
            Number.MAX_SAFE_INTEGER,
        ),
        executionWindowSeconds: boundedInteger(
            value.executionWindowSeconds,
            `${path}.executionWindowSeconds`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        isSlashingEnabled: expectBoolean(value.isSlashingEnabled, `${path}.isSlashingEnabled`),
        pauseDurationSeconds: nullableBoundedInteger(
            value.pauseDurationSeconds,
            `${path}.pauseDurationSeconds`,
            1,
        ),
        slashingDisabledUntil: optionalDecimalString(
            value.slashingDisabledUntil,
            `${path}.slashingDisabledUntil`,
        ),
        pauseStartedAtSlot: optionalDecimalString(
            value.pauseStartedAtSlot,
            `${path}.pauseStartedAtSlot`,
        ),
        pauseEndsAtSlot: optionalDecimalString(value.pauseEndsAtSlot, `${path}.pauseEndsAtSlot`),
        inactivity,
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

function optionalBoolean(value: unknown, path: string): boolean | null {
    if (value === null || value === undefined) return null;
    return expectBoolean(value, path);
}

function address(value: unknown, path: string): Address {
    const result = expectString(value, path);
    if (!ADDRESS_PATTERN.test(result)) {
        throw new ApiContractError(`${path} must be a 20-byte Ethereum address`);
    }
    return result as Address;
}

function optionalAddress(value: unknown, path: string): Address | null {
    if (value === null || value === undefined) {
        return null;
    }
    return address(value, path);
}

function optionalHash(value: unknown, path: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const result = expectString(value, path);
    if (!HASH_PATTERN.test(result)) {
        throw new ApiContractError(`${path} must be a 32-byte hash`);
    }
    return result;
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

function decimalString(value: unknown, path: string): string {
    const result = optionalDecimalString(value, path);
    if (result === null) {
        throw new ApiContractError(`${path} must be an unsigned decimal string`);
    }
    return result;
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

function nullableBoundedInteger(value: unknown, path: string, minimum: number): number | null {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
        throw new ApiContractError(`${path} must be an integer of at least ${minimum} or null`);
    }
    return value as number;
}

function nullableNumberInRange(
    value: unknown,
    path: string,
    minimum: number,
    maximum: number,
): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new ApiContractError(`${path} must be a number between ${minimum} and ${maximum} or null`);
    }
    return value;
}

function numberInRange(
    value: unknown,
    path: string,
    minimum: number,
    maximum: number,
): number {
    const result = nullableNumberInRange(value, path, minimum, maximum);
    if (result === null) {
        throw new ApiContractError(`${path} must be a number between ${minimum} and ${maximum}`);
    }
    return result;
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
