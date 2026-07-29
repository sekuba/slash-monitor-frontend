import { AddressStatus } from './AddressStatus';
import { CaseTimeline } from './CaseTimeline';
import { NetworkHealth } from './NetworkHealth';
import { SourceStatus } from './SourceStatus';
import { WatchSettings } from './WatchSettings';
import { useBackendMonitor } from '@/hooks/useBackendMonitor';
import type { MonitorNetwork } from '@/types/backendApi';

export function BackendOverview({
    network,
    selectedCaseId,
    onSelectCase,
    onOpenMonitor,
}: {
    network: MonitorNetwork;
    selectedCaseId: string | null;
    onSelectCase: (id: string | null) => void;
    onOpenMonitor: () => void;
}) {
    const monitor = useBackendMonitor(network);

    if (monitor.error || (!monitor.isLoading && !monitor.networkData)) {
        return (
            <section className="border-6 border-vermillion bg-oxblood p-6 shadow-brutal-vermillion sm:p-8" role="alert">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-vermillion">
                    PINGME unavailable
                </p>
                <h2 className="mt-2 text-3xl font-black text-whisper-white">
                    The backend did not provide current evidence
                </h2>
                <p className="mt-4 max-w-3xl break-words text-sm font-bold text-whisper-white/80">
                    {monitor.error ?? 'No current backend snapshot is available.'}
                    {' '}PINGME will not substitute cached data or silently start another collector.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                    <button type="button" onClick={onOpenMonitor} className="brutal-button">
                        Open independent L1 Monitor
                    </button>
                    <button
                        type="button"
                        onClick={() => void monitor.refresh()}
                        className="brutal-button brutal-button--neutral"
                    >
                        Retry PINGME
                    </button>
                </div>
            </section>
        );
    }

    if (monitor.isLoading || !monitor.networkData) {
        return (
            <div className="mx-auto max-w-2xl border-5 border-chartreuse bg-brand-black p-8 text-center shadow-brutal-chartreuse">
                <div className="mx-auto mb-4 h-14 w-14 animate-spin border-5 border-chartreuse border-t-transparent" />
                <p className="font-black uppercase tracking-wider text-chartreuse">
                    Loading current cases…
                </p>
            </div>
        );
    }

    const protocol = monitor.networkData.protocol;
    const watchedAddresses = monitor.watch?.addresses ?? [];
    const watchedCases = monitor.watch?.cases ?? [];
    const selectedCase = selectedCaseId
        ? monitor.networkData.cases.find((item) => item.id === selectedCaseId) ?? null
        : null;
    const degraded = monitor.status?.status !== 'healthy' ||
        monitor.status.sources.some((source) => source.status !== 'healthy');

    return (
        <>
            {degraded && (
                <section className="mb-8 border-5 border-vermillion bg-oxblood p-5 shadow-brutal-vermillion" role="status">
                    <h2 className="text-2xl font-black text-vermillion">
                        PINGME evidence is incomplete or stale
                    </h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white/80">
                        Inspect source status below. For an independent canonical L1 view,
                        use Monitor with your own public RPC.
                    </p>
                    <button type="button" onClick={onOpenMonitor} className="brutal-button mt-4">
                        Open Monitor
                    </button>
                </section>
            )}

            <NetworkHealth
                summary={monitor.networkData.summary}
                protocol={protocol}
            />

            {selectedCase && (
                <section className="mb-8">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-2xl font-black text-aqua">Linked notification case</h2>
                        <button
                            type="button"
                            onClick={() => onSelectCase(null)}
                            className="brutal-button brutal-button--sm brutal-button--neutral"
                        >
                            Clear focus
                        </button>
                    </div>
                    <CaseTimeline item={selectedCase} protocol={protocol} selected />
                </section>
            )}

            <WatchSettings network={network} config={monitor.config} />

            {watchedAddresses.length > 0 ? (
                <div className="mb-10 grid gap-8">
                    {watchedAddresses.map((address) => (
                        <AddressStatus
                            key={address}
                            address={address}
                            cases={watchedCases.filter(
                                (item) => item.sequencer === address.toLowerCase(),
                            )}
                            protocol={protocol}
                            selectedCaseId={selectedCaseId}
                            onSelectCase={onSelectCase}
                        />
                    ))}
                </div>
            ) : (
                <section className="mb-8 border-5 border-orchid bg-aubergine p-6 shadow-brutal-orchid">
                    <h2 className="text-2xl font-black text-orchid">
                        Start with your sequencer addresses
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm font-bold text-whisper-white/80">
                        PINGME links Sentinel duty problems, node offenses, L1 votes,
                        candidate payloads, execution, actual stake removal, and ejection
                        into one case per address and target epoch.
                    </p>
                </section>
            )}

            <SourceStatus sources={monitor.networkData.sources} />
        </>
    );
}
