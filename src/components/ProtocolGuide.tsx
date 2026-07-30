import { useEffect, useRef } from 'react';
import { PROTOCOL_TONES } from '@/lib/protocolTones';
import type { ProtocolSnapshot } from '../../shared/protocol/index.ts';

const STAGES = [
    {
        number: '01',
        title: 'Duty miss',
        source: 'Sentinel · node evidence',
        detail: 'A proposer or committee duty was missed. For inactivity, consecutive epochs are tracked until the threshold is hit.',
        tone: PROTOCOL_TONES.node.surface,
    },
    {
        number: '02',
        title: 'Node offense',
        source: 'Aztec node · local policy',
        detail: 'The node records an offense and penalty after applying its evidence rules, exemptions, grace period, and allow/deny policy.',
        tone: PROTOCOL_TONES.node.surface,
    },
    {
        number: '03',
        title: 'L1 mention',
        source: 'SlashingProposer · Ethereum',
        detail: 'Selected checkpoint proposers vote on penalties for committee positions in older target epochs. Support is counted for each validator and penalty level. The offense reason stays with the node evidence.',
        tone: PROTOCOL_TONES.voting.surface,
    },
    {
        number: '04',
        title: 'Candidate',
        source: 'Calculated from the live L1 tally',
        detail: 'Quorum produces a candidate action and predicted payload address. While voting is open, later ballots can change the action set, amount, and address.',
        tone: PROTOCOL_TONES.voting.surface,
    },
    {
        number: '05',
        title: 'Execution delay',
        source: 'Stable L1 tally · council review',
        detail: 'When voting closes, the candidate becomes stable. The execution delay gives the Slash Veto Council time to review it.',
        tone: PROTOCOL_TONES.execution.surface,
    },
    {
        number: '06',
        title: 'Executable',
        source: 'Slasher · Ethereum',
        detail: 'The delay has elapsed and the candidate is inside its execution window. A selected proposer usually executes it, though the contract permits another caller.',
        tone: PROTOCOL_TONES.execution.surface,
    },
    {
        number: '07',
        title: 'Executed',
        source: 'RoundExecuted · Ethereum log',
        detail: 'RoundExecuted confirms the round and its final action list were executed.',
        tone: PROTOCOL_TONES.execution.surface,
    },
    {
        number: '08',
        title: 'Stake removed',
        source: 'Rollup Slashed · Ethereum log',
        detail: 'A canonical Slashed log confirms the sequencer and the amount deducted.',
        tone: PROTOCOL_TONES.outcome.surface,
    },
    {
        number: '09',
        title: 'Ejection',
        source: 'Rollup / GSE stake state',
        detail: 'When the remaining balance falls below the local threshold, the validator leaves the active set. Its remaining stake enters the delayed exit flow.',
        tone: PROTOCOL_TONES.outcome.surface,
    },
] as const;

const OFFENSES = [
    'Inactivity',
    'Data withholding',
    'Broadcast invalid block proposal',
    'Broadcast invalid checkpoint proposal',
    'Proposed insufficient attestations',
    'Proposed incorrect attestations',
    'Proposed descendant of a checkpoint with invalid attestations',
    'Attested invalid checkpoint proposal',
    'Duplicate proposal',
    'Duplicate attestation',
] as const;

const PHASES = [
    {
        number: 'A',
        title: 'Node evidence',
        stages: STAGES.slice(0, 2),
    },
    {
        number: 'B',
        title: 'L1 Voting',
        stages: STAGES.slice(2, 6),
    },
    {
        number: 'C',
        title: 'Slashing',
        stages: STAGES.slice(6),
    },
] as const;

