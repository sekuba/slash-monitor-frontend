import type { Address } from 'viem';
import { apiCasesToDomain } from '@/domain';
import { formatAztec } from '@/lib/formatToken';
import { formatHostedSlashCoverage } from '@/lib/hostedCoverage';
import { useHostedMonitor } from '@/hooks/useHostedMonitor';
import { CaseList } from './cases';
import { ConfirmedSlashes } from './ConfirmedSlashes';
import { ValidatorRecord } from './ValidatorRecord';
import { ValidatorSearch } from './ValidatorSearch';
import { WatchlistPanel } from './WatchlistPanel';

interface LiveMonitorProps {
    selectedValidator: Address | null;
    onSelectValidator: (validator: Address | null) => void;
    onOpenIndependent: () => void;
}

export function LiveMonitor({
    selectedValidator,
    onSelectValidator,
    onOpenIndependent,
}: LiveMonitorProps) {
    const monitor = useHostedMonitor();
    const snapshot = monitor.snapshot;
    const network = monitor.config?.network ??
        snapshot?.network ??
        monitor.status?.network ??
        'mainnet';
    const cases = snapshot
        ? apiCasesToDomain(snapshot.cases, snapshot.protocol, snapshot.network)
        : [];
    const openCases = cases.filter((slashingCase) => slashingCase.state.kind === 'phase');
    const canonicalSlashes = snapshot?.slashes.confirmed ?? [];
    const confirmedAmount = canonicalSlashes.reduce(
        (total, slash) => total + BigInt(slash.actualAmount),
        0n,
    );
    const expectedNetwork = monitor.config?.network ??
        snapshot?.network ??
        monitor.status?.network;
    const networkMismatch = Boolean(expectedNetwork && (
        (monitor.config && monitor.config.network !== expectedNetwork) ||
        (snapshot && snapshot.network !== expectedNetwork) ||
        (monitor.status && monitor.status.network !== expectedNetwork)
    ));

    return (
        <div className="space-y-8">
            <section className="border-6 border-chartreuse bg-malachite p-5 shadow-brutal-chartreuse sm:p-7">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-chartreuse">
                            Hosted monitor &amp; notifications
                        </div>
                        <h1 className="mt-2 text-3xl font-black text-whisper-white sm:text-4xl">
                            Live Aztec slashing state
                        </h1>
                        <p className="mt-3 text-sm font-bold leading-relaxed text-whisper-white/80 sm:text-base">
                            A dedicated backend combines pinned Ethereum state, this monitor’s Aztec node observations,
                            confirmed Rollup slash logs, and opt-in alerts. Each fact keeps its source and certainty.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <span className="border-3 border-brand-black bg-chartreuse px-3 py-3 text-xs font-black uppercase text-brand-black">
                            {network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia testnet'}
                        </span>
                        <button
                            type="button"
                            onClick={() => void monitor.refresh()}
                            disabled={monitor.isLoading || monitor.isRefreshing}
                            className="brutal-button"
                        >
                            {monitor.isRefreshing ? 'Refreshing…' : 'Refresh now'}
                        </button>
                    </div>
                </div>
                <HostedFreshness monitor={monitor} />
            </section>

            {(monitor.error || networkMismatch) && (
                <section className="border-5 border-vermillion bg-oxblood p-5 shadow-brutal-vermillion" role="alert">
                    <h2 className="text-2xl font-black text-vermillion">
                        {snapshot ? 'Hosted data may be stale' : 'Hosted monitor unavailable'}
                    </h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white">
                        {networkMismatch
                            ? 'The backend returned inconsistent network identities, so its snapshot is not trusted.'
                            : monitor.error}
                    </p>
                    {snapshot && (
                        <p className="mt-2 text-xs font-bold text-whisper-white/65">
                            {snapshot.coverage.cases.observedAt
                                ? `The last Ethereum case snapshot from ${new Date(snapshot.coverage.cases.observedAt).toLocaleString()} remains visible below.`
                                : 'The last returned hosted result remains visible below, but it has no successful Ethereum case snapshot yet.'}
                        </p>
                    )}
                    <div className="mt-5 flex flex-wrap gap-3">
                        <button type="button" onClick={() => void monitor.refresh()} className="brutal-button brutal-button--danger">
                            Retry backend
                        </button>
                        <button type="button" onClick={onOpenIndependent} className="brutal-button brutal-button--aqua">
                            Check Ethereum independently
                        </button>
                    </div>
                </section>
            )}

            {monitor.isLoading && !snapshot && (
                <section className="border-5 border-aqua bg-lapis p-6 shadow-brutal-aqua" aria-live="polite">
                    <h2 className="text-xl font-black text-aqua">Connecting to the hosted monitor…</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white/75">
                        No empty result is shown until a valid backend response arrives.
                    </p>
                </section>
            )}

            {snapshot && !networkMismatch && (
                <>
                    {!snapshot.coverage.cases.complete && (
                        <section className="border-5 border-orchid bg-aubergine p-5 shadow-brutal-orchid" role="status">
                            <h2 className="text-xl font-black text-orchid">Partial Ethereum case coverage</h2>
                            <p className="mt-2 text-sm font-bold text-whisper-white/75">
                                {caseCoverageWarning(
                                    snapshot.coverage.cases.observedAt,
                                    snapshot.coverage.cases.blockNumber,
                                )}
                            </p>
                        </section>
                    )}
                    <section className="grid gap-3 sm:grid-cols-3" aria-label="Current hosted snapshot">
                        <SnapshotFact
                            label="Current round"
                            value={snapshot.protocol?.currentRound ?? 'Unavailable'}
                        />
                        <SnapshotFact label="Shown open L1 cases" value={openCases.length.toString()} />
                        <SnapshotFact
                            label="Shown confirmed loss"
                            value={`${formatAztec(confirmedAmount)} AZTEC`}
                        />
                    </section>

                    <ValidatorSearch
                        value={selectedValidator}
                        onChange={onSelectValidator}
                        description="Open this backend’s L1 cases, local node observations, and confirmed slash outcomes for one validator."
                    />

                    {selectedValidator ? (
                        <ValidatorRecord
                            address={selectedValidator}
                            network={snapshot.network}
                            protocol={snapshot.protocol}
                            slashCoverage={snapshot.coverage.slashes}
                        />
                    ) : snapshot.protocol ? (
                        <CaseList cases={cases} title="Ethereum slashing cases" />
                    ) : (
                        <p className="border-5 border-vermillion bg-oxblood p-5 text-sm font-bold text-whisper-white shadow-brutal-vermillion">
                            The backend has no complete Ethereum protocol snapshot yet. Case lifecycle states are withheld until it does.
                        </p>
                    )}

                    {monitor.config ? (
                        <WatchlistPanel
                            key={monitor.config.network}
                            config={monitor.config}
                            notificationHealth={monitor.status?.notifications.channels ?? null}
                        />
                    ) : (
                        <section id="alerts" className="border-5 border-orchid bg-aubergine p-5 shadow-brutal-orchid">
                            <h2 className="text-xl font-black text-orchid">Alerts unavailable</h2>
                            <p className="mt-2 text-sm font-bold text-whisper-white/75">
                                The backend’s public notification configuration did not load.
                            </p>
                        </section>
                    )}

                    {!selectedValidator && (
                        <>
                            <ConfirmedSlashes
                                network={snapshot.network}
                                slashes={canonicalSlashes.map((slash) => ({
                                    id: slash.id,
                                    validator: slash.address,
                                    actualAmount: BigInt(slash.actualAmount),
                                    logCount: slash.logCount,
                                    blockNumber: BigInt(slash.blockNumber),
                                    transactionHash: slash.transactionHash,
                                }))}
                                coverage={formatHostedSlashCoverage(snapshot.coverage.slashes)}
                                coverageIsPartial={!snapshot.coverage.slashes.complete}
                                emptyMessage="No canonical Slashed outcome is present in this retained hosted result."
                            />
                            {snapshot.slashes.removed.length > 0 && (
                                <p className="border-3 border-orchid bg-brand-black p-4 text-sm font-bold text-orchid">
                                    {snapshot.slashes.removed.length} retained slash confirmation{snapshot.slashes.removed.length === 1 ? ' was' : 's were'} removed by Ethereum reorganizations and excluded from confirmed loss.
                                </p>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}

function HostedFreshness({ monitor }: { monitor: ReturnType<typeof useHostedMonitor> }) {
    const status = monitor.status;
    return (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t-3 border-chartreuse/50 pt-4 text-xs font-bold text-whisper-white/70">
            <HealthBadge label="Backend" status={status?.status ?? 'unavailable'} />
            <HealthBadge label="Ethereum" status={status?.sources.l1.status ?? 'unavailable'} />
            <HealthBadge label="Aztec node" status={status?.sources.node.status ?? 'unavailable'} />
            <HealthBadge label="Alerts" status={status?.notifications.status ?? 'unavailable'} />
            <span className="ml-auto">
                {monitor.snapshot
                    ? `Cases ${coverageTime(monitor.snapshot.coverage.cases.observedAt)} · slash logs ${coverageTime(monitor.snapshot.coverage.slashes.observedAt)}`
                    : monitor.lastReceivedAt
                        ? `Last response ${new Date(monitor.lastReceivedAt).toLocaleString()}`
                        : 'Waiting for first response'}
            </span>
        </div>
    );
}

function HealthBadge({
    label,
    status,
}: {
    label: string;
    status: 'healthy' | 'degraded' | 'stale' | 'unavailable';
}) {
    const color = status === 'healthy'
        ? 'border-aqua text-aqua'
        : status === 'degraded'
            ? 'border-orchid text-orchid'
            : 'border-vermillion text-vermillion';
    return (
        <span className={`border-2 bg-brand-black px-2 py-1 uppercase ${color}`}>
            {label}: {status}
        </span>
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

function coverageTime(value: string | null): string {
    return value ? new Date(value).toLocaleString() : 'not observed';
}

function caseCoverageWarning(observedAt: string | null, blockNumber: string | null): string {
    if (!observedAt) {
        return 'The hosted case scanner has not completed a successful Ethereum snapshot. No case lifecycle claim is treated as current.';
    }
    const checkpoint = blockNumber ? ` at L1 block ${blockNumber}` : '';
    return `The case scan${checkpoint} was partial. Displayed cases omit any slashing stack or round that failed to refresh. Last successful partial scan ${new Date(observedAt).toLocaleString()}.`;
}
