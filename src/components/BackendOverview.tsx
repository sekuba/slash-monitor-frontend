import { EventHistory } from './EventHistory';
import { SourceHealthBanner } from './SourceHealthBanner';
import { SubscriptionPanel } from './SubscriptionPanel';
import { SequencerRecord } from './SequencerRecord';
import { useBackendMonitor } from '@/hooks/useBackendMonitor';
import type { Address } from 'viem';
import type { MonitorNetwork } from '@/types/backendApi';

export function BackendOverview({
    network,
    selectedSequencer,
    onSelectSequencer,
}: {
    network: MonitorNetwork;
    selectedSequencer: Address | null;
    onSelectSequencer: (sequencer: Address | null) => void;
}) {
    const monitor = useBackendMonitor(network);
    const configuredNetwork = monitor.config?.network;

    const health = (
        <SourceHealthBanner
            status={monitor.status}
            error={monitor.error}
            isLoading={monitor.isLoading}
            lastReceivedAt={monitor.lastReceivedAt}
            onRefresh={() => void monitor.refresh()}
        />
    );

    if (configuredNetwork && configuredNetwork !== network) {
        return (
            <>
                {health}
                <section className="mb-8 border-5 border-vermillion bg-oxblood p-6 shadow-brutal-vermillion" role="alert">
                    <h2 className="text-2xl font-black text-vermillion">Sequencer Watches Unavailable</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white">
                        This notification backend watches {configuredNetwork}, not {network}. Switch networks to manage sequencer watches.
                    </p>
                </section>
            </>
        );
    }

    return (
        <>
            {health}
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
                <EventHistory
                    events={monitor.events?.data ?? []}
                    hasWatchlistCapability={monitor.hasWatchlistCapability}
                    selectedEventError={monitor.selectedEventError}
                    onSelectSequencer={onSelectSequencer}
                />
            </div>
        </>
    );
}
