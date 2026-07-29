import type { SourceStatus as Source } from '@/types/backendApi';

export function SourceStatus({ sources }: { sources: Source[] }) {
    return (
        <section className="mb-8 border-5 border-whisper-white bg-brand-black p-4 shadow-brutal sm:p-5">
            <h2 className="text-xl font-black text-whisper-white">Evidence sources</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {sources.map((source) => (
                    <div
                        key={source.source}
                        className={`border-3 p-3 ${
                            source.status === 'healthy'
                                ? 'border-chartreuse bg-malachite'
                                : 'border-vermillion bg-oxblood'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <strong className="text-sm font-black uppercase">
                                {label(source.source)}
                            </strong>
                            <span className={`text-xs font-black uppercase ${
                                source.status === 'healthy'
                                    ? 'text-chartreuse'
                                    : 'text-vermillion'
                            }`}>
                                {source.status}
                            </span>
                        </div>
                        <p className="mt-2 text-xs font-bold text-whisper-white/65">
                            {source.lastSuccessAt
                                ? `Last evidence ${new Date(source.lastSuccessAt).toLocaleString()}`
                                : 'No successful observation yet'}
                        </p>
                        {source.lastError && (
                            <p className="mt-2 break-words text-xs font-bold text-vermillion">
                                {source.lastError}
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}

function label(source: string): string {
    return {
        ethereum_l1: 'Ethereum L1',
        aztec_node: 'Aztec node offenses',
        aztec_sentinel: 'Sentinel duties',
    }[source] ?? source;
}
