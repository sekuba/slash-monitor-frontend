import type { MonitorEvent } from '@/types/backendApi';
import type { RoundStatus } from '@/types/slashing';

export type RoundDisplayStatus = RoundStatus | 'vetoed';
export type RoundTheme = 'aqua' | 'chartreuse' | 'vermillion';

export interface RoundVisual {
    label: string;
    badgeClass: string;
    cardClass: string;
    pulseClass: string;
}

interface EventVisual {
    label: string;
    border: string;
    text: string;
    dot: string;
}

const ROUND_LABELS: Record<RoundDisplayStatus, string> = {
    'below-quorum': 'No Target at Quorum',
    'quorum-reached': 'Quorum Reached',
    'newly-executable': 'Newly Executable',
    'executable': 'Executable',
    'executed': 'Executed',
    'expired': 'Expired',
    'vetoed': 'Vetoed',
};

const ROUND_BADGES: Record<RoundDisplayStatus, string> = {
    'below-quorum': 'bg-aqua text-brand-black border-brand-black shadow-brutal',
    'quorum-reached': 'bg-malachite text-chartreuse border-chartreuse shadow-brutal-chartreuse',
    'newly-executable': 'bg-oxblood text-vermillion border-vermillion shadow-brutal-vermillion',
    'executable': 'bg-oxblood text-vermillion border-vermillion shadow-brutal-vermillion',
    'executed': 'bg-vermillion text-brand-black border-brand-black shadow-brutal',
    'expired': 'bg-aqua text-brand-black border-brand-black shadow-brutal',
    'vetoed': 'bg-lapis text-aqua border-aqua shadow-brutal-aqua',
};

const ROUND_THEMES: Record<RoundTheme, Pick<RoundVisual, 'cardClass' | 'pulseClass'>> = {
    aqua: {
        cardClass: 'bg-lapis border-aqua shadow-brutal-aqua',
        pulseClass: '[--pulse-color:var(--color-aqua)]',
    },
    chartreuse: {
        cardClass: 'bg-malachite border-chartreuse shadow-brutal-chartreuse',
        pulseClass: '[--pulse-color:var(--color-chartreuse)]',
    },
    vermillion: {
        cardClass: 'bg-oxblood border-vermillion shadow-brutal-vermillion',
        pulseClass: '[--pulse-color:var(--color-vermillion)]',
    },
};

export function getRoundVisual(
    status: RoundDisplayStatus,
    isProtected = false,
): RoundVisual {
    const theme: RoundTheme = isProtected ||
        status === 'vetoed' ||
        status === 'expired' ||
        status === 'below-quorum'
        ? 'aqua'
        : status === 'quorum-reached'
            ? 'chartreuse'
            : 'vermillion';
    return {
        label: ROUND_LABELS[status],
        badgeClass: ROUND_BADGES[status],
        ...ROUND_THEMES[theme],
    };
}

export function getEventVisual(type: string): EventVisual {
    if (type === 'l1_slash_confirmed' || type === 'l1_slash_reconfirmed') {
        return eventVisual('L1 slash', 'vermillion');
    }
    if (type.includes('reorg') || type.includes('reverted') || type.includes('cleared')) {
        return eventVisual('Correction', 'orchid');
    }
    if (type.includes('veto')) return eventVisual('Veto', 'aqua');
    if (type.includes('expired') || type.includes('protected')) {
        return eventVisual('Closed', 'chartreuse');
    }
    if (type.includes('executable') || type.includes('execution_paused')) {
        return eventVisual('Window', 'vermillion');
    }
    if (type.includes('onchain_targeted') || type.includes('payload_changed')) {
        return eventVisual('Quorum', 'chartreuse');
    }
    if (type.includes('vote')) return eventVisual('Vote', 'aqua');
    return eventVisual('Node signal', 'orchid');
}

export function getEventTitle(event: MonitorEvent): string {
    return event.type === 'inactivity_first_miss'
        ? 'Missed duty observed'
        : event.title;
}

function eventVisual(
    label: string,
    color: 'aqua' | 'chartreuse' | 'orchid' | 'vermillion',
): EventVisual {
    const palette = {
        aqua: { border: 'border-aqua', text: 'text-aqua', dot: 'bg-aqua' },
        chartreuse: {
            border: 'border-chartreuse',
            text: 'text-chartreuse',
            dot: 'bg-chartreuse',
        },
        orchid: { border: 'border-orchid', text: 'text-orchid', dot: 'bg-orchid' },
        vermillion: {
            border: 'border-vermillion',
            text: 'text-vermillion',
            dot: 'bg-vermillion',
        },
    }[color];
    return {
        label,
        ...palette,
    };
}
