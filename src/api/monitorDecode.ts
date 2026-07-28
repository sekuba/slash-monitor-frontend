import { getAddress, isAddress, type Address, type Hash } from 'viem';
import type {
    ApiCaseOutcome,
    ApiCasePhase,
    ApiSlashingCase,
    BackendStatus,
    ChannelState,
    ConfirmedSlash,
    CreatedWatchlist,
    HealthStatus,
    MonitorNetwork,
    MonitorSnapshot,
    NotificationTestResult,
    NodeOffense,
    ProtocolSnapshot,
    PublicConfig,
    SlashDatasetCoverage,
    SlashOutcomes,
    TelegramLink,
    ValidatorSnapshot,
    Watchlist,
    WebPushConnectionResult,
    WebPushVerificationResult,
    L1DatasetCoverage,
} from '@/types/api';

export class ApiContractError extends Error {
    constructor(message: string) {
        super(`Slashmon API contract error: ${message}`);
        this.name = 'ApiContractError';
    }
}

export function decodeConfig(value: unknown): PublicConfig {
    const data = record(value, 'config');
    const channels = record(data.channels, 'config.channels');
    const webPush = record(channels.webPush, 'config.channels.webPush');
    const telegram = record(channels.telegram, 'config.channels.telegram');
    return {
        network: network(data.network, 'config.network'),
        maxWatchlistAddresses: integer(
            data.maxWatchlistAddresses,
            'config.maxWatchlistAddresses',
            1,
            1_000,
        ),
        channels: {
            webPush: {
                available: boolean(webPush.available, 'config.channels.webPush.available'),
                publicKey: nullableString(webPush.publicKey, 'config.channels.webPush.publicKey'),
            },
            telegram: {
                available: boolean(telegram.available, 'config.channels.telegram.available'),
                botUsername: nullableString(
                    telegram.botUsername,
                    'config.channels.telegram.botUsername',
                ),
            },
        },
    };
}

export function decodeStatus(value: unknown): BackendStatus {
    const data = record(value, 'status');
    const sources = record(data.sources, 'status.sources');
    const l1 = record(sources.l1, 'status.sources.l1');
    const node = record(sources.node, 'status.sources.node');
    const notifications = record(data.notifications, 'status.notifications');
    const notificationChannels = record(
        notifications.channels,
        'status.notifications.channels',
    );
    return {
        network: network(data.network, 'status.network'),
        status: health(data.status, 'status.status'),
        observedAt: isoDate(data.observedAt, 'status.observedAt'),
        sources: {
            l1: {
                status: health(l1.status, 'status.sources.l1.status'),
                lastSuccessAt: nullableIsoDate(
                    l1.lastSuccessAt,
                    'status.sources.l1.lastSuccessAt',
                ),
                dataAgeMs: nullableInteger(l1.dataAgeMs, 'status.sources.l1.dataAgeMs', 0),
                blockNumber: l1.blockNumber === undefined
                    ? null
                    : nullableDecimal(l1.blockNumber, 'status.sources.l1.blockNumber'),
                blockHash: l1.blockHash === undefined
                    ? null
                    : nullableHash(l1.blockHash, 'status.sources.l1.blockHash'),
            },
            node: {
                status: health(node.status, 'status.sources.node.status'),
                lastSuccessAt: nullableIsoDate(
                    node.lastSuccessAt,
                    'status.sources.node.lastSuccessAt',
                ),
                dataAgeMs: nullableInteger(node.dataAgeMs, 'status.sources.node.dataAgeMs', 0),
            },
        },
        notifications: {
            status: health(notifications.status, 'status.notifications.status'),
            channels: {
                webPush: decodeHealthOnly(
                    notificationChannels.webPush,
                    'status.notifications.channels.webPush',
                ),
                telegram: decodeHealthOnly(
                    notificationChannels.telegram,
                    'status.notifications.channels.telegram',
                ),
            },
        },
    };
}

