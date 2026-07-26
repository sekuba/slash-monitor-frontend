import { useEffect, useRef } from 'react';
import { SequencerAddressControl } from './SequencerAddressControl';
import { getEventTitle, getEventVisual } from '@/lib/presentation';
import type { EventL1Context, MonitorEvent } from '@/types/backendApi';

interface EventHistoryProps {
    events: MonitorEvent[];
    hasWatchlistCapability: boolean;
    selectedEventId?: string | null;
    selectedEventError?: string | null;
    onSelectSequencer?: (sequencer: MonitorEvent['targets'][number]) => void;
}

export function EventHistory({
    events,
    hasWatchlistCapability,
    selectedEventId = null,
    selectedEventError = null,
    onSelectSequencer,
}: EventHistoryProps) {
    const scrolledEventIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!selectedEventId || events.length === 0 || scrolledEventIdRef.current === selectedEventId) {
            return;
        }
        const element = document.getElementById(`event-${selectedEventId}`);
        if (element) {
            scrolledEventIdRef.current = selectedEventId;
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [events, selectedEventId]);

    return (
        <section className="border-5 border-aqua bg-lapis p-5 shadow-brutal-aqua">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="mb-2 inline-flex border-3 border-brand-black bg-aqua px-3 py-1 text-xs font-black uppercase text-brand-black">
                        Pingme Journal
                    </div>
                    <h2 className="text-2xl font-black text-aqua">Network feed</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white">
                        {hasWatchlistCapability
                            ? 'Node signals and confirmed L1 activity for this browser’s watch list.'
                            : 'Public node signals and confirmed L1 slashing activity.'}
                    </p>
                </div>
                <span className="border-3 border-brand-black bg-aqua px-3 py-2 text-sm font-black uppercase text-brand-black">
                    {events.length} events
                </span>
            </div>

            {selectedEventError && (
                <div className="mb-4 border-3 border-vermillion bg-brand-black p-4 text-sm font-bold text-vermillion" role="alert">
                    {selectedEventError}
                </div>
            )}

            {events.length === 0 ? (
                <div className="border-3 border-aqua bg-brand-black p-4 text-sm font-bold text-whisper-white/80">
                    {hasWatchlistCapability
                        ? 'No journaled slashing events target this watch list yet.'
                        : 'No public node-local or L1 slashing events have been journaled yet.'}
                </div>
            ) : (
                <div className="space-y-3">
                    {events.map((event) => (
                        <EventCard
                            key={event.id}
                            event={event}
                            selected={event.id === selectedEventId}
                            onSelectSequencer={onSelectSequencer}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

function EventCard({
    event,
    selected,
    onSelectSequencer,
}: {
    event: MonitorEvent;
    selected: boolean;
    onSelectSequencer?: EventHistoryProps['onSelectSequencer'];
}) {
    const pending = event.certainty === 'pending';
    const visual = getEventVisual(event.type);
    return (
        <article
            id={`event-${event.id}`}
            className={`border-3 bg-brand-black p-4 ${
                selected ? 'border-chartreuse shadow-brutal-chartreuse' : visual.border
            }`}
        >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h3 className={`text-base font-black ${visual.text}`}>
                        {getEventTitle(event)}
                    </h3>
                    <EventTargets event={event} onSelectSequencer={onSelectSequencer} />
                </div>
                <span className={`shrink-0 border-3 border-brand-black px-2 py-1 text-xs font-black uppercase text-brand-black ${pending ? 'bg-orchid' : 'bg-aqua'}`}>
                    {pending ? 'Node · pending' : 'L1 · confirmed'}
                </span>
            </div>

            <EventFacts event={event} />
            {event.body && <p className="mt-3 text-sm font-bold text-whisper-white/80">{event.body}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold text-whisper-white/60">
                <time dateTime={event.occurredAt} title={`UTC: ${event.occurredAt}`}>
                    Observed {formatJournalTime(event.occurredAt)}
                </time>
                <L1Links l1={event.l1} />
            </div>
        </article>
    );
}

function EventTargets({
    event,
    onSelectSequencer,
}: {
    event: MonitorEvent;
    onSelectSequencer?: EventHistoryProps['onSelectSequencer'];
}) {
    if (event.targets.length === 0) {
        return null;
    }
    const uniqueTargets = event.targets.filter((target, index, targets) =>
        targets.findIndex((candidate) =>
            candidate.toLowerCase() === target.toLowerCase()) === index);
    const preview = uniqueTargets.slice(0, 3);
    const remaining = uniqueTargets.slice(3);
    return (
        <div className="mt-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {preview.map((target) => {
                    const amount = event.l1?.actions.find((action) =>
                        action.sequencer.toLowerCase() === target.toLowerCase())?.amount;
                    return (
                        <EventTarget
                            key={target}
                            event={event}
                            target={target}
                            amount={amount}
                            onSelectSequencer={onSelectSequencer}
                        />
                    );
                })}
            </div>
            {remaining.length > 0 && (
                <details className="mt-2 text-xs text-whisper-white/80">
                    <summary className="w-fit cursor-pointer font-black uppercase text-aqua underline underline-offset-4">
                        Show {remaining.length} more target{remaining.length === 1 ? '' : 's'}
                    </summary>
                    <div className="mt-2 grid gap-2 border-l-3 border-aqua/50 pl-3 sm:grid-cols-2 xl:grid-cols-3">
                        {remaining.map((target) => {
                            const amount = event.l1?.actions.find((action) =>
                                action.sequencer.toLowerCase() === target.toLowerCase())?.amount;
                            return (
                                <EventTarget
                                    key={target}
                                    event={event}
                                    target={target}
                                    amount={amount}
                                    full
                                    onSelectSequencer={onSelectSequencer}
                                />
                            );
                        })}
                    </div>
                </details>
            )}
        </div>
    );
}

function EventTarget({
    event,
    target,
    amount,
    full = false,
    onSelectSequencer,
}: {
    event: MonitorEvent;
    target: MonitorEvent['targets'][number];
    amount?: string;
    full?: boolean;
    onSelectSequencer?: EventHistoryProps['onSelectSequencer'];
}) {
    const evidence = event.nodeEvidence.filter((item) =>
        item.sequencer.toLowerCase() === target.toLowerCase());
    return (
        <div className="min-w-0">
            <SequencerAddressControl
                address={target}
                chars={full ? undefined : 6}
                full={full}
                showCopy
                onOpenRecord={onSelectSequencer}
                className="font-mono text-xs font-bold text-whisper-white"
            />
            {amount && (
                <span className="text-[0.68rem] font-bold text-whisper-white/55">
                    {formatAztec(amount)} AZTEC proposed
                </span>
            )}
            {evidence.map((item) => (
                <div
                    key={`${item.kind}-${item.epoch}-${item.offenseId ?? 'precursor'}`}
                    className="mt-1 text-[0.68rem] font-bold text-chartreuse"
                >
                    {item.kind === 'slash_offense'
                        ? `Node evidence: ${humanize(item.offenseTypeName)} · epoch ${item.epoch}`
                        : item.missed !== null && item.total !== null &&
                            item.inactiveStreak !== null && item.slashableThreshold !== null
                            ? `Node precursor: ${item.missed}/${item.total} duties missed · epoch ${item.epoch} · streak ${item.inactiveStreak}/${item.slashableThreshold}`
                            : `Node precursor: ${humanize(item.offenseTypeName)} · epoch ${item.epoch}`}
                </div>
            ))}
        </div>
    );
}

function EventFacts({ event }: { event: MonitorEvent }) {
    const facts: string[] = [];
    if (event.offense) {
        const offense = event.offense;
        facts.push(`Reason: ${humanize(offense.reason)}${offense.type !== null ? ` (#${offense.type})` : ''}`);
        if (offense.epoch) facts.push(`Epoch ${offense.epoch}`);
        if (offense.slot) {
            const slotLabel = event.type === 'inactivity_first_miss'
                ? 'Missed slot'
                : offense.timeUnit === 'epoch'
                    ? 'Epoch starts at slot'
                    : 'Slot';
            facts.push(`${slotLabel} ${offense.slot}`);
        }
        if (!offense.epoch && offense.epochOrSlot) {
            facts.push(`${humanize(offense.timeUnit ?? 'position')} ${offense.epochOrSlot}`);
        }
        if (offense.offenseRound) facts.push(`Offense round ${offense.offenseRound}`);
        if (offense.proposalRound) facts.push(`Expected vote round ${offense.proposalRound}`);
        if (offense.amount) facts.push(`Node slash amount ${formatAztec(offense.amount)} AZTEC`);
    }
    if (event.l1) {
        const l1 = event.l1;
        if (event.type !== 'l1_reorg_detected') {
            facts.push(event.nodeEvidence.length > 0
                ? 'L1 reason: not encoded · matched node evidence below'
                : 'Reason: not encoded on L1');
        }
        if (l1.round) facts.push(`${humanize(l1.role ?? 'active')} round ${l1.round}`);
        if (l1.targetEpochs.length > 0) facts.push(`Target ${formatEpochRange(l1.targetEpochs)}`);
        if (l1.executableSlot) {
            facts.push(`Execution window: slot ${l1.executableSlot}${l1.executableAt ? ` · ${formatJournalTime(l1.executableAt)}` : ''}`);
        }
        if (l1.expirySlot) {
            facts.push(`Expiry slot ${l1.expirySlot}${l1.expiryAt ? ` · ${formatJournalTime(l1.expiryAt)}` : ''}`);
        }
        if (l1.currentEpoch && l1.currentSlot) facts.push(`Observed at epoch ${l1.currentEpoch} · slot ${l1.currentSlot}`);
        if (l1.amount) facts.push(`Onchain slash amount ${formatAztec(l1.amount)} AZTEC`);
    }
    if (facts.length === 0) {
        return null;
    }
    return (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-whisper-white/70">
            {facts.map((fact) => <span key={fact}>{fact}</span>)}
        </div>
    );
}

function L1Links({ l1 }: { l1: EventL1Context | null }) {
    if (!l1) return null;
    const explorer = etherscanOrigin(l1.chainId);
    if (!explorer) return null;
    return (
        <>
            {l1.transactionHash && (
                <a className="text-aqua underline underline-offset-4 hover:text-chartreuse" href={`${explorer}/tx/${l1.transactionHash}`} target="_blank" rel="noreferrer">
                    Etherscan tx ↗
                </a>
            )}
            {l1.blockNumber && (
                <a className="text-aqua underline underline-offset-4 hover:text-chartreuse" href={`${explorer}/block/${l1.blockNumber}`} target="_blank" rel="noreferrer">
                    L1 block {l1.blockNumber} ↗
                </a>
            )}
            {l1.payloadAddress && (
                <a className="text-aqua underline underline-offset-4 hover:text-chartreuse" href={`${explorer}/address/${l1.payloadAddress}`} target="_blank" rel="noreferrer">
                    Payload ↗
                </a>
            )}
        </>
    );
}

function humanize(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatJournalTime(value: string): string {
    const date = new Date(value);
    try {
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short',
        });
    }
    catch {
        return `${date.toISOString()} (UTC)`;
    }
}

function formatEpochRange(values: string[]): string {
    if (values.length === 1) return `epoch ${values[0]}`;
    const epochs = values.map(BigInt);
    const consecutive = epochs.every((epoch, index) => index === 0 || epoch === epochs[index - 1] + 1n);
    return consecutive
        ? `epochs ${values[0]}–${values[values.length - 1]}`
        : `epochs ${values.join(', ')}`;
}

function etherscanOrigin(chainId: number): string | null {
    if (chainId === 1) return 'https://etherscan.io';
    if (chainId === 11_155_111) return 'https://sepolia.etherscan.io';
    return null;
}

function formatAztec(value: string): string {
    try {
        const amount = BigInt(value);
        const whole = amount / 10n ** 18n;
        const fraction = (amount % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
        const formattedWhole = whole.toLocaleString();
        return fraction ? `${formattedWhole}.${fraction}` : formattedWhole;
    }
    catch {
        return value;
    }
}
