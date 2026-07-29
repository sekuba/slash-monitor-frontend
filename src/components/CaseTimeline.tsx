import { useEffect, useRef } from 'react';
import {
    stageLabel,
    type ProtocolSnapshot,
    type SlashingCase,
} from '../../shared/protocol/index.ts';
import { EvidenceDetails } from './EvidenceDetails';
import { urlForCase } from '@/lib/navigation';
import { ProtocolPath } from './ProtocolPath';
import { ShareButton } from './ShareButton';

export function CaseTimeline({
    item,
    protocol,
    selected = false,
    showSequencer = false,
    onOpenProtocolGuide,
}: {
    item: SlashingCase;
    protocol: ProtocolSnapshot | null;
    selected?: boolean;
    showSequencer?: boolean;
    onOpenProtocolGuide: (protocol: ProtocolSnapshot | null) => void;
}) {
    const ref = useRef<HTMLElement>(null);
    const shareUrl = typeof window === 'undefined'
        ? `?case=${encodeURIComponent(item.id)}`
        : urlForCase(window.location.href, item.id).href;
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
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-aqua">
                            Epoch {item.targetEpoch} · {stageLabel(item.state.stage)}
                        </p>
                        <ShareButton url={shareUrl} ariaLabel="Copy link to this case" />
                    </div>
                    {showSequencer && (
                        <code className="mt-2 block break-all text-xs font-black text-chartreuse">
                            {item.sequencer}
                        </code>
                    )}
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

            <ProtocolPath
                item={item}
                onOpenGuide={() => onOpenProtocolGuide(protocol)}
            />

            <EvidenceDetails item={item} protocol={protocol} />
        </article>
    );
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