export function decodeMonitor(value: unknown): MonitorSnapshot {
    const data = record(value, 'monitor');
    const coverage = record(data.coverage, 'monitor.coverage');
    return {
        network: network(data.network, 'monitor.network'),
        coverage: {
            cases: decodeL1DatasetCoverage(
                coverage.cases,
                'monitor.coverage.cases',
            ),
            slashes: decodeSlashDatasetCoverage(
                coverage.slashes,
                'monitor.coverage.slashes',
            ),
        },
        protocol: data.protocol === null
            ? null
            : decodeProtocol(data.protocol, 'monitor.protocol'),
        cases: array(data.cases, 'monitor.cases', 250)
            .map((item, index) => decodeCase(item, `monitor.cases[${index}]`)),
        slashes: decodeSlashOutcomes(data.slashes, 'monitor.slashes'),
    };
}

export function decodeValidator(value: unknown): ValidatorSnapshot {
    const data = record(value, 'validator');
    return {
        address: address(data.address, 'validator.address'),
        observedAt: nullableIsoDate(data.observedAt, 'validator.observedAt'),
        cases: array(data.cases, 'validator.cases', 250)
            .map((item, index) => decodeCase(item, `validator.cases[${index}]`)),
        nodeOffenses: array(data.nodeOffenses, 'validator.nodeOffenses', 500)
            .map((item, index) => decodeOffense(item, `validator.nodeOffenses[${index}]`)),
        slashes: decodeSlashOutcomes(data.slashes, 'validator.slashes'),
    };
}

export function decodeWatchlist(value: unknown): Watchlist {
    const data = record(value, 'watchlist');
    const channels = record(data.channels, 'watchlist.channels');
    return {
        id: identifier(data.id, 'watchlist.id'),
        addresses: array(data.addresses, 'watchlist.addresses', 1_000)
            .map((item, index) => address(item, `watchlist.addresses[${index}]`)),
        channels: {
            webPush: decodeChannel(channels.webPush, 'watchlist.channels.webPush'),
            telegram: decodeChannel(channels.telegram, 'watchlist.channels.telegram'),
        },
    };
}

export function decodeCreatedWatchlist(value: unknown): CreatedWatchlist {
    const watchlist = decodeWatchlist(value);
    return {
        ...watchlist,
        managementToken: nonEmptyString(
            record(value, 'watchlist').managementToken,
            'watchlist.managementToken',
        ),
    };
}

export function decodeTelegramLink(value: unknown): TelegramLink {
    const data = record(value, 'telegram link');
    const url = nonEmptyString(data.url, 'telegram link.url');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 't.me') {
        throw new ApiContractError('telegram link.url must be an official HTTPS t.me link');
    }
    return {
        url,
        expiresAt: isoDate(data.expiresAt, 'telegram link.expiresAt'),
    };
}

export function decodeWebPushConnection(value: unknown): WebPushConnectionResult {
    const data = record(value, 'Web Push connection');
    return {
        connected: boolean(data.connected, 'Web Push connection.connected'),
        enabled: boolean(data.enabled, 'Web Push connection.enabled'),
        verified: boolean(data.verified, 'Web Push connection.verified'),
        verificationQueued: integer(
            data.verificationQueued,
            'Web Push connection.verificationQueued',
            0,
        ),
    };
}

export function decodeWebPushVerification(value: unknown): WebPushVerificationResult {
    const data = record(value, 'Web Push verification');
    return {
        verified: boolean(data.verified, 'Web Push verification.verified'),
        queued: integer(data.queued, 'Web Push verification.queued', 0),
    };
}

export function decodeNotificationTest(value: unknown): NotificationTestResult {
    const data = record(value, 'notification test');
    return {
        queued: integer(data.queued, 'notification test.queued', 1),
    };
}

function decodeHealthOnly(value: unknown, path: string): { status: HealthStatus } {
    return {
        status: health(record(value, path).status, `${path}.status`),
    };
}

function decodeL1DatasetCoverage(value: unknown, path: string): L1DatasetCoverage {
    const data = record(value, path);
    return {
        observedAt: nullableIsoDate(data.observedAt, `${path}.observedAt`),
        blockNumber: nullableDecimal(data.blockNumber, `${path}.blockNumber`),
        blockHash: nullableHash(data.blockHash, `${path}.blockHash`),
        complete: boolean(data.complete, `${path}.complete`),
    };
}

