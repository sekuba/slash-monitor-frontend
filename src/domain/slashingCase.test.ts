import { describe, expect, it } from 'vitest';
import {
    aggregateValidatorActions,
    buildSlashingCase,
    categorizeCases,
    deriveCaseState,
    type BuildSlashingCaseInput,
    type CaseLifecycleInput,
} from './slashingCase';

const VALIDATOR = '0x1111111111111111111111111111111111111111';
const PAYLOAD = '0x2222222222222222222222222222222222222222';
const SLASHER = '0x3333333333333333333333333333333333333333';
const TWO_THOUSAND_AZTEC = 2_000_000_000_000_000_000_000n;

const timing = {
    roundSizeSlots: 128,
    executionDelayRounds: 28,
    lifetimeRounds: 34,
};

describe('source-neutral slashing cases', () => {
    it('sums duplicate actions for one validator instead of overwriting them', () => {
        const proposals = aggregateValidatorActions([
            { validator: VALIDATOR, amount: TWO_THOUSAND_AZTEC },
            {
                validator: `0x${VALIDATOR.slice(2).toUpperCase()}`,
                amount: TWO_THOUSAND_AZTEC,
            },
        ]);

        expect(proposals).toEqual([{
            validator: '0x1111111111111111111111111111111111111111',
            proposedAmount: 4_000_000_000_000_000_000_000n,
            actionCount: 2,
        }]);

        const slashingCase = buildSlashingCase(caseInput({
            proposedActions: [
                { validator: VALIDATOR, amount: TWO_THOUSAND_AZTEC },
                { validator: VALIDATOR, amount: TWO_THOUSAND_AZTEC },
            ],
        }));
        expect(slashingCase.targets[0]).toMatchObject({
            proposedAmount: 4_000_000_000_000_000_000_000n,
            proposedActionCount: 2,
        });
        expect(slashingCase.proposedTotalAmount)
            .toBe(4_000_000_000_000_000_000_000n);
    });

    it('keeps reached quorum provisional while voting remains open', () => {
        const slashingCase = buildSlashingCase(caseInput({
            currentRound: 100,
            currentSlot: 12_850,
            reachedQuorum: true,
        }));

        expect(slashingCase.state).toEqual({ kind: 'phase', phase: 'voting' });
        expect(slashingCase.provisionalQuorum).toBe(true);
        expect(slashingCase.payload?.final).toBe(false);
    });

    it('enters review only after voting closes and before execution opens', () => {
        expect(state({
            currentRound: 101,
            currentSlot: 12_928,
        })).toEqual({ kind: 'phase', phase: 'review' });
    });

    it('reports an open execution window as paused when global slashing is disabled', () => {
        expect(state({
            currentRound: 129,
            currentSlot: 16_512,
            slashingEnabled: false,
        })).toEqual({ kind: 'phase', phase: 'paused' });
    });

    it('does not make a provisional exact-payload veto terminal until voting closes', () => {
        expect(state({
            currentRound: 100,
            currentSlot: 12_850,
            exactPayloadVetoed: true,
        })).toEqual({ kind: 'phase', phase: 'voting' });

        expect(state({
            currentRound: 101,
            currentSlot: 12_928,
            exactPayloadVetoed: true,
        })).toEqual({ kind: 'terminal', terminal: 'vetoed' });
    });

    it('closes a finished voting round with no proposed actions as no consensus', () => {
        expect(state({
            currentRound: 101n,
            currentSlot: 12_928n,
            hasProposedActions: false,
            payloadAddress: null,
        })).toEqual({ kind: 'terminal', terminal: 'no-consensus' });
    });

    it('marks an authorized, enabled payload in its execution window ready', () => {
        expect(state({
            currentRound: 129,
            currentSlot: 16_512,
        })).toEqual({ kind: 'phase', phase: 'ready' });
    });

    it('expires an unexecuted payload at the exact expiry boundary', () => {
        expect(state({
            currentRound: 135,
            currentSlot: 17_280,
        })).toEqual({ kind: 'terminal', terminal: 'expired' });
    });

    it('closes a final case when its immutable slasher stack is retired', () => {
        expect(state({
            currentRound: 101,
            currentSlot: 12_928,
            slasherAuthorized: false,
        })).toEqual({ kind: 'terminal', terminal: 'stack-retired' });
    });

    it('marks an executed round terminal without inferring token loss', () => {
        expect(state({
            roundExecuted: true,
        })).toEqual({ kind: 'terminal', terminal: 'executed' });
    });

    it('categorizes phases as open and terminal cases as closed', () => {
        const review = buildSlashingCase(caseInput({
            id: 'review',
            currentRound: 101,
            currentSlot: 12_928,
        }));
        const vetoed = buildSlashingCase(caseInput({
            id: 'vetoed',
            currentRound: 101,
            currentSlot: 12_928,
            exactPayloadVetoed: true,
        }));

        expect(categorizeCases([vetoed, review])).toEqual({
            open: [review],
            closed: [vetoed],
        });
    });
});

function state(overrides: Partial<CaseLifecycleInput>) {
    return deriveCaseState({
        round: 100,
        currentRound: 100,
        currentSlot: 12_800,
        timing,
        hasProposedActions: true,
        payloadAddress: PAYLOAD,
        exactPayloadVetoed: false,
        roundExecuted: false,
        slashingEnabled: true,
        slasherAuthorized: true,
        ...overrides,
    });
}

function caseInput(
    overrides: Partial<BuildSlashingCaseInput> = {},
): BuildSlashingCaseInput {
    return {
        id: 'case-100',
        network: 'mainnet',
        round: 100,
        currentRound: 100,
        currentSlot: 12_800,
        timing,
        targetEpochs: [392, 393, 394, 395],
        stack: {
            role: 'active',
            slasherAddress: SLASHER,
            authorized: true,
        },
        payloadAddress: PAYLOAD,
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
            source: 'hosted-monitor',
            observedAt: '2026-07-28T06:33:57.456Z',
            blockNumber: 25_629_342,
        },
        ...overrides,
    };
}
