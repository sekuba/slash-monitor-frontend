import { useCallback, useEffect, useRef, useState } from 'react';
import { slashmonApi } from '@/api/client';
import { loadWatchCredentials, onWatchChanged } from '@/lib/watchStorage';
import type {
    BackendConfig,
    BackendStatus,
    ManagedWatch,
    MonitorNetwork,
    NetworkCases,
} from '@/types/backendApi';

const POLL_INTERVAL_MS = 15_000;

interface State {
    config: BackendConfig | null;
    status: BackendStatus | null;
    networkData: NetworkCases | null;
    watch: ManagedWatch | null;
    watchError: string | null;
    isLoading: boolean;
    error: string | null;
    lastReceivedAt: number | null;
}

const initialState: State = {
    config: null,
    status: null,
    networkData: null,
    watch: null,
    watchError: null,
    isLoading: true,
    error: null,
    lastReceivedAt: null,
};

export function useBackendMonitor(network: MonitorNetwork) {
    const [state, setState] = useState<State>(initialState);
    const abortRef = useRef<AbortController | null>(null);
    const [credentials, setCredentials] = useState(
        () => loadWatchCredentials(network),
    );

    useEffect(() => onWatchChanged(
        network,
        () => setCredentials(loadWatchCredentials(network)),
    ), [network]);

    const refresh = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const watchRequest = credentials
                ? slashmonApi.getWatch(
                    credentials.id,
                    credentials.managementToken,
                    controller.signal,
                ).then(
                    (watch) => ({ watch, error: null }),
                    (error: unknown) => ({
                        watch: null,
                        error: error instanceof Error
                            ? error.message
                            : 'Unable to load the saved PINGME watch',
                    }),
                )
                : Promise.resolve({ watch: null, error: null });
            const [config, status, networkData, watchResult] = await Promise.all([
                slashmonApi.getConfig(controller.signal),
                slashmonApi.getStatus(controller.signal),
                slashmonApi.getNetwork(controller.signal),
                watchRequest,
            ]);
            if (controller.signal.aborted) return;
            if (config.network !== network) {
                throw new Error(
                    `This PINGME backend monitors ${config.network}, not ${network}.`,
                );
            }
            setState({
                config,
                status,
                networkData,
                watch: watchResult.watch,
                watchError: watchResult.error,
                isLoading: false,
                error: null,
                lastReceivedAt: Date.now(),
            });
        }
        catch (error) {
            if (controller.signal.aborted) return;
            setState({
                config: null,
                status: null,
                networkData: null,
                watch: null,
                watchError: null,
                isLoading: false,
                error: error instanceof Error
                    ? error.message
                    : 'Unable to reach the Slashmon backend',
                lastReceivedAt: null,
            });
        }
        finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [credentials, network]);

    useEffect(() => {
        const initialTimer = window.setTimeout(() => void refresh(), 0);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void refresh();
        }, POLL_INTERVAL_MS);
        const handleVisible = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        window.addEventListener('online', refresh);
        document.addEventListener('visibilitychange', handleVisible);
        return () => {
            window.clearTimeout(initialTimer);
            window.clearInterval(timer);
            window.removeEventListener('online', refresh);
            document.removeEventListener('visibilitychange', handleVisible);
            abortRef.current?.abort();
        };
    }, [refresh]);

    return { ...state, credentials, refresh };
}
