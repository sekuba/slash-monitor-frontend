import { describe, expect, it } from 'vitest';
import type { SlashingCase } from '../../shared/protocol/index.ts';
import { selectCaseFeed } from './caseFeed';

describe('selectCaseFeed', () => {
    it('keeps every active case and only the latest execution outcomes', () => {
        const executedWithoutDeduction = item(
            'executed-no-deduction',
            'resolved',
            false,
            '2026-07-08T00:00:00.000Z',
        );
        executedWithoutDeduction.observations = [{
            id: 'execution',
            network: 'mainnet',
            source: 'ethereum_l1',
            kind: 'l1_round',
            sequencer: executedWithoutDeduction.sequencer,
            lineageId: executedWithoutDeduction.lineageId,
            targetEpoch: executedWithoutDeduction.targetEpoch,
            provenance: {
                observedAt: '2026-07-08T00:00:00.000Z',
                canonical: true,
            },
            data: { isExecuted: true, status: 'executed' },
        }];
        const cases = [
            item('active-old', 'candidate', true, '2026-07-01T00:00:00.000Z'),
            item('expired', 'expired', false, '2026-07-10T00:00:00.000Z'),
            item('executed-old', 'executed', false, '2026-07-02T00:00:00.000Z'),
            item('slashed-new', 'stake_removed', false, '2026-07-09T00:00:00.000Z'),
            item('resolved', 'resolved', false, '2026-07-11T00:00:00.000Z'),
            item('precursor-new', 'precursor', true, '2026-07-12T00:00:00.000Z'),
            executedWithoutDeduction,
        ];

        const result = selectCaseFeed(cases, 2);

        expect(result.active.map((entry) => entry.id)).toEqual([
            'precursor-new',
            'active-old',
        ]);
        expect(result.recentlyExecuted.map((entry) => entry.id)).toEqual([
            'slashed-new',
            'executed-no-deduction',
        ]);
    });
});

function item(
    id: string,
    stage: SlashingCase['state']['stage'],
    active: boolean,
    lastObservedAt: string,
): SlashingCase {
    return {
        id,
        network: 'mainnet',
        sequencer: '0x1111111111111111111111111111111111111111',
        lineageId: '0x2222222222222222222222222222222222222222',
        targetEpoch: '1',
        firstObservedAt: lastObservedAt,
        lastObservedAt,
        observations: [],
        state: {
            stage,
            active,
            urgency: 'info',
            headline: id,
            explanation: id,
            reason: {
                label: 'Reason unknown on L1',
                provenance: 'unknown_on_l1',
                evidenceIds: [],
            },
            nextTransition: null,
            requestedAmount: null,
            actualAmount: null,
            payloadAddress: null,
            round: null,
        },
    };
}
