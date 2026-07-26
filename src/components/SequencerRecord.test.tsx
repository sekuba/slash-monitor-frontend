import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SlashingProcess } from './SlashingProcess';
import { recordEventSummary } from './SequencerRecord';
import type { MonitorEvent } from '@/types/backendApi';

const address = '0x1111111111111111111111111111111111111111';

describe('sequencer record presentation', () => {
    it('draws the exact protocol path and explains that a pause does not extend expiry', () => {
        const markup = renderToStaticMarkup(
            <SlashingProcess
                timing={{
                    slashOffsetRounds: 2,
                    roundSizeSlots: 128,
                    roundSizeEpochs: 4,
                    quorum: 65,
                    roundDurationSeconds: 9_216,
                    executionDelayRounds: 28,
                    executionDelaySeconds: 258_048,
                    executionWindowRounds: 6,
                    executionWindowSeconds: 55_296,
                    inactivity: { targetPercentage: 0.8, consecutiveEpochs: 2 },
                }}
                pause={{
                    active: true,
                    endsAt: '2026-07-26T08:00:00.000Z',
                    durationSeconds: 259_200,
                }}
            />,
        );

        expect(markup).toContain('Node records an offense locally');
        expect(markup).toContain('Inactivity: ≥80% missed duties for 2 consecutive epochs');
        expect(markup).toContain('Sequencers vote on slashing');
        expect(markup).toContain('65 matching ballots per target');
        expect(markup).toContain('2 rounds · 8 epochs');
        expect(markup).toContain('5h 7m 12s');
        expect(markup).toContain('28 rounds · 112 epochs');
        expect(markup).toContain('2d 23h 40m 48s');
        expect(markup).toContain('Payload can be executed');
        expect(markup).toContain('6 rounds · 24 epochs');
        expect(markup).toContain('15h 21m 36s');
        expect(markup).toContain('Payload expires');
        expect(markup).toContain('Execution is blocked; expiry is unchanged.');
        expect(markup).toContain('Fixed pause: 3d 0h 0m.');
        expect(markup).not.toContain('Target offset is anchored');
        expect(markup).not.toContain('Executed during the window');
        expect(markup).not.toContain('Vetoed →');
    });

    it('keeps node evidence, paused execution, and a confirmed slash distinct', () => {
        expect(recordEventSummary(event({
            type: 'pending_offense_detected',
            source: 'aztec_node',
            certainty: 'pending',
            offense: {
                type: 3,
                reason: 'inactivity',
                epochOrSlot: '972',
                timeUnit: 'epoch',
                amount: '2000000000000000000000',
                epoch: '972',
                slot: '31104',
                offenseRound: '243',
                proposalRound: '245',
            },
        }))).toContain('No L1 action yet');

        expect(recordEventSummary(event({
            type: 'onchain_executable_after_pause',
            source: 'ethereum_l1',
            certainty: 'confirmed',
            l1: {
                chainId: 1,
                role: 'active',
                round: '214',
                status: 'newly-executable',
                targetEpochs: [],
                currentSlot: '31104',
                currentEpoch: '972',
                executableSlot: '31104',
                executableAt: null,
                expirySlot: '31872',
                expiryAt: '2026-07-26T20:35:11.000Z',
                blockNumber: null,
                blockHash: null,
                transactionHash: null,
                payloadAddress: null,
                amount: null,
                isVetoed: false,
                isExecuted: false,
                isSlashingEnabled: false,
                isExecutionPaused: true,
                isProtected: false,
                pauseStartedAtSlot: '27691',
                pauseEndsAtSlot: '31291',
                actions: [],
            },
        }))).toContain('expiry is unchanged');

        expect(recordEventSummary(event({
            type: 'l1_slash_confirmed',
            source: 'ethereum_l1',
            certainty: 'confirmed',
            l1: {
                chainId: 1,
                role: null,
                round: null,
                status: null,
                targetEpochs: [],
                currentSlot: null,
                currentEpoch: null,
                executableSlot: null,
                executableAt: null,
                expirySlot: null,
                expiryAt: null,
                blockNumber: '1',
                blockHash: null,
                transactionHash: null,
                payloadAddress: null,
                amount: '2000000000000000000000',
                isVetoed: null,
                isExecuted: null,
                isSlashingEnabled: null,
                isExecutionPaused: null,
                isProtected: null,
                pauseStartedAtSlot: null,
                pauseEndsAtSlot: null,
                actions: [],
            },
        }))).toBe('2,000 AZTEC removed in a confirmed L1 block.');
    });
});

function event(overrides: Partial<MonitorEvent>): MonitorEvent {
    return {
        id: 'event-1',
        network: 'mainnet',
        type: 'inactivity_first_miss',
        source: 'aztec_sentinel',
        certainty: 'pending',
        sequencer: address,
        targets: [address],
        title: 'Event',
        body: '',
        offense: null,
        nodeEvidence: [],
        l1: null,
        occurredAt: '2026-07-26T07:00:00.000Z',
        ...overrides,
    };
}
