import { useState, type ReactNode } from 'react';
import {
    URGENCY_RANK,
    formatAztec,
    type CaseUrgency,
    type SlashingCase,
} from '@shared/protocol/index.ts';
import { summarizeSequencer } from './AddressStatus';

const STORAGE_KEY = 'slashmon:watchlist-collapsed';

export function WatchlistSection({
    cases,
    sequencerCount,
    forceOpen,
    children,
}: {
    cases: readonly SlashingCase[];
    sequencerCount: number;
    forceOpen: boolean;
    children: ReactNode;
}) {
    const [collapsed, setCollapsed] = useState(loadCollapsed);
    const isOpen = forceOpen || !collapsed;
    const summary = summarizeSequencer(cases, null);
    const worst = worstActiveUrgency(cases);
    const badge = worst === 'critical'
        ? 'bg-vermillion'
        : worst === 'warning'
            ? 'bg-orchid'
            : summary.activeCases > 0
                ? 'bg-aqua'
                : 'bg-chartreuse';
    const facts = [
        `${summary.activeCases} open case${summary.activeCases === 1 ? '' : 's'}`,
        summary.pendingAmount !== null &&
            `${formatAztec(summary.pendingAmount)} AZTEC requested`,
        summary.removedAmount !== null &&
            `${formatAztec(summary.removedAmount)} AZTEC removed`,
    ].filter(Boolean).join(' · ');

    return (
        <details
            open={isOpen}
            onToggle={(event) => {
                const open = event.currentTarget.open;
                if (open === isOpen) return;
                setCollapsed(!open);
                saveCollapsed(!open);
            }}
            className="group mb-8"
        >
            <summary
                className="flex min-h-16 cursor-pointer list-none flex-col gap-3 border-5 border-chartreuse bg-malachite p-4 shadow-brutal-chartreuse sm:flex-row sm:items-center sm:justify-between sm:p-5 [&::-webkit-details-marker]:hidden"
            >
                <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-chartreuse">
                        Your watchlist
                    </p>
                    <h2 className="mt-1 text-2xl font-black text-whisper-white">
                        {sequencerCount} sequencer{sequencerCount === 1 ? '' : 's'} watched
                    </h2>
                    <p className="mt-1 text-xs font-bold text-whisper-white/60">
                        {facts}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    <span className={`border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${badge}`}>
                        {summary.activeCases > 0
                            ? `${summary.activeCases} open`
                            : 'All clear'}
                    </span>
                    <span className="text-sm font-black uppercase text-chartreuse" aria-hidden="true">
                        <span className="group-open:hidden">Expand +</span>
                        <span className="hidden group-open:inline">Collapse −</span>
                    </span>
                </div>
            </summary>
            <div className="mt-8 grid gap-8">{children}</div>
        </details>
    );
}

function worstActiveUrgency(cases: readonly SlashingCase[]): CaseUrgency {
    let worst: CaseUrgency = 'normal';
    for (const item of cases) {
        if (!item.state.active) continue;
        if (URGENCY_RANK[item.state.urgency] > URGENCY_RANK[worst]) {
            worst = item.state.urgency;
        }
    }
    return worst;
}

function loadCollapsed(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    }
    catch {
        return false;
    }
}

function saveCollapsed(collapsed: boolean): void {
    try {
        localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    }
    catch {
        // Collapsing still works for the session without storage.
    }
}
