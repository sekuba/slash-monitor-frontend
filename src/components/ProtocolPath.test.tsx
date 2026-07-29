import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Observation, SlashingCase } from '../../shared/protocol/index.ts';
import { ProtocolPath } from './ProtocolPath';

describe('ProtocolPath', () => {
    it('does not invent completed local stages for an L1-only case', () => {
        const markup = renderToStaticMarkup(
            <ProtocolPath
                item={item('l1_support', [round({ support: 4 })])}
                onOpenGuide={() => undefined}
            />,
        );

        expect(markup).toMatch(/text-whisper-white\/45[^>]*><span[^>]*>1<\/span>Duty issue/);
        expect(markup).toMatch(/aria-current="step"[^>]*><span[^>]*>3<\/span>L1 support/);
    });

    it('shows an expired candidate as a stopped path, not a live candidate step', () => {
        const markup = renderToStaticMarkup(
            <ProtocolPath
                item={item('expired', [round({
                    amount: '2000000000000000000000',
                    stable: true,
                    status: 'expired',
                })])}
                onOpenGuide={() => undefined}
            />,
        );

        expect(markup).not.toContain('aria-current="step"');
        expect(markup).toMatch(/text-chartreuse[^>]*><span[^>]*>✓<\/span>Candidate/);
    });
});

function item(
    stage: SlashingCase['state']['stage'],
    observations: Observation[],
): SlashingCase {
    return {
        id: `case:${stage}`,
        network: 'mainnet',
        sequencer: '0x1111111111111111111111111111111111111111',
        lineageId: '0x2222222222222222222222222222222222222222',
        targetEpoch: '42',
        firstObservedAt: '2026-07-29T00:00:00.000Z',
        lastObservedAt: '2026-07-29T00:00:00.000Z',
        observations,
        state: {
            stage,
            urgency: 'warning',
            headline: stage,
            explanation: stage,
            reason: {
                label: 'Reason unknown on L1',
                provenance: 'unknown_on_l1',
                evidenceIds: [],
            },
            nextTransition: null,
            requestedAmount: null,
            actualAmount: null,
            payloadAddress: null,
            round: '12',
            active: stage !== 'expired',
        },
    };
}

function round(data: Record<string, unknown>): Observation {
    return {
        id: 'round',
        network: 'mainnet',
        source: 'ethereum_l1',
        kind: 'l1_round',
        sequencer: '0x1111111111111111111111111111111111111111',
        lineageId: '0x2222222222222222222222222222222222222222',
        targetEpoch: '42',
        provenance: {
            observedAt: '2026-07-29T00:00:00.000Z',
            canonical: true,
        },
        data,
    };
}
