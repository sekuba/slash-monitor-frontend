import { describe, expect, it } from 'vitest';
import { describeMonitorEvent } from './eventDescription';
import { getEventTitle } from './presentation';
import type { MonitorEvent } from '@/types/backendApi';

const sequencer = '0x1111111111111111111111111111111111111111';
const previousPayload = '0x2222222222222222222222222222222222222222';
const currentPayload = '0x3333333333333333333333333333333333333333';
const amount = '2000000000000000000000';

describe('payload-change event copy', () => {
    it('normalizes legacy events without repeating an unproven veto warning', () => {
        const event = payloadChangeEvent();
        event.body = 'The payload changed; prior veto state does not carry over.';

        const description = describeMonitorEvent(event);

        expect(description).toContain('The slash payload changed in active round 257');
        expect(description).toContain('Proposed slash: 2,000 AZTEC');
        expect(description.toLowerCase()).not.toContain('veto');
    });

    it('names a concrete action delta and mentions a prior veto only when recorded', () => {
        const event = payloadChangeEvent();
        event.l1!.actionChanges = [{
            sequencer,
            kind: 'added',
            previousAmount: null,
            currentAmount: amount,
        }];

        expect(getEventTitle(event)).toBe('Sequencer added to slash payload');
        expect(describeMonitorEvent(event)).toBe(
            'This sequencer was added to the slash payload in active round 257 for target epochs ' +
            '1020–1023. Proposed slash: 2,000 AZTEC.',
        );

        event.l1!.previousPayloadAddress = previousPayload;
        event.l1!.previousPayloadWasVetoed = true;

        expect(describeMonitorEvent(event)).toContain(
            'The previous payload was vetoed; the new payload is not.',
        );
    });
});

function payloadChangeEvent(): MonitorEvent {
    return {
        id: 'payload-change',
        network: 'mainnet',
        type: 'onchain_payload_changed',
        source: 'ethereum_l1',
        certainty: 'confirmed',
        sequencer,
        targets: [sequencer],
        title: 'Slashing payload changed',
        body: 'Legacy body.',
        offense: null,
        nodeEvidence: [],
        l1: {
            chainId: 1,
            role: 'active',
            round: '257',
            status: 'quorum-reached',
            targetEpochs: ['1020', '1021', '1022', '1023'],
            currentSlot: '32963',
            currentEpoch: '1030',
            executableSlot: '36608',
            executableAt: '2026-07-30T19:18:23.000Z',
            expirySlot: '37376',
            expiryAt: '2026-07-31T10:39:59.000Z',
            blockNumber: '25625920',
            blockHash: `0x${'12'.repeat(32)}`,
            transactionHash: null,
            payloadAddress: currentPayload,
            amount: null,
            isVetoed: false,
            isExecuted: false,
            isSlashingEnabled: true,
            isExecutionPaused: false,
            isProtected: false,
            pauseStartedAtSlot: null,
            pauseEndsAtSlot: null,
            actions: [{ sequencer, amount }],
        },
        occurredAt: '2026-07-27T18:25:14.149Z',
    };
}