function decodeSlashDatasetCoverage(value: unknown, path: string): SlashDatasetCoverage {
    const data = record(value, path);
    return {
        observedAt: nullableIsoDate(data.observedAt, `${path}.observedAt`),
        fromBlock: nullableDecimal(data.fromBlock, `${path}.fromBlock`),
        blockNumber: nullableDecimal(data.blockNumber, `${path}.blockNumber`),
        blockHash: nullableHash(data.blockHash, `${path}.blockHash`),
        confirmedBlockNumber: nullableDecimal(
            data.confirmedBlockNumber,
            `${path}.confirmedBlockNumber`,
        ),
        complete: boolean(data.complete, `${path}.complete`),
    };
}

function decodeSlashOutcomes(value: unknown, path: string): SlashOutcomes {
    const data = record(value, path);
    return {
        confirmed: decodeSlashList(data.confirmed, `${path}.confirmed`, true),
        removed: decodeSlashList(data.removed, `${path}.removed`, false),
    };
}

function decodeSlashList(
    value: unknown,
    path: string,
    expectedCanonical: boolean,
): ConfirmedSlash[] {
    return array(value, path, 250).map((item, index) => {
        const itemPath = `${path}[${index}]`;
        const slash = decodeSlash(item, itemPath);
        if (slash.canonical !== expectedCanonical) {
            throw new ApiContractError(
                `${itemPath}.canonical must be ${expectedCanonical} in this collection`,
            );
        }
        return slash;
    });
}

function decodeProtocol(value: unknown, path: string): ProtocolSnapshot {
    const data = record(value, path);
    return {
        chainId: integer(data.chainId, `${path}.chainId`, 1, Number.MAX_SAFE_INTEGER),
        observedAt: isoDate(data.observedAt, `${path}.observedAt`),
        currentSlot: decimal(data.currentSlot, `${path}.currentSlot`),
        currentEpoch: decimal(data.currentEpoch, `${path}.currentEpoch`),
        currentRound: decimal(data.currentRound, `${path}.currentRound`),
        slotDurationSeconds: integer(data.slotDurationSeconds, `${path}.slotDurationSeconds`, 1),
        epochDurationSlots: integer(data.epochDurationSlots, `${path}.epochDurationSlots`, 1),
        quorum: integer(data.quorum, `${path}.quorum`, 1),
        roundSizeSlots: integer(data.roundSizeSlots, `${path}.roundSizeSlots`, 1),
        roundSizeEpochs: integer(data.roundSizeEpochs, `${path}.roundSizeEpochs`, 1),
        executionDelayRounds: integer(data.executionDelayRounds, `${path}.executionDelayRounds`, 0),
        lifetimeRounds: integer(data.lifetimeRounds, `${path}.lifetimeRounds`, 1),
        slashOffsetRounds: integer(data.slashOffsetRounds, `${path}.slashOffsetRounds`, 1),
        roundDurationSeconds: integer(data.roundDurationSeconds, `${path}.roundDurationSeconds`, 1),
        executionDelaySeconds: integer(data.executionDelaySeconds, `${path}.executionDelaySeconds`, 0),
        executionWindowSeconds: integer(data.executionWindowSeconds, `${path}.executionWindowSeconds`, 1),
        isSlashingEnabled: boolean(data.isSlashingEnabled, `${path}.isSlashingEnabled`),
        pauseDurationSeconds: nullableInteger(data.pauseDurationSeconds, `${path}.pauseDurationSeconds`, 1),
        slashingDisabledUntil: nullableDecimal(data.slashingDisabledUntil, `${path}.slashingDisabledUntil`),
        pauseStartedAtSlot: nullableDecimal(data.pauseStartedAtSlot, `${path}.pauseStartedAtSlot`),
        pauseEndsAtSlot: nullableDecimal(data.pauseEndsAtSlot, `${path}.pauseEndsAtSlot`),
    };
}

