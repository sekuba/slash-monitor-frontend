import { useEffect, useRef } from 'react';
import { SequencerAddressLink } from './SequencerAddressLink';
import type { MonitorEvent } from '@/types/v2Api';

interface EventHistoryProps {
    events: MonitorEvent[];
    hasWatchlistCapability: boolean;
    selectedEventError?: string | null;
}

export function EventHistory({ events, hasWatchlistCapability, selectedEventError = null }: EventHistoryProps) {
    const selectedEventId = new URLSearchParams(window.location.search).get('event');
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
                        L1 Event Log
                    </div>
                    <h2 className="text-2xl font-black text-aqua">Recent Events</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white">
                        {hasWatchlistCapability
                            ? 'Events targeting this browser’s saved watch list, including its private node-local warnings.'
                            : 'Public L1 history only. Save a watch list to unlock its matching node-local warnings.'}
                    </p>
                </div>
                <span className="border-3 border-brand-black bg-aqua px-3 py-2 text-xl font-black text-brand-black">
                    {events.length}
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
                        : 'No public L1 slashing events have been journaled yet.'}
                </div>
            ) : (
                <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                    {events.map((event) => {
                        const pending = event.certainty === 'pending';
                        const selected = event.id === selectedEventId;
                        return (
                            <article
                                key={event.id}
                                id={`event-${event.id}`}
                                className={`border-3 bg-brand-black p-4 ${
                                    selected ? 'border-chartreuse shadow-brutal-chartreuse' : pending ? 'border-orchid' : 'border-aqua'
                                }`}
                            >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <h3 className={`text-base font-black ${pending ? 'text-orchid' : 'text-aqua'}`}>
                                            {event.title}
                                        </h3>
                                        {event.targets.length > 0 && (
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                {event.targets.slice(0, 3).map((target) => (
                                                    <SequencerAddressLink
                                                        key={target}
                                                        address={target}
                                                        chars={6}
                                                        className="font-mono text-xs font-bold text-whisper-white"
                                                    />
                                                ))}
                                                {event.targets.length > 3 && (
                                                    <span className="text-xs font-black text-whisper-white/60">+{event.targets.length - 3} more</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <span className={`shrink-0 border-3 border-brand-black px-2 py-1 text-xs font-black uppercase text-brand-black ${pending ? 'bg-orchid' : 'bg-aqua'}`}>
                                        {pending ? 'Pending' : 'Onchain'}
                                    </span>
                                </div>
                                {event.body && <p className="mt-3 text-sm font-bold text-whisper-white/80">{event.body}</p>}
                                <p className="mt-3 text-xs font-bold text-whisper-white/60">
                                    {new Date(event.occurredAt).toLocaleString()} · {event.source} · {humanize(event.type)}
                                </p>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function humanize(value: string): string {
    return value.replace(/[_-]+/g, ' ');
}
