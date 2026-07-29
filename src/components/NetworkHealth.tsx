import { formatAztec } from '../../shared/protocol/format.ts';
import type { NetworkSummary, ProtocolSnapshot } from '@/types/backendApi';

export function NetworkHealth({
    summary,
    protocol,
}: {
    summary: NetworkSummary;
    protocol: ProtocolSnapshot | null;
}) {
    const stats = [
        ['Early warnings', summary.precursors, 'bg-aqua'],
        ['Node offenses', summary.nodeOffenses, 'bg-orchid'],
        ['L1 support', summary.l1Supported, 'bg-chartreuse'],
        ['Candidates', summary.candidates, 'bg-vermillion'],
        ['Executable', summary.executable, 'bg-vermillion'],
        ['Actual slashes', summary.actualSlashes, 'bg-oxblood text-whisper-white'],
        ['Ejections', summary.ejections, 'bg-oxblood text-whisper-white'],
    ];
    return (
        <section className="mb-8 border-6 border-aqua bg-lapis p-5 shadow-brutal-aqua sm:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-aqua">
                        Current network health
                    </p>
                    <h2 className="mt-1 text-3xl font-black text-whisper-white">
                        Cases indexed
                    </h2>
                </div>
                <span className="border-3 border-brand-black bg-aqua px-3 py-2 text-xs font-black uppercase text-brand-black">
                    L1 block {protocol?.blockNumber ?? '—'}
                </span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                {stats.map(([label, value, color]) => (
                    <div key={String(label)} className="border-3 border-brand-black bg-brand-black p-3">
                        <strong className={`inline-block min-w-10 border-3 border-brand-black p-2 text-center text-xl font-black text-brand-black ${color}`}>
                            {String(value)}
                        </strong>
                        <p className="mt-2 text-xs font-black uppercase text-whisper-white/70">
                            {label}
                        </p>
                    </div>
                ))}
            </div>
            <p className="mt-4 text-sm font-bold text-whisper-white/75">
                Requested stake currently at risk: <strong className="text-vermillion">
                    {formatAztec(summary.stakeAtRisk)} AZTEC
                </strong>. Requested penalties and actual deductions are kept separate.
            </p>
        </section>
    );
}
