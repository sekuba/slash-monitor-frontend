import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getAddress, isAddress, type Address } from 'viem';
import { SequencerAddressControl } from './SequencerAddressControl';
import { SlashingProcess, type SlashingProcessTiming } from './SlashingProcess';
import { formatJournalTime } from './EventHistory';
import { useSequencerRecord } from '@/hooks/useSequencerRecord';
import { getEventTitle, getEventVisual } from '@/lib/presentation';
import type {
    MonitorEvent,
    MonitorNetwork,
    SlashingProtocolSnapshot,
} from '@/types/backendApi';

interface SequencerRecordProps {
    network: MonitorNetwork;
    sequencer: Address | null;
    onSelect: (sequencer: Address | null) => void;
}

export function SequencerRecord({ network, sequencer, onSelect }: SequencerRecordProps) {
    const [draft, setDraft] = useState(() => ({
        sequencer,
        value: sequencer ?? '',
    }));
    const [validation, setValidation] = useState<{
        sequencer: Address | null;
        message: string;
    } | null>(null);
    const monitor = useSequencerRecord(network, sequencer);
    const query = draft.sequencer === sequencer ? draft.value : sequencer ?? '';
    const validationError = validation?.sequencer === sequencer
        ? validation.message
        : null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const input = query.trim();
        if (!isAddress(input, { strict: false })) {
            setValidation({
                sequencer,
                message: 'Enter a 20-byte Ethereum address.',
            });
            return;
        }
        setValidation(null);
        onSelect(getAddress(input));
    };

    return (
        <section id="sequencer-record" className="mb-8">
            <div className="border-6 border-orchid bg-aubergine p-5 shadow-brutal-orchid sm:p-7">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-orchid">Backend record</div>
                        <h2 className="mt-1 text-3xl font-black text-whisper-white">Search a sequencer</h2>
                        <p className="mt-2 text-sm font-bold text-whisper-white/70">
                            Every node signal and L1 event logged for one address. No watch list required.
                        </p>
                    </div>
                    {sequencer && (
                        <button
                            type="button"
                            onClick={() => onSelect(null)}
                            className="brutal-button brutal-button--neutral brutal-button--sm self-start lg:self-auto"
                        >
                            Clear record
                        </button>
                    )}
                </div>

                <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <label htmlFor="sequencer-record-search" className="sr-only">Sequencer address</label>
                    <input
                        id="sequencer-record-search"
                        value={query}
                        onChange={(event) => {
                            setDraft({ sequencer, value: event.target.value });
                            setValidation(null);
                        }}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder="0x… sequencer address"
                        className="min-h-12 min-w-0 flex-1 border-3 border-orchid bg-brand-black px-4 font-mono text-sm font-bold text-whisper-white placeholder:text-whisper-white/35 focus:outline-hidden"
                    />
                    <button type="submit" className="brutal-button brutal-button--orchid brutal-button--lg">
                        Open record
                    </button>
                </form>
                {validationError && (
                    <p className="mt-3 text-sm font-bold text-vermillion" role="alert">{validationError}</p>
                )}
            </div>

            {sequencer && (
                <RecordBody
                    sequencer={sequencer}
                    monitor={monitor}
                />
            )}
        </section>
    );
}

