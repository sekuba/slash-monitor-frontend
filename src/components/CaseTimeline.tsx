import { useEffect, useRef } from 'react';
import {
    stageLabel,
    type CaseStage,
    type ProtocolSnapshot,
    type SlashingCase,
} from '../../shared/protocol/index.ts';
import { EvidenceDetails } from './EvidenceDetails';

const PATH: Array<{ stage: CaseStage; label: string }> = [
    { stage: 'precursor', label: 'Duty issue' },
    { stage: 'node_offense', label: 'Node offense' },
    { stage: 'l1_support', label: 'L1 support' },
    { stage: 'candidate', label: 'Candidate' },
    { stage: 'delayed', label: 'Delay' },
    { stage: 'executable', label: 'Executable' },
    { stage: 'executed', label: 'Executed' },
    { stage: 'stake_removed', label: 'Stake removed' },
    { stage: 'ejected', label: 'Ejection' },
];

const PROGRESS: Partial<Record<CaseStage, number>> = {
    precursor: 0,
    node_offense: 1,
    awaiting_round: 1,
    l1_support: 2,
    candidate: 3,
    delayed: 4,
    vetoed: 4,
    executable: 5,
    executed: 6,
    stake_removed: 7,
    ejected: 8,
    expired: 3,
    resolved: 2,
    reorged: 2,
};

export function CaseTimeline({
    item,
    protocol,
    selected = false,
}: {
    item: SlashingCase;
    protocol: ProtocolSnapshot | null;
    selected?: boolean;
}) {
    const ref = useRef<HTMLElement>(null);
    const current = PROGRESS[item.state.stage] ?? 0;
    const reached = reachedStages(item);
    useEffect(() => {
        if (selected) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [selected]);

    return (
        <article
            ref={ref}
            id={`case-${safeDomId(item.id)}`}
            className={`border-5 bg-brand-black p-4 sm:p-6 ${
                item.state.urgency === 'critical'
                    ? 'border-vermillion shadow-brutal-vermillion'
                    : item.state.urgency === 'warning'
                        ? 'border-orchid shadow-brutal-orchid'
                        : 'border-aqua shadow-brutal-aqua'
            }`}
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-aqua">
                        Epoch {item.targetEpoch} · {stageLabel(item.state.stage)}
                    </p>
                    <h3 className="mt-1 break-words text-xl font-black text-whisper-white sm:text-2xl">
                        {item.state.headline}
                    </h3>
                </div>
                <span className={`w-fit border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${
                    item.state.urgency === 'critical'
                        ? 'bg-vermillion'
                        : item.state.urgency === 'warning'
                            ? 'bg-orchid'
                            : 'bg-aqua'
                }`}>
                    {item.state.active ? 'Active case' : 'Stopped'}
                </span>
            </div>

            <p className="mt-4 text-sm font-bold text-whisper-white/80">
                {item.state.explanation}
            </p>
            <div className="mt-3 border-3 border-chartreuse bg-malachite p-3">
                <span className="text-xs font-black uppercase text-chartreuse">Possible reason · </span>
                <span className="text-sm font-bold text-whisper-white">
                    {item.state.reason.label}
                    {item.state.reason.provenance === 'node_evidence'
                        ? ' (node evidence)'
                        : ' (not encoded on L1)'}
                </span>
            </div>

            {item.state.nextTransition && (
                <div className="mt-3 border-3 border-aqua bg-lapis p-3">
                    <p className="text-xs font-black uppercase text-aqua">What happens next</p>
                    <p className="mt-1 font-black text-whisper-white">
                        {item.state.nextTransition.label}
                        {item.state.nextTransition.at
                            ? ` · ${relativeTime(item.state.nextTransition.at)}`
                            : item.state.nextTransition.slot
                                ? ` · slot ${item.state.nextTransition.slot}`
                                : ''}
                    </p>
                </div>
            )}

            <ol className="mt-6 grid gap-2 md:grid-cols-9" aria-label="Slashing protocol path">
                {PATH.map((step, index) => {
                    const active = index === current;
                    const complete = !active && reached.has(step.stage);
                    return (
                        <li
                            key={step.stage}
                            className={`min-w-0 border-3 p-2 text-xs font-black uppercase ${
                                active
                                    ? 'border-brand-black bg-vermillion text-brand-black'
                                    : complete
                                        ? 'border-chartreuse bg-malachite text-chartreuse'
                                        : 'border-whisper-white/30 text-whisper-white/45'
                            }`}
                            aria-current={active ? 'step' : undefined}
                        >
                            <span className="mr-1">{complete ? '✓' : index + 1}</span>
                            {step.label}
                        </li>
                    );
                })}
            </ol>

            <EvidenceDetails item={item} protocol={protocol} />
        </article>
    );
}

function reachedStages(item: SlashingCase): Set<CaseStage> {
    const reached = new Set<CaseStage>();
    const local = item.observations.filter((observation) =>
        observation.provenance.canonical);
    if (local.some((observation) =>
        observation.kind === 'duty_miss' || observation.kind === 'inactivity_epoch')) {
        reached.add('precursor');
    }
    if (local.some((observation) => observation.kind === 'node_offense')) {
        reached.add('node_offense');
    }
    const round = [...local].reverse().find(
        (observation) => observation.kind === 'l1_round',
    );
    if (round) {
        reached.add('l1_support');
        if (round.data.amount) reached.add('candidate');
        if (round.data.amount && round.data.stable) reached.add('delayed');
        if (['newly-executable', 'executable', 'executed'].includes(
            String(round.data.status ?? ''),
        )) {
            reached.add('executable');
        }
        if (round.data.isExecuted || round.data.status === 'executed') {
            reached.add('executed');
        }
    }
    if (local.some((observation) => observation.kind === 'l1_slash')) {
        reached.add('stake_removed');
    }
    if (local.some((observation) =>
        observation.kind === 'stake_status' && observation.data.ejected)) {
        reached.add('ejected');
    }
    return reached;
}

function relativeTime(value: string): string {
    const difference = Date.parse(value) - Date.now();
    const absolute = Math.abs(difference);
    const units: Array<[number, string]> = [
        [86_400_000, 'day'],
        [3_600_000, 'hour'],
        [60_000, 'minute'],
    ];
    for (const [milliseconds, label] of units) {
        if (absolute >= milliseconds) {
            const count = Math.max(1, Math.round(absolute / milliseconds));
            return difference >= 0
                ? `in ${count} ${label}${count === 1 ? '' : 's'}`
                : `${count} ${label}${count === 1 ? '' : 's'} ago`;
        }
    }
    return difference >= 0 ? 'in less than a minute' : 'just now';
}

function safeDomId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}
