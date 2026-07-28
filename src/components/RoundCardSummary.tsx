import type { DetectedSlashing } from '@/types/slashing';
import type { RoundVisual } from '@/lib/presentation';
import { formatAztec } from '@/lib/formatToken';

interface RoundCardSummaryProps {
    slashing: DetectedSlashing;
    visual: RoundVisual;
    isExpanded: boolean;
    onToggle: () => void;
}

export function RoundCardSummary({
    slashing,
    visual,
    isExpanded,
    onToggle,
}: RoundCardSummaryProps) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className="w-full cursor-pointer p-4 text-left sm:p-6"
            aria-expanded={isExpanded}
        >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                    <div className="border-3 border-whisper-white bg-brand-black px-3 py-2 sm:px-4">
                        <div className="text-xs font-black uppercase tracking-wider text-chartreuse">Round</div>
                        <div className="text-3xl font-black text-whisper-white">{slashing.round.toString()}</div>
                    </div>
                    <div className={`border-3 px-3 py-2 text-sm font-black uppercase tracking-wider sm:px-4 ${visual.badgeClass}`}>
                        {visual.label}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 sm:justify-end sm:gap-4">
                    {slashing.affectedValidatorCount !== undefined && (
                        <SummaryFact label="Sequencers" value={slashing.affectedValidatorCount.toString()} />
                    )}
                    {slashing.totalSlashAmount !== undefined && (
                        <SummaryFact
                            label="Slash total"
                            value={`${formatAztec(slashing.totalSlashAmount)} AZTEC`}
                            danger
                        />
                    )}
                    <span className="border-3 border-brand-black bg-whisper-white p-2" aria-hidden="true">
                        <svg
                            className={`h-6 w-6 stroke-[3] text-brand-black transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="square" strokeLinejoin="miter" d="M19 9l-7 7-7-7" />
                        </svg>
                    </span>
                </div>
            </div>
        </button>
    );
}

function SummaryFact({
    label,
    value,
    danger = false,
}: {
    label: string;
    value: string;
    danger?: boolean;
}) {
    return (
        <div className="border-3 border-vermillion bg-brand-black px-3 py-2 sm:px-4 sm:py-3">
            <div className="text-xs font-black uppercase tracking-wider text-vermillion">{label}</div>
            <div className={`text-2xl font-black ${danger ? 'text-vermillion' : 'text-whisper-white'}`}>
                {value}
            </div>
        </div>
    );
}
