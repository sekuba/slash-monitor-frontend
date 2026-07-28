import { useId } from 'react';
import type { Address, Hash } from 'viem';
import { formatAztec } from '@/lib/formatToken';
import type { MonitorNetwork } from '@/types/api';

export interface ConfirmedSlashItem {
    id: string;
    validator: Address;
    actualAmount: bigint;
    logCount: number;
    blockNumber: bigint;
    transactionHash: Hash;
}

interface ConfirmedSlashesProps {
    network: MonitorNetwork;
    slashes: readonly ConfirmedSlashItem[];
    selectedValidator?: Address | null;
    coverage: string;
    coverageIsPartial?: boolean;
    emptyMessage?: string;
}

export function ConfirmedSlashes({
    network,
    slashes,
    selectedValidator,
    coverage,
    coverageIsPartial = false,
    emptyMessage,
}: ConfirmedSlashesProps) {
    const headingId = useId();
    const normalized = selectedValidator?.toLowerCase();
    const visible = normalized
        ? slashes.filter((slash) => slash.validator.toLowerCase() === normalized)
        : slashes;
    const explorer = network === 'testnet'
        ? 'https://sepolia.etherscan.io'
        : 'https://etherscan.io';

    return (
        <section aria-labelledby={headingId}>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-vermillion">
                        Rollup Slashed logs
                    </div>
                    <h2 id={headingId} className="mt-1 text-3xl font-black text-whisper-white">
                        Confirmed token loss
                    </h2>
                </div>
                <span className="border-3 border-brand-black bg-vermillion px-3 py-2 text-xs font-black uppercase text-brand-black">
                    {visible.length} shown
                </span>
            </div>
            <p className={`mb-4 border-3 bg-brand-black p-3 text-xs font-bold ${coverageIsPartial ? 'border-vermillion text-vermillion' : 'border-aqua text-whisper-white/70'}`}>
                {coverage}
            </p>

            {visible.length === 0 ? (
                <p className="border-5 border-aqua bg-lapis p-5 text-sm font-bold text-whisper-white shadow-brutal-aqua">
                    {emptyMessage ?? (
                        <>
                            {normalized
                                ? 'No confirmed Slashed log for this validator was found in the stated block range.'
                                : 'No confirmed Slashed log was found in the stated block range.'}
                            {coverageIsPartial ? ' Some blocks could not be checked.' : ''}
                        </>
                    )}
                </p>
            ) : (
                <div className="grid gap-4">
                    {visible.map((slash) => (
                        <article key={slash.id} className="border-5 border-vermillion bg-oxblood p-4 shadow-brutal-vermillion sm:p-5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <div className="text-xs font-black uppercase text-vermillion">
                                        Slash confirmed on Ethereum
                                    </div>
                                    <div className="mt-1 text-2xl font-black text-whisper-white">
                                        {formatAztec(slash.actualAmount)} AZTEC removed
                                    </div>
                                </div>
                                <span className="self-start border-3 border-brand-black bg-vermillion px-3 py-2 text-xs font-black uppercase text-brand-black">
                                    {slash.logCount} log{slash.logCount === 1 ? '' : 's'}
                                </span>
                            </div>
                            <a
                                href={`${explorer}/address/${slash.validator}`}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-4 block break-all font-mono text-sm font-black text-whisper-white underline decoration-aqua decoration-2 underline-offset-4"
                            >
                                {slash.validator}
                            </a>
                            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-whisper-white/70">
                                <a
                                    href={`${explorer}/tx/${slash.transactionHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-aqua underline decoration-2 underline-offset-4"
                                >
                                    Transaction
                                </a>
                                <a
                                    href={`${explorer}/block/${slash.blockNumber}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-aqua underline decoration-2 underline-offset-4"
                                >
                                    Block {slash.blockNumber.toString()}
                                </a>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