export function ProtocolGuide({
    isOpen,
    protocol,
    onClose,
}: {
    isOpen: boolean;
    protocol: ProtocolSnapshot | null;
    onClose: () => void;
}) {
    const closeButton = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', closeOnEscape);
        closeButton.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const timing = timingFacts(protocol);
    return (
        <div
            className="fixed inset-0 z-[80] overflow-hidden bg-brand-black/90 p-2 sm:p-6"
            onClick={onClose}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="protocol-guide-title"
                onClick={(event) => event.stopPropagation()}
                className="mx-auto flex max-h-[calc(100dvh-1rem)] max-w-7xl flex-col border-6 border-aqua bg-brand-black shadow-brutal-aqua sm:max-h-[calc(100dvh-3rem)]"
            >
                <header className="flex shrink-0 items-start justify-between gap-4 border-b-6 border-aqua bg-lapis p-4 sm:p-6">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-aqua">
                            Explained
                        </p>
                        <h2 id="protocol-guide-title" className="mt-1 text-2xl font-black text-whisper-white sm:text-4xl">
                            Slashing Timeline
                        </h2>
                    </div>
                    <button
                        ref={closeButton}
                        type="button"
                        onClick={onClose}
                        className="brutal-button brutal-button--danger brutal-button--icon shrink-0"
                        aria-label="Close protocol guide"
                    >
                        <span className="text-2xl leading-none">×</span>
                    </button>
                </header>

                <div className="overflow-y-auto overscroll-contain p-4 sm:p-7">
                    {timing.length > 0 && (
                        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {timing.map((fact) => (
                                <article key={fact.label} className="border-3 border-aqua bg-lapis p-3">
                                    <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-aqua">
                                        {fact.label}
                                    </p>
                                    <p className="mt-1 text-lg font-black text-whisper-white">{fact.value}</p>
                                    <p className="mt-1 text-xs font-bold text-whisper-white/55">{fact.note}</p>
                                </article>
                            ))}
                        </section>
                    )}

                    <div className={`${timing.length > 0 ? 'mt-7' : ''} space-y-8`}>
                        {PHASES.map((phase, phaseIndex) => (
                            <section key={phase.number}>
                                <div className="mb-4 flex items-start gap-3">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center border-3 border-whisper-white bg-whisper-white font-mono text-lg font-black text-brand-black">
                                        {phase.number}
                                    </span>
                                    <h3 className="self-center text-xl font-black text-whisper-white">
                                        {phase.title}
                                    </h3>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {phase.stages.map((stage) => (
                                        <GuideStage key={stage.number} stage={stage} />
                                    ))}
                                </div>
                                {phaseIndex < PHASES.length - 1 && (
                                    <div className="mt-6 flex items-center gap-3" aria-hidden="true">
                                        <span className="h-1 flex-1 bg-whisper-white/25" />
                                        <span className="border-3 border-brand-black bg-chartreuse px-3 py-1 text-xl font-black text-brand-black">
                                            ↓
                                        </span>
                                        <span className="h-1 flex-1 bg-whisper-white/25" />
                                    </div>
                                )}
                            </section>
                        ))}
                    </div>

                    <section className="mt-7">
                        <article className="border-5 border-orchid bg-aubergine p-5 shadow-brutal-orchid">
                            <h3 className="text-2xl font-black text-whisper-white">
                                Offenses
                            </h3>
                            <p className="mt-3 text-sm font-bold text-whisper-white/70">
                                A node may report any of these reasons. The node evidence
                                carries the reason; the L1 vote carries the target and penalty.
                            </p>
                            <ul className="mt-4 grid gap-x-5 gap-y-2 text-xs font-bold text-whisper-white/75 sm:grid-cols-2">
                                {OFFENSES.map((offense) => (
                                    <li key={offense} className="border-l-3 border-orchid pl-2">
                                        {offense}
                                    </li>
                                ))}
                            </ul>
                        </article>
                    </section>

                    <a
                        href="https://github.com/aztec-slash-veto/council"
                        target="_blank"
                        rel="noreferrer"
                        className="brutal-button brutal-button--aqua mt-7"
                    >
                        Slash appeals ↗
                    </a>
                </div>
            </section>
        </div>
    );
}

function GuideStage({
    stage,
}: {
    stage: (typeof STAGES)[number];
}) {
    return (
        <article className={`border-5 p-4 ${stage.tone}`}>
            <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-black">{stage.number}</span>
                <span className="text-right text-[0.65rem] font-black uppercase">
                    {stage.source}
                </span>
            </div>
            <h4 className="mt-5 text-xl font-black text-whisper-white">
                {stage.title}
            </h4>
            <p className="mt-3 text-sm font-bold text-whisper-white/75">
                {stage.detail}
            </p>
        </article>
    );
}

function timingFacts(protocol: ProtocolSnapshot | null): Array<{
    label: string;
    value: string;
    note: string;
}> {
    const lineage = protocol?.lineages.find((item) => item.role === 'active') ??
        protocol?.lineages[0];
    if (!protocol || !lineage) {
        return [];
    }
    const parameters = lineage.parameters;
    const roundSeconds = parameters.roundSizeSlots * protocol.slotDurationSeconds;
    const executionWindowRounds = Math.max(
        0,
        parameters.lifetimeRounds - parameters.executionDelayRounds,
    );
    const facts = [
        {
            label: 'Target offset',
            value: count(parameters.slashOffsetRounds, 'round'),
            note: `Voting round targets offenses from R − ${parameters.slashOffsetRounds}`,
        },
        {
            label: 'Vote round',
            value: formatDuration(roundSeconds),
            note: `${parameters.roundSizeSlots} slots · ${parameters.roundSizeEpochs} epochs · quorum ${parameters.quorum}`,
        },
        {
            label: 'Execution delay',
            value: formatDuration(parameters.executionDelayRounds * roundSeconds),
            note: `${parameters.executionDelayRounds} rounds after voting closes`,
        },
        {
            label: 'Execution window',
            value: formatDuration(executionWindowRounds * roundSeconds),
            note: `${executionWindowRounds} rounds before expiry`,
        },
    ];
    if (protocol.inactivity) {
        facts.unshift({
            label: 'Inactivity rule',
            value: `${Math.round(protocol.inactivity.targetPercentage * 100)}% × ${protocol.inactivity.consecutiveEpochs}`,
            note: 'Missed duty % × consecutive epochs',
        });
    }
    return facts;
}

export function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
    if (remainder > 0 || parts.length === 0) parts.push(`${remainder}s`);
    return parts.join(' ');
}

function count(value: number, unit: string): string {
    return `${value} ${unit}${value === 1 ? '' : 's'}`;
}
