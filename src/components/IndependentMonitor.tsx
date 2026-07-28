import { useMemo } from 'react';
import type { Address } from 'viem';
import { CaseList } from '@/components/cases';
import { useIndependentMonitor } from '@/hooks/useIndependentMonitor';
import type { MonitorConfigInput } from '@/types/slashing';
import { MonitorDetails } from './MonitorDetails';
import { ValidatorSearch } from './ValidatorSearch';
import { ConfirmedSlashes } from './ConfirmedSlashes';

interface IndependentMonitorProps {
    configInput: MonitorConfigInput;
    network: 'mainnet' | 'testnet';
    selectedValidator: Address | null;
    onSelectValidator: (validator: Address | null) => void;
    onOpenLive: () => void;
    onResetRpc: () => void;
    onToggleNetwork: () => void;
    onUpdateRpc: (url: string) => void;
}

export function IndependentMonitor({
    configInput,
    network,
    selectedValidator,
    onSelectValidator,
    onOpenLive,
    onResetRpc,
    onToggleNetwork,
    onUpdateRpc,
}: IndependentMonitorProps) {
    const monitor = useIndependentMonitor(configInput);
    const cases = monitor.snapshot?.cases;
    const visibleCases = useMemo(() => {
        if (!selectedValidator) return cases ?? [];
        const normalized = selectedValidator.toLowerCase();
        return (cases ?? []).filter((slashingCase) =>
            slashingCase.targets.some((target) =>
                target.validator.toLowerCase() === normalized));
    }, [cases, selectedValidator]);
    const openCases = (cases ?? []).filter((slashingCase) => slashingCase.state.kind === 'phase');

    return (
        <div className="space-y-8">
            <section className="border-6 border-aqua bg-lapis p-5 shadow-brutal-aqua sm:p-7">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-aqua">
                            Backend-independent fallback
                        </div>
                        <h1 className="mt-2 text-3xl font-black text-whisper-white sm:text-4xl">
                            Independent Ethereum check
                        </h1>
                        <p className="mt-3 text-sm font-bold leading-relaxed text-whisper-white/80 sm:text-base">
                            Your browser reads the canonical Aztec contracts through public Ethereum RPCs.
                            No Slashmon backend or account is used. Offchain offense reasons and alerts are unavailable here.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <span className="border-3 border-brand-black bg-aqua px-3 py-3 text-xs font-black uppercase text-brand-black">
                            {network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia testnet'}
                        </span>
                        <button
                            type="button"
                            onClick={() => void monitor.refresh()}
                            disabled={monitor.isLoading || monitor.isRefreshing}
                            className="brutal-button brutal-button--aqua"
                        >
                            {monitor.isRefreshing ? 'Refreshing…' : 'Refresh now'}
                        </button>
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t-3 border-aqua/50 pt-4 text-xs font-bold text-whisper-white/70">
                    <span>
                        {monitor.snapshot
                            ? `Pinned at Ethereum block ${monitor.snapshot.protocol.blockNumber}`
                            : 'Waiting for an Ethereum snapshot'}
                    </span>
                    <span>
                        {monitor.snapshot
                            ? `Observed ${formatDate(monitor.snapshot.observedAt)}`
                            : 'No data shown until the first read succeeds'}
                    </span>
                    {monitor.snapshot && (
                        <span>
                            {monitor.snapshot.protocol.confirmationDepth}-block confirmation depth
                        </span>
                    )}
                    <span>Automatic refresh every 3 minutes</span>
                </div>
            </section>

            {monitor.error && (
                <section className="border-5 border-vermillion bg-oxblood p-5 shadow-brutal-vermillion" role="alert">
                    <h2 className="text-2xl font-black text-vermillion">Independent check unavailable</h2>
                    <p className="mt-2 break-words text-sm font-bold text-whisper-white">{monitor.error}</p>
                    <div className="mt-5 flex flex-wrap gap-3">
                        <button type="button" onClick={() => void monitor.refresh()} className="brutal-button brutal-button--danger">
                            Retry RPC
                        </button>
                        <button type="button" onClick={onOpenLive} className="brutal-button brutal-button--aqua">
                            Open live monitor
                        </button>
                    </div>
                </section>
            )}

            {monitor.isLoading && !monitor.snapshot && (
                <section className="border-5 border-chartreuse bg-malachite p-6 shadow-brutal-chartreuse" aria-live="polite">
                    <h2 className="text-xl font-black text-chartreuse">Reading canonical contracts…</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white/75">
                        No result is assumed while the browser resolves the Rollup, active slasher, and any authorized legacy slasher.
                    </p>
                </section>
            )}

            {monitor.snapshot && (
                <>
                    <section className="grid gap-3 sm:grid-cols-3" aria-label="Current protocol snapshot">
                        <SnapshotFact label="Current round" value={monitor.snapshot.protocol.currentRound.toString()} />
                        <SnapshotFact label="Open cases" value={openCases.length.toString()} />
                        <SnapshotFact label="Cases in scan window" value={(cases?.length ?? 0).toString()} />
                    </section>

                    {monitor.snapshot.issues.length > 0 && (
                        <section className="border-5 border-vermillion bg-oxblood p-5 shadow-brutal-vermillion" role="status">
                            <h2 className="text-xl font-black text-vermillion">Partial Ethereum coverage</h2>
                            <p className="mt-2 text-sm font-bold text-whisper-white">
                                {monitor.snapshot.issues[0]}
                            </p>
                            {monitor.snapshot.issues.length > 1 && (
                                <details className="mt-3 border-3 border-vermillion bg-brand-black p-3">
                                    <summary className="cursor-pointer text-xs font-black uppercase text-vermillion">
                                        {monitor.snapshot.issues.length - 1} more issue{monitor.snapshot.issues.length === 2 ? '' : 's'}
                                    </summary>
                                    <ul className="mt-3 list-square space-y-2 pl-5 text-xs font-bold text-whisper-white/75">
                                        {monitor.snapshot.issues.slice(1).map((issue) => <li key={issue}>{issue}</li>)}
                                    </ul>
                                </details>
                            )}
                        </section>
                    )}

                    <ValidatorSearch
                        value={selectedValidator}
                        onChange={onSelectValidator}
                        label="Filter this L1 snapshot"
                        description="Show only rounds whose current tally targets this validator. This page has no offchain offense evidence."
                    />

                    {selectedValidator && visibleCases.length === 0 ? (
                        <section className="border-5 border-aqua bg-lapis p-5 shadow-brutal-aqua">
                            <h2 className="text-xl font-black text-aqua">No matching L1 case</h2>
                            <p className="mt-2 break-all font-mono text-sm font-bold text-whisper-white">
                                {selectedValidator}
                            </p>
                            <p className="mt-2 text-sm font-bold text-whisper-white/70">
                                No scanned round currently names this validator. This is not a statement about offchain behavior or future rounds.
                            </p>
                        </section>
                    ) : (
                        <CaseList
                            cases={visibleCases}
                            title={selectedValidator ? 'Cases for this validator' : 'Ethereum slashing cases'}
                        />
                    )}

                    <ConfirmedSlashes
                        network={network}
                        selectedValidator={selectedValidator}
                        slashes={monitor.snapshot.recentSlashes.map((slash) => ({
                            id: `${slash.chainId}:${slash.blockHash}:${slash.transactionHash}:${slash.validator.toLowerCase()}`,
                            validator: slash.validator,
                            actualAmount: slash.actualAmount,
                            logCount: slash.logCount,
                            blockNumber: slash.blockNumber,
                            transactionHash: slash.transactionHash,
                        }))}
                        coverage={slashReceiptCoverageText(
                            monitor.snapshot.slashReceiptCoverage,
                        )}
                        coverageIsPartial={monitor.snapshot.slashReceiptCoverage.status !== 'complete'}
                    />
                </>
            )}

            <MonitorDetails
                key={configInput.chainId}
                configInput={configInput}
                network={network}
                snapshot={monitor.snapshot}
                onResetRpc={onResetRpc}
                onToggleNetwork={onToggleNetwork}
                onUpdateRpc={onUpdateRpc}
            />
        </div>
    );
}

function SnapshotFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-5 border-chartreuse bg-malachite p-4 shadow-brutal-chartreuse">
            <div className="text-xs font-black uppercase text-chartreuse">{label}</div>
            <div className="mt-1 text-2xl font-black text-whisper-white">{value}</div>
        </div>
    );
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString();
}

function slashReceiptCoverageText(
    coverage: {
        status: 'complete' | 'partial' | 'unavailable';
        fromBlock: bigint;
        toBlock: bigint;
    },
): string {
    const range = `${coverage.fromBlock}–${coverage.toBlock}`;
    if (coverage.status === 'complete') {
        return `Slashed logs from the current canonical Rollup were checked in Ethereum blocks ${range}.`;
    }
    if (coverage.status === 'partial') {
        return `Some Ethereum blocks in ${range} could not be checked for Slashed logs from the current canonical Rollup.`;
    }
    return `No Ethereum block in ${range} could be checked for Slashed logs from the current canonical Rollup.`;
}