function RecordBody({
    sequencer,
    monitor,
}: {
    sequencer: Address;
    monitor: ReturnType<typeof useSequencerRecord>;
}) {
    const record = monitor.record?.sequencer.toLowerCase() === sequencer.toLowerCase()
        ? monitor.record
        : null;
    const timelineRef = useRef<HTMLDivElement | null>(null);
    const scrolledSequencerRef = useRef<string | null>(null);
    const events = record?.events ?? [];
    const summary = summarizeRecord(events);
    const timing = record?.protocol
        ? protocolTiming(record.protocol)
        : null;

    useEffect(() => {
        if (!record || !timelineRef.current || scrolledSequencerRef.current === sequencer) return;
        scrolledSequencerRef.current = sequencer;
        timelineRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [record, sequencer]);

    if (monitor.isLoading && !record) {
        return (
            <div className="mt-5 border-5 border-aqua bg-lapis p-6 text-sm font-black text-aqua shadow-brutal-aqua" aria-live="polite">
                Loading sequencer record…
            </div>
        );
    }

    return (
        <div className="mt-5 space-y-5">
            <section className="border-5 border-chartreuse bg-malachite p-4 shadow-brutal-chartreuse sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-chartreuse">Sequencer</div>
                        <SequencerAddressControl
                            address={sequencer}
                            full
                            showCopy
                            className="font-mono text-sm font-black text-whisper-white sm:text-base"
                            containerClassName="mt-2"
                        />
                    </div>
                    <span className={`self-start border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${summary.color}`}>
                        {summary.label}
                    </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <RecordStat label="Events" value={events.length.toString()} />
                    <RecordStat label="L1" value={summary.confirmed.toString()} />
                    <RecordStat label="Pending" value={summary.pending.toString()} />
                </div>
                {record?.protocol && (
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-whisper-white/60">
                        <span>Slot {record.protocol.currentSlot}</span>
                        <span>Epoch {record.protocol.currentEpoch}</span>
                        <span>Round {record.protocol.currentRound}</span>
                        <span>Snapshot {formatJournalTime(record.protocol.observedAt)}</span>
                    </div>
                )}
            </section>

            {monitor.error && (
                <div className="border-3 border-vermillion bg-brand-black p-4 text-sm font-bold text-vermillion" role="alert">
                    {monitor.error}
                    <button type="button" onClick={() => void monitor.refresh()} className="ml-3 underline underline-offset-4">
                        Retry
                    </button>
                </div>
            )}

            {timing && record?.protocol ? (
                <SlashingProcess
                    timing={timing}
                    pause={{
                        active: !record.protocol.isSlashingEnabled,
                        endsAt: pauseEndDate(record.protocol),
                        durationSeconds: record.protocol.pauseDurationSeconds,
                    }}
                    title="How this record progresses"
                />
            ) : (
                <p className="border-3 border-aqua bg-brand-black p-4 text-xs font-bold text-whisper-white/70">
                    Live protocol timing is unavailable. Journaled events remain visible below.
                </p>
            )}

            <div id="sequencer-record-timeline" ref={timelineRef} className="scroll-mt-4">
                <RecordTimeline events={events} />
            </div>

            {record?.nextCursor && (
                <button
                    type="button"
                    onClick={() => void monitor.loadOlder()}
                    disabled={monitor.isLoadingMore}
                    className="brutal-button brutal-button--aqua brutal-button--lg w-full"
                >
                    {monitor.isLoadingMore ? 'Loading…' : 'Load older events'}
                </button>
            )}
        </div>
    );
}

function RecordStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-3 border-chartreuse bg-brand-black px-2 py-3">
            <div className="text-lg font-black text-whisper-white">{value}</div>
            <div className="text-[0.65rem] font-black uppercase text-chartreuse">{label}</div>
        </div>
    );
}

