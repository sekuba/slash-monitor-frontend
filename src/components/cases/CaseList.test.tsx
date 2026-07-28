import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSlashingCase, type BuildSlashingCaseInput } from '@/domain/slashingCase';
import { CaseList } from './CaseList';

const VALIDATOR = '0x1111111111111111111111111111111111111111';
const TWO_THOUSAND_AZTEC = 2_000_000_000_000_000_000_000n;

describe('shared slashing case presentation', () => {
    it('shows direct proposed totals and keeps confirmed loss out of round cases', () => {
        const ready = buildSlashingCase(input({
            id: 'ready',
            currentRound: 129,
            currentSlot: 16_512,
            proposedActions: [
                { validator: VALIDATOR, amount: TWO_THOUSAND_AZTEC },
                { validator: VALIDATOR, amount: TWO_THOUSAND_AZTEC },
            ],
        }));
        const vetoed = buildSlashingCase(input({
            id: 'vetoed',
            currentRound: 101,
            currentSlot: 12_928,
            exactPayloadVetoed: true,
        }));

        const markup = renderToStaticMarkup(
            <CaseList cases={[ready, vetoed]} title="Current slashing state" />,
        );

        expect(markup).toContain('Current slashing state');
        expect(markup).toContain('Open cases');
        expect(markup).toContain('Closed cases');
        expect(markup).toContain('Ready to execute');
        expect(markup).toContain('Exact slash payload vetoed');
        expect(markup).toContain(VALIDATOR);
        expect(markup).toContain('4,000 AZTEC');
        expect(markup).toContain('2 tally actions');
        expect(markup).not.toContain('Confirmed removed');
        expect(markup).toContain('<details');
        expect(markup).toContain('Case evidence');
        expect(markup).toContain('applies to this exact final payload');
    });

    it('uses a source-bounded empty state instead of claiming no slash exists', () => {
        const markup = renderToStaticMarkup(<CaseList cases={[]} />);

        expect(markup).toContain('No slashing cases were provided by this source snapshot.');
        expect(markup).not.toContain('No active slashing');
        expect(markup).not.toContain('safe');
    });
});

function input(
    overrides: Partial<BuildSlashingCaseInput> = {},
): BuildSlashingCaseInput {
    return {
        id: 'case-100',
        network: 'mainnet',
        round: 100,
        currentRound: 100,
        currentSlot: 12_800,
        timing: {
            roundSizeSlots: 128,
            executionDelayRounds: 28,
            lifetimeRounds: 34,
        },
        targetEpochs: [392, 393, 394, 395],
        stack: {
            role: 'active',
            slasherAddress: '0x3333333333333333333333333333333333333333',
            authorized: true,
        },
        payloadAddress: '0x2222222222222222222222222222222222222222',
        exactPayloadVetoed: false,
        roundExecuted: false,
        slashingEnabled: true,
        ballotCount: 65,
        quorumPerTarget: 65,
        reachedQuorum: true,
        proposedActions: [{ validator: VALIDATOR, amount: TWO_THOUSAND_AZTEC }],
        executableAt: '2026-07-31T08:06:23.000Z',
        expiresAt: '2026-07-31T23:27:59.000Z',
        pauseEndsAt: null,
        observation: {
            source: 'independent-l1',
            observedAt: '2026-07-28T06:33:57.456Z',
            blockNumber: 25_629_342,
        },
        ...overrides,
    };
}
