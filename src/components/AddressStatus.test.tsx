import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SlashingCase } from '../../shared/protocol/index.ts';
import { AddressStatus, summarizeSequencer } from './AddressStatus';

describe('AddressStatus', () => {
    it('summarizes known stake and pending amounts without inferring missing values', () => {
        const pending = item('pending', true, '2000000000000000000000', null);
        const completed = item('completed', false, null, '500000000000000000000');

        expect(summarizeSequencer(
            [pending, completed],
            '197500000000000000000000',
        )).toEqual({
            activeCases: 1,
            pendingAmount: '2000000000000000000000',
            removedAmount: '500000000000000000000',
            currentStake: '197500000000000000000000',
        });
        expect(summarizeSequencer([pending], null).currentStake).toBeNull();
    });

    it('collapses timelines until a linked case is selected', () => {
        const entry = item('selected', true, null, null);
        const common = {
            address: entry.sequencer,
            network: 'mainnet' as const,
            cases: [entry],
            currentStake: null,
            currentStakeLoading: false,
            protocol: null,
            onOpenProtocolGuide: () => undefined,
        };
        const collapsed = renderToStaticMarkup(
            <AddressStatus {...common} selectedCaseId={null} />,
        );
        const expanded = renderToStaticMarkup(
            <AddressStatus {...common} selectedCaseId={entry.id} />,
        );

        expect(collapsed).toContain('Case timelines');
        expect(collapsed).toContain(`https://dashtec.xyz/sequencers/${entry.sequencer}`);
        expect(collapsed).not.toContain('<details open');
        expect(expanded).toContain('<details open');
    });
});

function item(
    id: string,
    active: boolean,
    requestedAmount: string | null,
    actualAmount: string | null,
): SlashingCase {
    return {
        id,
        network: 'mainnet',
        sequencer: '0x1111111111111111111111111111111111111111',
        lineageId: '0x2222222222222222222222222222222222222222',
        targetEpoch: '42',
        firstObservedAt: '2026-07-29T00:00:00.000Z',
        lastObservedAt: '2026-07-29T00:00:00.000Z',
        observations: [],
        state: {
            stage: active ? 'candidate' : 'stake_removed',
            urgency: active ? 'critical' : 'normal',
            headline: id,
            explanation: id,
            reason: {
                label: 'Reason unknown on L1',
                provenance: 'unknown_on_l1',
                evidenceIds: [],
            },
            nextTransition: null,
            requestedAmount,
            actualAmount,
            payloadAddress: null,
            round: '12',
            active,
        },
    };
}
