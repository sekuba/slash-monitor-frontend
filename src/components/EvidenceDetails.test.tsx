import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Observation, SlashingCase } from '../../shared/protocol/index.ts';
import { EvidenceDetails } from './EvidenceDetails';

const SEQUENCER = '0x1111111111111111111111111111111111111111';
const LINEAGE = '0x2222222222222222222222222222222222222222';
const PAYLOAD = '0x3333333333333333333333333333333333333333';
const TRANSACTION = `0x${'44'.repeat(32)}`;

describe('EvidenceDetails', () => {
    it('combines an exact historical round and slash into one execution card', () => {
        const markup = renderToStaticMarkup(
            <EvidenceDetails
                item={item([
                    observation('l1_round', {
                        historicalExecution: true,
                        actionIndex: 1,
                        support: 125,
                        quorum: 65,
                        amount: '2000000000000000000000',
                        payloadAddress: PAYLOAD,
                    }),
                    observation('l1_slash', {
                        actionIndex: 1,
                        amount: '1500000000000000000000',
                    }),
                ])}
                protocol={null}
            />,
        );

        expect(markup).toContain('Evidence &amp; protocol details (1)');
        expect(markup).toContain('Ethereum L1 · executed slash');
        expect(markup).not.toContain('Ethereum L1 · l1 round');
        expect(markup).not.toContain('Ethereum L1 · l1 slash');
        expect(markup).toContain('L1 support:');
        expect(markup).toContain('125 / 65');
        expect(markup).toContain('Requested:');
        expect(markup).toContain('2,000 AZTEC');
        expect(markup).toContain('Actual:');
        expect(markup).toContain('1,500 AZTEC');
        expect(markup).toContain(PAYLOAD);
    });

    it('keeps a live round and slash as separate evidence', () => {
        const markup = renderToStaticMarkup(
            <EvidenceDetails
                item={item([
                    observation('l1_round', {
                        actionIndex: 1,
                        amount: '2000000000000000000000',
                    }),
                    observation('l1_slash', {
                        actionIndex: 1,
                        amount: '2000000000000000000000',
                    }),
                ])}
                protocol={null}
            />,
        );

        expect(markup).toContain('Evidence &amp; protocol details (2)');
        expect(markup).toContain('Ethereum L1 · l1 round');
        expect(markup).toContain('Ethereum L1 · l1 slash');
        expect(markup).not.toContain('Ethereum L1 · executed slash');
    });
});

function item(observations: Observation[]): SlashingCase {
    return {
        id: `case:mainnet:${LINEAGE}:${SEQUENCER}:941`,
        network: 'mainnet',
        sequencer: SEQUENCER,
        lineageId: LINEAGE,
        targetEpoch: '941',
        firstObservedAt: '2026-07-29T19:05:05.474Z',
        lastObservedAt: '2026-07-29T19:05:05.474Z',
        observations,
        state: {
            stage: 'stake_removed',
            urgency: 'critical',
            headline: 'Stake removed',
            explanation: 'A canonical Rollup Slashed log confirms the actual deduction.',
            reason: {
                label: 'Reason unknown on L1',
                provenance: 'unknown_on_l1',
                evidenceIds: [],
            },
            nextTransition: null,
            requestedAmount: null,
            actualAmount: '2000000000000000000000',
            payloadAddress: null,
            round: '237',
            active: false,
        },
    };
}

function observation(
    kind: 'l1_round' | 'l1_slash',
    data: Record<string, unknown>,
): Observation {
    return {
        id: kind,
        network: 'mainnet',
        source: 'ethereum_l1',
        kind,
        sequencer: SEQUENCER,
        lineageId: LINEAGE,
        targetEpoch: '941',
        round: '237',
        provenance: {
            observedAt: '2026-07-29T19:05:05.474Z',
            blockNumber: '25632405',
            blockHash: `0x${'55'.repeat(32)}`,
            transactionHash: TRANSACTION,
            canonical: true,
        },
        data,
    };
}
