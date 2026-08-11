import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SlashingCase } from '@shared/protocol/index.ts';
import { WatchlistSection } from './WatchlistSection';

describe('WatchlistSection', () => {
    it('stays expanded by default and summarizes the watched cases', () => {
        const markup = renderToStaticMarkup(
            <WatchlistSection
                cases={[
                    item('active', true, '2000000000000000000000', null, 'critical'),
                    item('done', false, null, '500000000000000000000', 'normal'),
                ]}
                sequencerCount={2}
                forceOpen={false}
            >
                <p>cards</p>
            </WatchlistSection>,
        );

        expect(markup).toContain('<details open');
        expect(markup).toContain('2 sequencers watched');
        expect(markup).toContain('1 open case');
        expect(markup).toContain('2,000 AZTEC requested');
        expect(markup).toContain('500 AZTEC removed');
        expect(markup).toContain('border-chartreuse');
        expect(markup).toContain('bg-vermillion');
        expect(markup).toContain('cards');
    });

    it('signals all clear when no watched case is active', () => {
        const markup = renderToStaticMarkup(
            <WatchlistSection
                cases={[item('done', false, null, null, 'normal')]}
                sequencerCount={1}
                forceOpen={false}
            >
                <p>cards</p>
            </WatchlistSection>,
        );

        expect(markup).toContain('1 sequencer watched');
        expect(markup).toContain('All clear');
        expect(markup).toContain('border-chartreuse');
        expect(markup).not.toContain('bg-vermillion');
    });
});

function item(
    id: string,
    active: boolean,
    requestedAmount: string | null,
    actualAmount: string | null,
    urgency: SlashingCase['state']['urgency'],
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
            urgency,
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
