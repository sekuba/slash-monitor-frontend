import { describe, expect, it } from 'vitest';
import { apiCaseToDomain } from '@/domain';
import {
    ApiContractError,
    decodeConfig,
    decodeCreatedWatchlist,
    decodeMonitor,
    decodeStatus,
    decodeValidator,
} from './monitorDecode';

const VALIDATOR = '0x1111111111111111111111111111111111111111';
const SLASHER = '0x2222222222222222222222222222222222222222';
const PROPOSER = '0x3333333333333333333333333333333333333333';
const PAYLOAD = '0x4444444444444444444444444444444444444444';
const ROLLUP = '0x5555555555555555555555555555555555555555';
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const TX_HASH = `0x${'cd'.repeat(32)}`;
const AT = '2026-07-28T09:00:00.000Z';

describe('clean monitor API decoders', () => {
    it('decodes direct config and health resources without envelopes', () => {
        expect(decodeConfig({
            network: 'mainnet',
            maxWatchlistAddresses: 100,
            channels: {
                webPush: { available: true, publicKey: 'public-key' },
                telegram: { available: true, botUsername: 'slashmon_bot' },
            },
        })).toEqual({
            network: 'mainnet',
            maxWatchlistAddresses: 100,
            channels: {
                webPush: { available: true, publicKey: 'public-key' },
                telegram: { available: true, botUsername: 'slashmon_bot' },
            },
        });

        const status = decodeStatus({
            network: 'mainnet',
            status: 'healthy',
            observedAt: AT,
            sources: {
                node: { status: 'healthy', lastSuccessAt: AT, dataAgeMs: 20 },
                l1: {
                    status: 'healthy',
                    lastSuccessAt: AT,
                    dataAgeMs: 10,
                    blockNumber: '24500000',
                    blockHash: BLOCK_HASH,
                },
            },
            notifications: {
                status: 'degraded',
                channels: {
                    webPush: { status: 'degraded' },
                    telegram: { status: 'healthy' },
                },
            },
        });
        expect(status.sources.l1.blockNumber).toBe('24500000');
        expect(status.notifications.status).toBe('degraded');
        expect(status.notifications.channels.webPush.status).toBe('degraded');
    });

    it('keeps proposed action aggregation distinct from confirmed token loss', () => {
        const snapshot = decodeMonitor(monitorPayload());
        const slashingCase = apiCaseToDomain(
            snapshot.cases[0],
            snapshot.protocol!,
            snapshot.network,
        );

        expect(slashingCase.targets).toHaveLength(1);
        expect(slashingCase.targets[0]).toMatchObject({
            proposedAmount: 4_000_000_000_000_000_000_000n,
            proposedActionCount: 2,
        });
        expect(slashingCase.state).toEqual({ kind: 'phase', phase: 'ready' });
        expect(snapshot.slashes.confirmed[0]).toMatchObject({
            actualAmount: '3500000000000000000000',
            logCount: 2,
            canonical: true,
        });
    });

    it('rejects contradictory open phases with terminal outcomes', () => {
        const payload = monitorPayload();
        (payload.cases[0] as { outcome: string | null }).outcome = 'executed';
        expect(() => decodeMonitor(payload)).toThrow(ApiContractError);
    });

    it('decodes a validator record without treating node evidence as an L1 case', () => {
        const validator = decodeValidator({
            address: VALIDATOR,
            observedAt: AT,
            cases: [],
            nodeOffenses: [{
                id: 'offense-1',
                address: VALIDATOR,
                configuredPenalty: '2000000000000000000000',
                offenseType: 3,
                offenseTypeName: 'inactivity',
                epochOrSlot: '820',
                timeUnit: 'epoch',
                status: 'active',
                firstObservedAt: AT,
                lastObservedAt: AT,
                resolvedAt: null,
                observationCount: 1,
            }],
            slashes: { confirmed: [], removed: [] },
        });

        expect(validator.cases).toEqual([]);
        expect(validator.nodeOffenses[0]).toMatchObject({
            configuredPenalty: '2000000000000000000000',
            offenseTypeName: 'inactivity',
            status: 'active',
        });
    });

    it('keeps future offense types usable when their position unit is unknown', () => {
        const validator = decodeValidator({
            address: VALIDATOR,
            observedAt: AT,
            cases: [],
            nodeOffenses: [{
                id: 'offense-future',
                address: VALIDATOR,
                configuredPenalty: '0',
                offenseType: 99,
                offenseTypeName: 'unknown_99',
                epochOrSlot: '820',
                timeUnit: 'unknown',
                status: 'active',
                firstObservedAt: AT,
                lastObservedAt: AT,
                resolvedAt: null,
            }],
            slashes: { confirmed: [], removed: [] },
        });

        expect(validator.nodeOffenses[0].timeUnit).toBe('unknown');
    });

    it('requires the one-time management token only on watchlist creation', () => {
        expect(decodeCreatedWatchlist({
            id: '11111111-1111-4111-8111-111111111111',
            addresses: [VALIDATOR],
            channels: disconnectedChannels(),
            managementToken: 'one-time-secret',
        }).managementToken).toBe('one-time-secret');

        expect(() => decodeCreatedWatchlist({
            id: '11111111-1111-4111-8111-111111111111',
            addresses: [VALIDATOR],
            channels: disconnectedChannels(),
        })).toThrow(ApiContractError);
    });
});