function decodeCase(value: unknown, path: string): ApiSlashingCase {
    const data = record(value, path);
    const result: ApiSlashingCase = {
        id: identifier(data.id, `${path}.id`),
        role: enumeration(data.role, `${path}.role`, ['active', 'legacy'] as const),
        round: decimal(data.round, `${path}.round`),
        phase: enumeration(
            data.phase,
            `${path}.phase`,
            ['voting', 'review', 'ready', 'paused', 'closed'] as const,
        ) as ApiCasePhase,
        outcome: data.outcome === null
            ? null
            : enumeration(
                data.outcome,
                `${path}.outcome`,
                ['no-consensus', 'vetoed', 'executed', 'expired', 'stack-retired'] as const,
            ) as ApiCaseOutcome,
        votesCast: decimal(data.votesCast, `${path}.votesCast`),
        quorum: integer(data.quorum, `${path}.quorum`, 1),
        targetEpochs: array(data.targetEpochs, `${path}.targetEpochs`, 64)
            .map((item, index) => decimal(item, `${path}.targetEpochs[${index}]`)),
        targets: array(data.targets, `${path}.targets`, 1_000).map((item, index) => {
            const targetPath = `${path}.targets[${index}]`;
            const target = record(item, targetPath);
            return {
                address: address(target.address, `${targetPath}.address`),
                proposedAmount: decimal(target.proposedAmount, `${targetPath}.proposedAmount`),
                actionCount: integer(target.actionCount, `${targetPath}.actionCount`, 1),
            };
        }),
        proposerAddress: address(data.proposerAddress, `${path}.proposerAddress`),
        slasherAddress: address(data.slasherAddress, `${path}.slasherAddress`),
        payloadAddress: nullableAddress(data.payloadAddress, `${path}.payloadAddress`),
        currentPayloadVetoed: boolean(data.currentPayloadVetoed, `${path}.currentPayloadVetoed`),
        executableSlot: decimal(data.executableSlot, `${path}.executableSlot`),
        executableAt: isoDate(data.executableAt, `${path}.executableAt`),
        expirySlot: decimal(data.expirySlot, `${path}.expirySlot`),
        expiryAt: isoDate(data.expiryAt, `${path}.expiryAt`),
        isExecutionPaused: boolean(data.isExecutionPaused, `${path}.isExecutionPaused`),
        pauseEndsAtSlot: nullableDecimal(data.pauseEndsAtSlot, `${path}.pauseEndsAtSlot`),
        pauseEndsAt: nullableIsoDate(data.pauseEndsAt, `${path}.pauseEndsAt`),
        blockNumber: decimal(data.blockNumber, `${path}.blockNumber`),
        blockHash: hash(data.blockHash, `${path}.blockHash`),
        firstObservedAt: isoDate(data.firstObservedAt, `${path}.firstObservedAt`),
        observedAt: isoDate(data.observedAt, `${path}.observedAt`),
    };
    if (result.phase === 'closed' && result.outcome === null) {
        throw new ApiContractError(`${path}.outcome is required when phase is closed`);
    }
    if (result.phase !== 'closed' && result.outcome !== null) {
        throw new ApiContractError(`${path}.outcome must be null while the case is open`);
    }
    return result;
}

function decodeSlash(value: unknown, path: string): ConfirmedSlash {
    const data = record(value, path);
    return {
        id: identifier(data.id, `${path}.id`),
        address: address(data.address, `${path}.address`),
        actualAmount: decimal(data.actualAmount, `${path}.actualAmount`),
        logCount: integer(data.logCount, `${path}.logCount`, 1),
        logIndexes: array(data.logIndexes, `${path}.logIndexes`, 1_000)
            .map((item, index) => integer(item, `${path}.logIndexes[${index}]`, 0)),
        canonical: boolean(data.canonical, `${path}.canonical`),
        chainId: integer(data.chainId, `${path}.chainId`, 1, Number.MAX_SAFE_INTEGER),
        rollupAddress: address(data.rollupAddress, `${path}.rollupAddress`),
        blockNumber: decimal(data.blockNumber, `${path}.blockNumber`),
        blockHash: hash(data.blockHash, `${path}.blockHash`),
        transactionHash: hash(data.transactionHash, `${path}.transactionHash`),
        firstObservedAt: isoDate(data.firstObservedAt, `${path}.firstObservedAt`),
        observedAt: isoDate(data.observedAt, `${path}.observedAt`),
    };
}

