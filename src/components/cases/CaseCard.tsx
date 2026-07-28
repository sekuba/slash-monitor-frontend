import { useId } from 'react';
import { formatAztec } from '@/lib/formatToken';
import { presentSlashingCase, type CaseTone } from '@/domain/casePresentation';
import type { SlashingCase } from '@/domain/slashingCase';
import { TargetList } from './TargetList';

interface CaseCardProps {
    slashingCase: SlashingCase;
}

export function CaseCard({ slashingCase }: CaseCardProps) {
    const headingId = useId();
    const presentation = presentSlashingCase(slashingCase);
    const palette = paletteFor(presentation.tone);
    const hasProposedActions = slashingCase.targets.length > 0;

    return (
        <article
            className={`border-5 p-4 shadow-[6px_6px_0_currentColor] sm:p-6 ${palette.card}`}
            aria-labelledby={headingId}
        >
            <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className={`text-xs font-black uppercase tracking-[0.18em] ${palette.accent}`}>
                        {slashingCase.stack.role} stack · round {slashingCase.round.toString()}
                    </div>
                    <h3 id={headingId} className="mt-1 text-2xl font-black text-whisper-white">
                        {presentation.label}
                    </h3>
                </div>
                <span className={`self-start border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${palette.badge}`}>
                    {slashingCase.state.kind === 'phase' ? 'Open' : 'Closed'}
                </span>
            </header>

            <p className="mt-4 text-sm font-bold leading-relaxed text-whisper-white">
                {presentation.summary}
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <CaseFact
                    label="Validator addresses"
                    value={hasProposedActions
                        ? slashingCase.targets.length.toString()
                        : 'Not established'}
                />
                <CaseFact
                    label="Proposed total"
                    value={hasProposedActions
                        ? `${formatAztec(slashingCase.proposedTotalAmount)} AZTEC`
                        : 'Not established'}
                />
                <CaseFact
                    label="Earliest execution"
                    value={formatSlotAndTime(
                        slashingCase.timing.executableSlot,
                        slashingCase.timing.executableAt,
                    )}
                />
                <CaseFact
                    label="Round expires"
                    value={formatSlotAndTime(
                        slashingCase.timing.expirySlot,
                        slashingCase.timing.expiresAt,
                    )}
                />
            </dl>

            <section className="mt-5" aria-labelledby={`${headingId}-validators`}>
                <h4 id={`${headingId}-validators`} className={`mb-3 text-sm font-black uppercase ${palette.accent}`}>
                    Validator targets
                </h4>
                <TargetList network={slashingCase.network} targets={slashingCase.targets} />
            </section>

            <details className="group mt-5 border-3 border-whisper-white/30 bg-brand-black">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black uppercase text-aqua focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-aqua">
                    Case evidence
                    <span aria-hidden="true">
                        <span className="group-open:hidden">+</span>
                        <span className="hidden group-open:inline">−</span>
                    </span>
                </summary>
                <div className="border-t-3 border-whisper-white/30 p-4">
                    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <TechnicalFact
                            label="Round votes"
                            value={`${slashingCase.ballotCount} recorded; not target-specific`}
                        />
                        <TechnicalFact
                            label="Quorum"
                            value={`${slashingCase.quorumPerTarget} matching votes per committee position`}
                        />
                        <TechnicalFact
                            label="Observed"
                            value={formatObservation(slashingCase)}
                        />
                        <TechnicalFact
                            label="Exact payload"
                            value={slashingCase.payload?.address ?? 'Not available'}
                        />
                        <TechnicalFact
                            label="Exact payload veto"
                            value={formatVetoState(slashingCase)}
                        />
                        <TechnicalFact
                            label="Slasher authorization"
                            value={slashingCase.stack.authorized ? 'Authorized' : 'Retired'}
                        />
                    </dl>
                    {slashingCase.targetEpochs.length > 0 && (
                        <p className="mt-4 text-xs font-bold text-whisper-white/70">
                            Target epochs: {slashingCase.targetEpochs.map(String).join(', ')}
                        </p>
                    )}
                </div>
            </details>
        </article>
    );
}

function CaseFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 border-3 border-whisper-white/30 bg-brand-black p-3">
            <dt className="text-[0.7rem] font-black uppercase text-aqua">{label}</dt>
            <dd className="mt-1 break-words text-sm font-black text-whisper-white">{value}</dd>
        </div>
    );
}

function TechnicalFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs font-black uppercase text-whisper-white/70">{label}</dt>
            <dd className="mt-1 break-all font-mono text-xs font-bold text-whisper-white">{value}</dd>
        </div>
    );
}

function paletteFor(tone: CaseTone) {
    return {
        aqua: {
            card: 'border-aqua bg-lapis text-aqua',
            accent: 'text-aqua',
            badge: 'bg-aqua',
        },
        chartreuse: {
            card: 'border-chartreuse bg-malachite text-chartreuse',
            accent: 'text-chartreuse',
            badge: 'bg-chartreuse',
        },
        orchid: {
            card: 'border-orchid bg-aubergine text-orchid',
            accent: 'text-orchid',
            badge: 'bg-orchid',
        },
        vermillion: {
            card: 'border-vermillion bg-oxblood text-vermillion',
            accent: 'text-vermillion',
            badge: 'bg-vermillion',
        },
    }[tone];
}

function formatSlotAndTime(slot: bigint, at: string | null): string {
    if (!at) return `Slot ${slot}`;
    return `Slot ${slot} · ${new Date(at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })}`;
}

function formatObservation(slashingCase: SlashingCase): string {
    const source = slashingCase.observation.source === 'independent-l1'
        ? 'Independent L1'
        : 'Hosted monitor';
    const block = slashingCase.observation.blockNumber === null
        ? ''
        : ` · block ${slashingCase.observation.blockNumber}`;
    return `${source}${block} · ${new Date(slashingCase.observation.observedAt).toLocaleString()}`;
}

function formatVetoState(slashingCase: SlashingCase): string {
    if (!slashingCase.payload) return 'Unknown — exact payload unavailable';
    if (!slashingCase.payload.vetoed) return 'Not reported vetoed';
    return slashingCase.payload.final
        ? 'Vetoed — applies to this exact final payload'
        : 'Current exact payload vetoed — voting can still change it';
}
