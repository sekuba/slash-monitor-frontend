import { formatAztec } from '@/lib/formatToken';
import type { CasePhase, CaseTerminal, SlashingCase } from './slashingCase';

export type CaseTone = 'aqua' | 'chartreuse' | 'orchid' | 'vermillion';

export interface CasePresentation {
    label: string;
    summary: string;
    tone: CaseTone;
}

const PHASE_LABELS: Record<CasePhase, string> = {
    voting: 'Voting on Ethereum',
    review: 'Final tally · review period',
    ready: 'Ready to execute',
    paused: 'Execution paused',
};

const TERMINAL_LABELS: Record<CaseTerminal, string> = {
    'no-consensus': 'Voting closed · no slash requested',
    vetoed: 'Exact slash payload vetoed',
    executed: 'Round executed',
    expired: 'Execution window expired',
    'stack-retired': 'Execution unavailable · slasher retired',
};

export function presentSlashingCase(slashingCase: SlashingCase): CasePresentation {
    if (slashingCase.state.kind === 'terminal') {
        return presentTerminalCase(slashingCase.state.terminal);
    }
    return presentOpenCase(slashingCase, slashingCase.state.phase);
}

function presentOpenCase(
    slashingCase: SlashingCase,
    phase: CasePhase,
): CasePresentation {
    if (phase === 'voting') {
        if (slashingCase.provisionalQuorum) {
            const vetoContext = slashingCase.payload?.vetoed
                ? ' The currently derived exact payload is vetoed, but a different final payload may result.'
                : '';
            return {
                label: PHASE_LABELS[phase],
                summary: `Current tally reaches slash quorum for at least one committee position. Voting remains open; the actions, amount, and exact payload may change.${vetoContext}`,
                tone: 'orchid',
            };
        }
        return {
            label: PHASE_LABELS[phase],
            summary: 'Voting remains open. A vote does not by itself request or execute a slash.',
            tone: 'orchid',
        };
    }
    if (phase === 'review') {
        return {
            label: PHASE_LABELS[phase],
            summary: `Final tally requests ${formatAztec(slashingCase.proposedTotalAmount)} AZTEC across ${formatValidatorAddressCount(slashingCase.targets.length)}. Execution has not opened.`,
            tone: 'chartreuse',
        };
    }
    if (phase === 'paused') {
        const pauseEnd = slashingCase.pauseEndsAt
            ? ` The current pause is scheduled through ${formatDate(slashingCase.pauseEndsAt)}; expiry is unchanged.`
            : ' Expiry is unchanged.';
        return {
            label: PHASE_LABELS[phase],
            summary: `The execution window is open, but the global slashing pause currently blocks this exact payload.${pauseEnd}`,
            tone: 'orchid',
        };
    }
    return {
        label: PHASE_LABELS[phase],
        summary: `This exact payload can be executed before ${formatWindowEnd(slashingCase)} unless it is vetoed or execution becomes paused.`,
        tone: 'vermillion',
    };
}

function presentTerminalCase(terminal: CaseTerminal): CasePresentation {
    if (terminal === 'no-consensus') {
        return {
            label: TERMINAL_LABELS[terminal],
            summary: 'Voting closed without a committee position reaching slash quorum. Nothing from this round can be executed.',
            tone: 'aqua',
        };
    }
    if (terminal === 'vetoed') {
        return {
            label: TERMINAL_LABELS[terminal],
            summary: 'This exact final payload is vetoed. The veto does not apply to other payloads or future rounds for this validator.',
            tone: 'aqua',
        };
    }
    if (terminal === 'executed') {
        return {
            label: TERMINAL_LABELS[terminal],
            summary: 'Ethereum records this round as executed. Confirmed token loss is listed separately from round execution.',
            tone: 'vermillion',
        };
    }
    if (terminal === 'expired') {
        return {
            label: TERMINAL_LABELS[terminal],
            summary: 'The unexecuted payload passed its execution deadline. This describes this payload window, not future rounds.',
            tone: 'aqua',
        };
    }
    return {
        label: TERMINAL_LABELS[terminal],
        summary: 'This round’s immutable slasher is no longer active or authorized as legacy, so it cannot execute this payload.',
        tone: 'orchid',
    };
}

function formatValidatorAddressCount(count: number): string {
    return `${count} validator address${count === 1 ? '' : 'es'}`;
}

function formatWindowEnd(slashingCase: SlashingCase): string {
    return slashingCase.timing.expiresAt
        ? formatDate(slashingCase.timing.expiresAt)
        : `slot ${slashingCase.timing.expirySlot}`;
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
    });
}
