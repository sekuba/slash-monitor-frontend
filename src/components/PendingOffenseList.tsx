import { SequencerAddressLink } from './SequencerAddressLink';
import type { PendingOffense } from '@/types/v2Api';

interface PendingOffenseListProps {
    offenses: PendingOffense[];
    hasWatchlistCapability: boolean;
}

export function PendingOffenseList({ offenses, hasWatchlistCapability }: PendingOffenseListProps) {
    const active = hasWatchlistCapability
        ? offenses.filter((offense) => offense.status === 'active')
        : [];

    return (
        <section className="border-5 border-orchid bg-aubergine p-5 shadow-brutal-orchid">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="mb-2 inline-flex border-3 border-brand-black bg-orchid px-3 py-1 text-xs font-black uppercase text-brand-black">
                        Early / Unconfirmed
                    </div>
                    <h2 className="text-2xl font-black text-orchid">Pending Offenses</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white">
                        {hasWatchlistCapability
                            ? 'Seen by Slashmon’s Aztec node before the L1 vote settles. Useful smoke signal, not consensus truth.'
                            : 'Node-local accusations are capability-scoped, not a public feed. Save a watch list to reveal only signals targeting those addresses.'}
                    </p>
                </div>
                <span className="border-3 border-brand-black bg-orchid px-3 py-2 text-xl font-black text-brand-black">
                    {active.length}
                </span>
            </div>

            {active.length === 0 ? (
                <div className="border-3 border-orchid bg-brand-black p-4 text-sm font-bold text-whisper-white/80">
                    {hasWatchlistCapability
                        ? 'No pending offenses target this watch list in the latest successful node snapshot.'
                        : 'No watch-list key is stored in this browser, so pending node signals stay sealed.'}
                </div>
            ) : (
                <div className="space-y-3">
                    {active.map((offense) => (
                        <article key={offense.id} className="border-3 border-orchid bg-brand-black p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <h3 className="text-lg font-black text-orchid">{humanize(offense.offenseTypeName)}</h3>
                                    <SequencerAddressLink
                                        address={offense.sequencer}
                                        chars={8}
                                        className="mt-1 font-mono text-sm font-bold text-whisper-white"
                                    />
                                </div>
                                <span className="shrink-0 border-3 border-orchid bg-aubergine px-3 py-1 text-xs font-black uppercase text-orchid">
                                    Pending
                                </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-whisper-white/70">
                                {offense.epochOrSlot && (
                                    <span>{humanize(offense.timeUnit ?? 'position')}: {offense.epochOrSlot}</span>
                                )}
                                {offense.amount && <span>Amount: {formatAztec(offense.amount)} AZTEC</span>}
                                <span>Last seen: {new Date(offense.lastSeenAt).toLocaleString()}</span>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function formatAztec(value: string): string {
    try {
        const amount = BigInt(value);
        const whole = amount / 10n ** 18n;
        const fraction = (amount % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
        return fraction ? `${whole}.${fraction}` : whole.toString();
    }
    catch {
        return value;
    }
}

function humanize(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