function RecordTimeline({ events }: { events: MonitorEvent[] }) {
    if (events.length === 0) {
        return (
            <section className="border-5 border-aqua bg-lapis p-5 shadow-brutal-aqua">
                <h3 className="text-xl font-black text-aqua">Timeline</h3>
                <p className="mt-3 border-3 border-aqua bg-brand-black p-4 text-sm font-bold text-whisper-white/75">
                    No events have been journaled for this address.
                </p>
            </section>
        );
    }
    return (
        <section className="border-5 border-aqua bg-lapis p-4 shadow-brutal-aqua sm:p-5">
            <div className="mb-5 flex items-end justify-between gap-3">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-aqua">Newest first</div>
                    <h3 className="mt-1 text-2xl font-black text-whisper-white">Timeline</h3>
                </div>
                <span className="text-xs font-bold text-whisper-white/60">{events.length} loaded</span>
            </div>
            <ol className="ml-3 border-l-5 border-aqua pl-5 sm:ml-5 sm:pl-7">
                {events.map((event) => {
                    const stage = getEventVisual(event.type);
                    const facts = recordEventFacts(event);
                    return (
                        <li key={event.id} className="relative pb-4 last:pb-0">
                            <span className={`absolute -left-[2.15rem] top-3 h-4 w-4 border-3 border-brand-black sm:-left-[2.65rem] ${stage.dot}`} />
                            <article className={`border-3 bg-brand-black p-4 ${stage.border}`}>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <span className={`text-[0.65rem] font-black uppercase tracking-[0.15em] ${stage.text}`}>
                                            {stage.label}
                                        </span>
                                        <h4 className="mt-1 text-base font-black text-whisper-white">{getEventTitle(event)}</h4>
                                    </div>
                                    <span className="text-right text-[0.68rem] font-bold text-whisper-white/55">
                                        {formatJournalTime(event.occurredAt)}
                                    </span>
                                </div>
                                <p className="mt-3 text-sm font-bold text-whisper-white/75">
                                    {recordEventSummary(event)}
                                </p>
                                {facts.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {facts.map((fact) => (
                                            <span key={fact} className="border-2 border-whisper-white/25 px-2 py-1 text-[0.68rem] font-bold text-whisper-white/65">
                                                {fact}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </article>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

function protocolTiming(protocol: SlashingProtocolSnapshot): SlashingProcessTiming {
    return {
        slashOffsetRounds: protocol.slashOffsetRounds,
        roundSizeSlots: protocol.roundSizeSlots,
        roundSizeEpochs: protocol.roundSizeEpochs,
        quorum: protocol.quorum,
        roundDurationSeconds: protocol.roundDurationSeconds,
        executionDelayRounds: protocol.executionDelayRounds,
        executionDelaySeconds: protocol.executionDelaySeconds,
        executionWindowRounds: protocol.lifetimeRounds - protocol.executionDelayRounds,
        executionWindowSeconds: protocol.executionWindowSeconds,
        inactivity: protocol.inactivity,
    };
}

function pauseEndDate(protocol: SlashingProtocolSnapshot): string | null {
    if (!protocol.slashingDisabledUntil) return null;
    const milliseconds = Number(protocol.slashingDisabledUntil) * 1_000;
    if (!Number.isSafeInteger(milliseconds)) return null;
    try {
        return new Date(milliseconds).toISOString();
    } catch {
        return null;
    }
}

function summarizeRecord(events: MonitorEvent[]) {
    const confirmed = events.filter((event) => event.certainty === 'confirmed').length;
    const pending = events.length - confirmed;
    const latestSlashState = events.find((event) =>
        ['l1_slash_confirmed', 'l1_slash_reconfirmed', 'l1_slash_reorged'].includes(event.type));
    if (latestSlashState && latestSlashState.type !== 'l1_slash_reorged') {
        return { label: 'Slash confirmed', color: 'bg-vermillion', confirmed, pending };
    }
    const latestRounds = new Map<string, MonitorEvent>();
    for (const event of events) {
        if (event.l1?.round && !latestRounds.has(event.l1.round)) {
            latestRounds.set(event.l1.round, event);
        }
    }
    const open = [...latestRounds.values()].find((event) => [
        'onchain_vote_targeted',
        'onchain_targeted',
        'onchain_payload_changed',
        'onchain_executable',
        'onchain_executable_after_pause',
        'onchain_execution_paused',
    ].includes(event.type));
    if (open) return { label: 'Open L1 path', color: 'bg-vermillion', confirmed, pending };
    if (pending > 0) return { label: 'Node signals', color: 'bg-orchid', confirmed, pending };
    return {
        label: events.length > 0 ? 'No open payload' : 'No events',
        color: events.length > 0 ? 'bg-aqua' : 'bg-chartreuse',
        confirmed,
        pending,
    };
}

export function recordEventSummary(event: MonitorEvent): string {
    const offense = event.offense;
    if (event.type === 'inactivity_first_miss') {
        return `Missed duty${offense?.slot ? ` at slot ${offense.slot}` : ''}. This is precursor evidence only.`;
    }
    if (event.type === 'inactivity_epoch_completed') {
        return event.body || 'The inactivity threshold was evaluated for this epoch.';
    }
    if (event.type.startsWith('pending_offense_')) {
        const position = offense?.epoch
            ? `epoch ${offense.epoch}`
            : offense?.epochOrSlot
                ? `${offense.timeUnit ?? 'position'} ${offense.epochOrSlot}`
                : 'this position';
        return `Node registered ${humanize(offense?.reason ?? 'an offense')} for ${position}. No L1 action yet.`;
    }
    if (event.type === 'onchain_vote_targeted') {
        return 'At least one L1 vote named this address. Quorum has not created a payload yet.';
    }
    if (event.type === 'onchain_targeted') {
        return `This address entered the round’s quorum payload${event.l1?.executableAt ? `; execution opens ${formatJournalTime(event.l1.executableAt)}` : ''}.`;
    }
    if (event.type === 'onchain_payload_changed') {
        return 'The payload changed. Any veto on its prior address does not carry over.';
    }
    if (event.type === 'onchain_executable') {
        return `Execution is open${event.l1?.expiryAt ? ` until ${formatJournalTime(event.l1.expiryAt)}` : ''}.`;
    }
    if (event.type === 'onchain_executable_after_pause' || event.type === 'onchain_execution_paused') {
        return `The global pause blocks execution; the ${event.l1?.expiryAt ? `${formatJournalTime(event.l1.expiryAt)} ` : ''}expiry is unchanged.`;
    }
    if (event.type === 'onchain_pause_protected') {
        return 'The scheduled pause lasts through this payload’s expiry.';
    }
    if (event.type === 'onchain_vetoed') return 'The vetoer blocked this payload.';
    if (event.type === 'onchain_veto_reverted') return 'The current payload is no longer vetoed.';
    if (event.type === 'onchain_expired') return 'The execution window closed without execution.';
    if (event.type === 'onchain_executed') {
        return 'The round executed. A Slashed log separately proves how much stake was removed.';
    }
    if (event.type === 'l1_slash_confirmed' || event.type === 'l1_slash_reconfirmed') {
        return `${formatAztec(event.l1?.amount)} AZTEC removed in a confirmed L1 block.`;
    }
    if (event.type === 'l1_slash_reorged') {
        return 'The earlier slash log is no longer on the canonical L1 chain.';
    }
    return event.body || humanize(event.type);
}

function recordEventFacts(event: MonitorEvent): string[] {
    const facts: string[] = [];
    if (event.offense?.epoch) facts.push(`Epoch ${event.offense.epoch}`);
    if (event.offense?.proposalRound) facts.push(`Vote round ${event.offense.proposalRound}`);
    if (event.l1?.round) facts.push(`Round ${event.l1.round}`);
    if (event.l1?.targetEpochs.length) {
        const epochs = event.l1.targetEpochs;
        facts.push(epochs.length === 1
            ? `Epoch ${epochs[0]}`
            : `Epochs ${epochs[0]}–${epochs[epochs.length - 1]}`);
    }
    const proposed = event.l1?.actions.find((action) =>
        event.targets.some((target) => target.toLowerCase() === action.sequencer.toLowerCase()))?.amount;
    if (proposed) facts.push(`${formatAztec(proposed)} AZTEC proposed`);
    return facts;
}

function formatAztec(value: string | null | undefined): string {
    if (!value) return 'Unknown';
    try {
        const amount = BigInt(value);
        const whole = amount / 10n ** 18n;
        const fraction = (amount % 10n ** 18n)
            .toString()
            .padStart(18, '0')
            .slice(0, 3)
            .replace(/0+$/, '');
        return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString();
    } catch {
        return value;
    }
}

function humanize(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