function monitorPayload() {
    return {
        network: 'mainnet',
        coverage: {
            cases: {
                observedAt: AT,
                blockNumber: '24500000',
                blockHash: BLOCK_HASH,
                complete: true,
            },
            slashes: {
                observedAt: AT,
                fromBlock: '24499000',
                blockNumber: '24500000',
                blockHash: BLOCK_HASH,
                confirmedBlockNumber: '24500000',
                complete: true,
            },
        },
        protocol: {
            chainId: 1,
            observedAt: AT,
            currentSlot: '34000',
            currentEpoch: '1062',
            currentRound: '265',
            slotDurationSeconds: 72,
            epochDurationSlots: 32,
            quorum: 65,
            roundSizeSlots: 128,
            roundSizeEpochs: 4,
            executionDelayRounds: 28,
            lifetimeRounds: 34,
            slashOffsetRounds: 2,
            roundDurationSeconds: 9216,
            executionDelaySeconds: 258048,
            executionWindowSeconds: 55296,
            isSlashingEnabled: true,
            pauseDurationSeconds: 259200,
            slashingDisabledUntil: null,
            pauseStartedAtSlot: null,
            pauseEndsAtSlot: null,
        },
        cases: [{
            id: 'mainnet-active-236',
            role: 'active',
            round: '236',
            phase: 'ready',
            outcome: null,
            votesCast: '130',
            quorum: 65,
            targetEpochs: ['936', '937', '938', '939'],
            targets: [{
                address: VALIDATOR,
                proposedAmount: '4000000000000000000000',
                actionCount: 2,
            }],
            proposerAddress: PROPOSER,
            slasherAddress: SLASHER,
            payloadAddress: PAYLOAD,
            currentPayloadVetoed: false,
            executableSlot: '33920',
            executableAt: '2026-07-28T07:24:00.000Z',
            expirySlot: '34688',
            expiryAt: '2026-07-28T22:45:36.000Z',
            isExecutionPaused: false,
            pauseEndsAtSlot: null,
            pauseEndsAt: null,
            blockNumber: '24500000',
            blockHash: BLOCK_HASH,
            firstObservedAt: AT,
            observedAt: AT,
        }],
        slashes: {
            confirmed: [{
                id: 'slash-1',
                address: VALIDATOR,
                actualAmount: '3500000000000000000000',
                logCount: 2,
                logIndexes: [10, 11],
                canonical: true,
                chainId: 1,
                rollupAddress: ROLLUP,
                blockNumber: '24499999',
                blockHash: BLOCK_HASH,
                transactionHash: TX_HASH,
                firstObservedAt: AT,
                observedAt: AT,
            }],
            removed: [],
        },
    };
}

function disconnectedChannels() {
    const state = { connected: false, enabled: false, verified: false };
    return { webPush: state, telegram: state };
}