function decodeOffense(value: unknown, path: string): NodeOffense {
    const data = record(value, path);
    return {
        id: identifier(data.id, `${path}.id`),
        address: address(data.address, `${path}.address`),
        configuredPenalty: decimal(
            data.configuredPenalty,
            `${path}.configuredPenalty`,
        ),
        offenseType: integer(data.offenseType, `${path}.offenseType`, 0),
        offenseTypeName: nonEmptyString(data.offenseTypeName, `${path}.offenseTypeName`),
        epochOrSlot: decimal(data.epochOrSlot, `${path}.epochOrSlot`),
        timeUnit: enumeration(
            data.timeUnit,
            `${path}.timeUnit`,
            ['epoch', 'slot', 'unknown'] as const,
        ),
        status: enumeration(data.status, `${path}.status`, ['active', 'resolved'] as const),
        firstObservedAt: isoDate(data.firstObservedAt, `${path}.firstObservedAt`),
        lastObservedAt: isoDate(data.lastObservedAt, `${path}.lastObservedAt`),
        resolvedAt: nullableIsoDate(data.resolvedAt, `${path}.resolvedAt`),
    };
}

function decodeChannel(value: unknown, path: string): ChannelState {
    const data = record(value, path);
    return {
        connected: boolean(data.connected, `${path}.connected`),
        enabled: boolean(data.enabled, `${path}.enabled`),
        verified: boolean(data.verified, `${path}.verified`),
    };
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ApiContractError(`${path} must be an object`);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, path: string, maximum: number): unknown[] {
    if (!Array.isArray(value) || value.length > maximum) {
        throw new ApiContractError(`${path} must be an array with at most ${maximum} items`);
    }
    return value;
}

function nonEmptyString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ApiContractError(`${path} must be a non-empty string`);
    }
    return value;
}

function nullableString(value: unknown, path: string): string | null {
    return value === null ? null : nonEmptyString(value, path);
}

function boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') throw new ApiContractError(`${path} must be boolean`);
    return value;
}

function integer(
    value: unknown,
    path: string,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER,
): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new ApiContractError(`${path} must be an integer between ${minimum} and ${maximum}`);
    }
    return value as number;
}

function nullableInteger(value: unknown, path: string, minimum: number): number | null {
    return value === null ? null : integer(value, path, minimum);
}

function decimal(value: unknown, path: string): string {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new ApiContractError(`${path} must be an unsigned decimal string`);
    }
    return value;
}

function nullableDecimal(value: unknown, path: string): string | null {
    return value === null ? null : decimal(value, path);
}

function address(value: unknown, path: string): Address {
    if (typeof value !== 'string' || !isAddress(value)) {
        throw new ApiContractError(`${path} must be an Ethereum address`);
    }
    return getAddress(value);
}

function nullableAddress(value: unknown, path: string): Address | null {
    return value === null ? null : address(value, path);
}

function hash(value: unknown, path: string): Hash {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
        throw new ApiContractError(`${path} must be a 32-byte hash`);
    }
    return value as Hash;
}

function nullableHash(value: unknown, path: string): Hash | null {
    return value === null ? null : hash(value, path);
}

function isoDate(value: unknown, path: string): string {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new ApiContractError(`${path} must be an ISO date`);
    }
    return value;
}

function nullableIsoDate(value: unknown, path: string): string | null {
    return value === null ? null : isoDate(value, path);
}

function network(value: unknown, path: string): MonitorNetwork {
    return enumeration(value, path, ['mainnet', 'testnet'] as const);
}

function health(value: unknown, path: string): HealthStatus {
    return enumeration(
        value,
        path,
        ['healthy', 'degraded', 'stale', 'unavailable'] as const,
    );
}

function identifier(value: unknown, path: string): string {
    const result = nonEmptyString(value, path);
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(result)) {
        throw new ApiContractError(`${path} contains unsupported characters`);
    }
    return result;
}

function enumeration<const T extends readonly string[]>(
    value: unknown,
    path: string,
    values: T,
): T[number] {
    if (typeof value !== 'string' || !values.includes(value)) {
        throw new ApiContractError(`${path} must be one of ${values.join(', ')}`);
    }
    return value as T[number];
}
