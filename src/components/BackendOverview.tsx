import { EventHistory } from './EventHistory';
import { PendingOffenseList } from './PendingOffenseList';
import { SourceHealthBanner } from './SourceHealthBanner';
import { SubscriptionPanel } from './SubscriptionPanel';
import { useBackendMonitor } from '@/hooks/useBackendMonitor';
import type { MonitorNetwork } from '@/types/v2Api';

export function BackendOverview({ network }: { network: MonitorNetwork }) {
    const monitor = useBackendMonitor(network);
    const configuredNetwork = monitor.config?.network;

    if (configuredNetwork && configuredNetwork !== network) {
        return (
            <>
                <SourceHealthBanner
                    status={null}
                    error={`This notification backend watches ${configuredNetwork}, not ${network}. The independent L1 verifier below still works.`}
                    isLoading={false}
                    lastReceivedAt={monitor.lastReceivedAt}
                    onRefresh={() => void monitor.refresh()}
                />
            </>
        );
    }

    return (
        <>
            <SourceHealthBanner
                status={monitor.status}
                error={monitor.error}
                isLoading={monitor.isLoading}
                lastReceivedAt={monitor.lastReceivedAt}
                onRefresh={() => void monitor.refresh()}
            />
            <SubscriptionPanel network={network} config={monitor.config} />
            {monitor.status && (
                <div className="mb-10 grid gap-6 xl:grid-cols-2">
                    <PendingOffenseList
                        offenses={monitor.status.pendingOffenses}
                        hasWatchlistCapability={monitor.hasWatchlistCapability}
                    />
                    <EventHistory
                        events={monitor.events?.data ?? []}
                        hasWatchlistCapability={monitor.hasWatchlistCapability}
                    />
                </div>
            )}
        </>
    );
}
