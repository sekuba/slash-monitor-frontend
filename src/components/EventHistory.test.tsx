import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventHistory, formatJournalTime } from './EventHistory';
import type { MonitorEvent } from '@/types/backendApi';

const targets = [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
    '0x4444444444444444444444444444444444444444',
] as const;

describe('Pingme journal cards', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('shows every L1 target on demand with round timing and explorer links', () => {
        vi.stubGlobal('window', { location: new URL('https://slashmon.example/?view=pingme') });
        const event: MonitorEvent = {
            id: 'event-1',
            network: 'mainnet',
            type: 'onchain_targeted',
            source: 'ethereum_l1',
            certainty: 'confirmed',
            sequencer: targets[0],
            targets: [...targets],
            title: 'Slashing payload proposed',
            body: '4 sequencers entered the payload.',
            offense: null,
            l1: {
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
                actions: targets.map((sequencer) => ({ sequencer, amount: '2000000000000000000000' })),
            },
            occurredAt: '2026-07-22T10:54:22.647Z',
        };

        const markup = renderToStaticMarkup(
            <EventHistory events={[event]} hasWatchlistCapability={false} />,
        );

        expect(markup).toContain('L1 · confirmed');
        expect(markup).toContain('Show all 4 targets');
        for (const target of targets) expect(markup).toContain(`Open ${target} on Dashtec`);
        expect(markup).toContain('Reason: not encoded on L1');
        expect(markup).toContain('Active round 195');
        expect(markup).toContain('Target epochs 772–773');
        expect(markup).toContain('Execution window: slot 28672');
        expect(markup).toContain('2,000 AZTEC proposed');
        expect(markup).toContain(`https://etherscan.io/tx/0x${'34'.repeat(32)}`);
        expect(markup).toContain('https://etherscan.io/block/25587802');
    });

    it('does not repeat a pending event type in the card footer', () => {
        vi.stubGlobal('window', { location: new URL('https://slashmon.example/?view=pingme') });
        const event: MonitorEvent = {
            id: 'event-2',
            network: 'mainnet',
            type: 'pending_offense_detected',
            source: 'aztec_node',
            certainty: 'pending',
            sequencer: targets[0],
            targets: [targets[0]],
            title: 'Inactivity offense detected',
            body: 'Node-local signal.',
            offense: {
                type: 3,
                reason: 'inactivity',
                epochOrSlot: '834',
                timeUnit: 'epoch',
                amount: '2000000000000000000000',
                epoch: '834',
                slot: '26688',
                offenseRound: '208',
                proposalRound: '210',
            },
            l1: null,
            occurredAt: '2026-07-22T13:34:33.502Z',
        };

        const markup = renderToStaticMarkup(
            <EventHistory events={[event]} hasWatchlistCapability={false} />,
        );

        expect(markup).toContain('Node · pending');
        expect(markup).toContain('Expected vote round 210');
        expect(markup).not.toContain('Pending Offense Detected');
        expect(markup).not.toContain('aztec_node');
    });

    it('falls back to an explicit UTC timestamp when local formatting is unavailable', () => {
        vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(() => {
            throw new RangeError('locale unavailable');
        });

        expect(formatJournalTime('2026-07-22T10:54:22.647Z'))
            .toBe('2026-07-22T10:54:22.647Z (UTC)');
    });
});
