import { formatAztec } from '@/lib/formatToken';
import type { NodeOffense } from '@/types/api';

export function NodeObservations({ offenses }: { offenses: readonly NodeOffense[] }) {
    return (
        <section aria-labelledby="node-observations-heading">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-orchid">
                        Offchain node evidence
                    </div>
                    <h2 id="node-observations-heading" className="mt-1 text-3xl font-black text-whisper-white">
                        Node observations
                    </h2>
                </div>
                <span className="border-3 border-brand-black bg-orchid px-3 py-2 text-xs font-black uppercase text-brand-black">
                    {offenses.length} shown
                </span>
            </div>

            {offenses.length === 0 ? (
                <p className="border-5 border-orchid bg-aubergine p-5 text-sm font-bold text-whisper-white shadow-brutal-orchid">
                    This hosted Aztec node has no retained offense observation for this validator.
                    That is not proof of faultless behavior across other nodes.
                </p>
            ) : (
                <div className="grid gap-4">
                    {offenses.map((offense) => (
                        <article key={offense.id} className="border-5 border-orchid bg-aubergine p-4 shadow-brutal-orchid sm:p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="text-xs font-black uppercase text-orchid">
                                        {positionLabel(offense.timeUnit, offense.epochOrSlot)}
                                    </div>
                                    <h3 className="mt-1 text-xl font-black text-whisper-white">
                                        {humanize(offense.offenseTypeName)}
                                    </h3>
                                </div>
                                <span className={`border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${offense.status === 'active' ? 'bg-orchid' : 'bg-aqua'}`}>
                                    {offense.status === 'active' ? 'Currently reported' : 'Resolved locally'}
                                </span>
                            </div>
                            <p className="mt-3 text-sm font-bold leading-relaxed text-whisper-white/80">
                                This monitor’s Aztec node recorded this offense. It is local evidence,
                                not an Ethereum vote or slash request.
                            </p>
                            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                                <Fact
                                    label="Node-configured penalty"
                                    value={`${formatAztec(offense.configuredPenalty)} AZTEC`}
                                />
                                <Fact label="First observed" value={formatDate(offense.firstObservedAt)} />
                                <Fact
                                    label={offense.resolvedAt ? 'Resolved' : 'Last observed'}
                                    value={formatDate(offense.resolvedAt ?? offense.lastObservedAt)}
                                />
                            </dl>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-3 border-whisper-white/25 bg-brand-black p-3">
            <dt className="text-xs font-black uppercase text-orchid">{label}</dt>
            <dd className="mt-1 text-sm font-bold text-whisper-white">{value}</dd>
        </div>
    );
}

function humanize(value: string): string {
    return value
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString();
}

function positionLabel(
    unit: NodeOffense['timeUnit'],
    value: string,
): string {
    return unit === 'unknown'
        ? `Position ${value}`
        : `${unit} ${value}`;
}
