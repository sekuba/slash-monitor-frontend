import { EventHistory } from './EventHistory';
import { SourceHealthBanner } from './SourceHealthBanner';
import { SubscriptionPanel } from './SubscriptionPanel';
import { SequencerRecord } from './SequencerRecord';
import { useBackendMonitor } from '@/hooks/useBackendMonitor';
import type { Address } from 'viem';
import type { MonitorNetwork } from '@/types/backendApi';

export function BackendOverview({
    network,
    selectedEventId,
    selectedSequencer,
    onSelectSequencer,
}: {
    network: MonitorNetwork;
    selectedEventId: string | null;
    selectedSequencer: Address | null;
    onSelectSequencer: (sequencer: Address | null) => void;
}) {
    const monitor = useBackendMonitor(network, selectedEventId);
    const configuredNetwork = monitor.config?.network;
    const networkFeed = (
        <EventHistory
            events={monitor.events?.data ?? []}
            hasWatchlistCapability={monitor.hasWatchlistCapability}
            selectedEventId={selectedEventId}
            selectedEventError={monitor.selectedEventError}
            onSelectSequencer={onSelectSequencer}
        />
    );

    const health = (
        <SourceHealthBanner
            status={monitor.status}
            error={monitor.error}
            isLoading={monitor.isLoading}
            lastReceivedAt={monitor.lastReceivedAt}
            onRetry={() => void monitor.refresh()}
        />
    );

    if (configuredNetwork && configuredNetwork !== network) {
        return (
            <>
                <section className="mb-8 border-5 border-vermillion bg-oxblood p-6 shadow-brutal-vermillion" role="alert">
                    <h2 className="text-2xl font-black text-vermillion">Sequencer Watches Unavailable</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white">
                        This notification backend watches {configuredNetwork}, not {network}. Switch networks to manage sequencer watches.
                    </p>
                </section>
                {health}
            </>
        );
    }

    return (
        <>
            <SequencerRecord
                network={network}
                sequencer={selectedSequencer}
                onSelect={onSelectSequencer}
            />
            <SubscriptionPanel
                key={network}
                network={network}
                config={monitor.config}
                onSelectSequencer={onSelectSequencer}
            />
            <div className="mb-10">
                {selectedSequencer ? (
                    <details className="border-5 border-aqua bg-lapis p-4 shadow-brutal-aqua">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-black text-aqua">
                            <span className="text-lg">Network feed</span>
                            <span className="border-3 border-brand-black bg-aqua px-2 py-1 text-xs uppercase text-brand-black">
                                {monitor.events?.data.length ?? 0} events
                            </span>
                        </summary>
                        <div className="mt-5">{networkFeed}</div>
                    </details>
                ) : networkFeed}
            </div>
            {health}
        </>
    );
}
