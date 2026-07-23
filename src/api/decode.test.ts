import { describe, expect, it } from 'vitest';
import {
    ApiContractError,
    decodeCreatedSubscription,
    decodeEventDetail,
    decodeEventPage,
    decodePublicConfig,
    decodeStatus,
    decodeSubscription,
    decodeTelegramLink,
} from './decode';

const address = '0x00000000000000000000000000000000000000aa';

describe('Slashmon API decoders', () => {
    it('decodes public channel configuration without accepting secrets', () => {
        expect(decodePublicConfig({
            schemaVersion: 2,
            network: 'mainnet',
            vapidPublicKey: 'vapid-public',
            telegramBotUsername: 'slashmon_bot',
            maxSequencers: 25,
        })).toEqual({
            network: 'mainnet',
            webPush: { enabled: true, publicKey: 'vapid-public' },
            telegram: { enabled: true, botUsername: 'slashmon_bot' },
            limits: { maxSequencers: 25 },
        });
    });

    it('decodes the compact backend health summary', () => {
        const source = {
            status: 'healthy',
            dataFresh: true,
            dataAgeMs: 100,
            lastAttemptAt: '2026-07-21T10:00:00.000Z',
            lastSuccessAt: '2026-07-21T10:00:00.000Z',
            lastError: null,
        };
        const status = decodeStatus({
            schemaVersion: 2,
            network: 'mainnet',
            status: 'healthy',
            generatedAt: '2026-07-21T10:00:01.000Z',
            sources: { l1: source, aztec: source },
            delivery: { status: 'degraded' },
        }, 'mainnet');

        expect(status.sources.l1.status).toBe('healthy');
        expect(status.delivery).toEqual({ status: 'degraded' });
    });

    it('decodes a journal page and infers pending certainty from its source', () => {
        const page = decodeEventPage({
            schemaVersion: 2,
            data: [{
                id: 'event-1',
                network: 'mainnet',
                type: 'pending_offense_detected',
                source: 'aztec_node',
                certainty: 'pending',
                sequencer: address,
                targets: [address],
                title: 'Pending offense',
                body: 'Observed locally',
                data: {
                    offenseType: 3,
                    offenseTypeName: 'inactivity',
                    epochOrSlot: '42',
                    timeUnit: 'epoch',
                    amount: '2000000000000000000000',
                    epoch: '42',
                    slot: '1344',
                    offenseRound: '10',
                    proposalRound: '12',
                },
                occurredAt: '2026-07-21T10:00:00.000Z',
            }],
            pagination: { nextCursor: 'cursor-2' },
        }, 'mainnet');

        expect(page.data[0].certainty).toBe('pending');
        expect(page.data[0].offense).toEqual({
            type: 3,
            reason: 'inactivity',
            epochOrSlot: '42',
            timeUnit: 'epoch',
            amount: '2000000000000000000000',
            epoch: '42',
            slot: '1344',
            offenseRound: '10',
            proposalRound: '12',
        });
        expect(page.nextCursor).toBe('cursor-2');
    });

    it('decodes a directly linked journal event', () => {
        const event = decodeEventDetail({
            schemaVersion: 2,
            data: {
                id: 'event-1',
                network: 'mainnet',
                type: 'onchain_executable',
                source: 'ethereum_l1',
                certainty: 'confirmed',
                sequencer: address,
                targets: [address],
                title: 'Slashing is executable',
                body: 'A watched sequencer is in the payload.',
                data: {
                    chainId: 1,
                    role: 'active',
                    round: '195',
                    targetEpochs: ['772', '773'],
                    currentSlot: '25000',
                    currentEpoch: '781',
                    executableSlot: '28672',
                    executableAt: '2026-07-23T10:00:00.000Z',
                    expirySlot: '29440',
                    expiryAt: '2026-07-23T16:24:00.000Z',
                    blockNumber: '25587802',
                    blockHash: `0x${'12'.repeat(32)}`,
                    transactionHash: `0x${'34'.repeat(32)}`,
                    payloadAddress: '0x00000000000000000000000000000000000000bb',
                    actions: [{ sequencer: address, amount: '2000000000000000000000' }],
                    nodeEvidence: [{
                        kind: 'slash_offense',
                        sequencer: address,
                        epoch: '772',
                        offenseId: 'offense-1',
                        offenseType: 3,
                        offenseTypeName: 'inactivity',
                        epochOrSlot: '772',
                        timeUnit: 'epoch',
                        amount: '2000000000000000000000',
                        firstSeenAt: '2026-07-21T09:00:00.000Z',
                    }],
                },
                occurredAt: '2026-07-21T10:00:00.000Z',
            },
        }, 'mainnet');

        expect(event.id).toBe('event-1');
        expect(event.certainty).toBe('confirmed');
        expect(event.targets).toEqual([address]);
        expect(event.offense).toBeNull();
        expect(event.nodeEvidence).toEqual([{
            kind: 'slash_offense',
            sequencer: address,
            epoch: '772',
            offenseId: 'offense-1',
            offenseType: 3,
            offenseTypeName: 'inactivity',
            epochOrSlot: '772',
            timeUnit: 'epoch',
            amount: '2000000000000000000000',
            firstSeenAt: '2026-07-21T09:00:00.000Z',
            missed: null,
            total: null,
            firstMissedSlot: null,
            lastMissedSlot: null,
            inactiveStreak: null,
            slashableThreshold: null,
            targetPercentage: null,
        }]);
        expect(event.l1).toEqual({
            chainId: 1,
            role: 'active',
            round: '195',
            targetEpochs: ['772', '773'],
            currentSlot: '25000',
            currentEpoch: '781',
            executableSlot: '28672',
            executableAt: '2026-07-23T10:00:00.000Z',
            expirySlot: '29440',
            expiryAt: '2026-07-23T16:24:00.000Z',
            blockNumber: '25587802',
            blockHash: `0x${'12'.repeat(32)}`,
            transactionHash: `0x${'34'.repeat(32)}`,
            payloadAddress: '0x00000000000000000000000000000000000000bb',
            amount: null,
            actions: [{ sequencer: address, amount: '2000000000000000000000' }],
        });
    });

    it('requires the one-time management token on creation', () => {
        expect(() => decodeCreatedSubscription({
            schemaVersion: 2,
            data: {
                id: 'sub-1',
                network: 'mainnet',
                addresses: [address],
                channels: {
                    webPush: { connected: false, enabled: false, verified: false },
                    telegram: { connected: false, enabled: false, verified: false },
                },
            },
        })).toThrow(ApiContractError);
    });

    it('preserves connected-but-disabled channels that need reconnection', () => {
        const subscription = decodeSubscription({
            schemaVersion: 2,
            data: {
                id: 'sub-1',
                network: 'mainnet',
                addresses: [address],
                channels: {
                    webPush: { connected: true, enabled: false, verified: false },
                    telegram: { connected: false, enabled: false, verified: false },
                },
            },
        });

        expect(subscription.channels.webPush).toEqual({
            connected: true,
            enabled: false,
            verified: false,
        });
    });

    it('accepts only official HTTPS Telegram deep links', () => {
        expect(decodeTelegramLink({
            schemaVersion: 2,
            url: 'https://t.me/slashmon_bot?start=opaque',
            expiresAt: null,
        }).url)
            .toContain('https://t.me/');
        expect(() => decodeTelegramLink({
            schemaVersion: 2,
            url: 'https://evil.example/start',
            expiresAt: null,
        }))
            .toThrow(ApiContractError);
    });
});
