import type { ExecutionHistoryScan } from '@/types/slashing';

// Monitor-only progress card for the browser-side execution-history scan.
export function ExecutionHistoryStatus({ scan }: { scan: ExecutionHistoryScan }) {
    const percentage = scan.totalBlocks === 0n
        ? 100
        : Math.min(
            100,
            Number(scan.scannedBlocks * 10_000n / scan.totalBlocks) / 100,
        );
    const paused = scan.status === 'paused';
    return (
        <section className={`mb-8 border-5 p-4 ${
            paused
                ? 'border-orchid bg-aubergine shadow-brutal-orchid'
                : 'border-aqua bg-lapis shadow-brutal-aqua'
        }`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className={`text-lg font-black ${
                    paused ? 'text-orchid' : 'text-aqua'
                }`}>
                    {paused
                        ? 'Execution history paused'
                        : 'Scanning execution history'}
                </h2>
                <span className="font-mono text-xs font-black text-whisper-white/65">
                    {scan.scannedBlocks.toString()} / {scan.totalBlocks.toString()} blocks
                </span>
            </div>
            <div
                role="progressbar"
                aria-label="Execution history scan coverage"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage}
                className="mt-3 h-4 border-3 border-whisper-white/40 bg-brand-black"
            >
                <div
                    className={`h-full ${
                        paused ? 'bg-orchid' : 'bg-aqua'
                    }`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
            <p className="mt-2 text-xs font-bold text-whisper-white/65">
                RPC chunk {scan.chunkSize.toString()} blocks
                {paused ? ' · The next refresh will retry, or you can use another RPC.' : ''}
            </p>
        </section>
    );
}
