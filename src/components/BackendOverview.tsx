import { EventHistory } from './EventHistory';
import { SourceHealthBanner } from './SourceHealthBanner';
import { SubscriptionPanel } from './SubscriptionPanel';
import { useBackendMonitor } from '@/hooks/useBackendMonitor';
import type { MonitorNetwork } from '@/types/backendApi';

export function BackendOverview({ network }: { network: MonitorNetwork }) {
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
            <SubscriptionPanel key={network} network={network} config={monitor.config} />
            <div className="mb-10">
                <EventHistory
                    events={monitor.events?.data ?? []}
                    hasWatchlistCapability={monitor.hasWatchlistCapability}
                    selectedEventError={monitor.selectedEventError}
                />
            </div>
        </>
    );
}
