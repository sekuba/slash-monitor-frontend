import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Address } from 'viem';
import { monitorApi } from '@/api/monitorClient';
import type {
    BackendStatus,
    MonitorSnapshot,
    PublicConfig,
    ValidatorSnapshot,
} from '@/types/api';

const MONITOR_POLL_MS = 15_000;
const VALIDATOR_POLL_MS = 30_000;

interface HostedMonitorState {
    config: PublicConfig | null;
    status: BackendStatus | null;
    snapshot: MonitorSnapshot | null;
    isLoading: boolean;
    isRefreshing: boolean;
    error: string | null;
    lastReceivedAt: number | null;
}

const initialMonitorState: HostedMonitorState = {
    config: null,
    status: null,
    snapshot: null,
    isLoading: true,
    isRefreshing: false,
    error: null,
    lastReceivedAt: null,
};

export function useHostedMonitor() {
    const [state, setState] = useState(initialMonitorState);
    const abortRef = useRef<AbortController | null>(null);

    const refresh = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setState((current) => ({
            ...current,
            isLoading: current.snapshot === null,
            isRefreshing: current.snapshot !== null,
        }));

        const results = await Promise.allSettled([
            monitorApi.getConfig(controller.signal),
            monitorApi.getStatus(controller.signal),
            monitorApi.getMonitor(controller.signal),
        ]);
        if (controller.signal.aborted) return;

        const [config, status, snapshot] = results;
        const failures = results
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result) => errorMessage(result.reason));
        const received = results.some((result) => result.status === 'fulfilled');

        setState((current) => ({
            config: config.status === 'fulfilled' ? config.value : current.config,
            status: status.status === 'fulfilled' ? status.value : current.status,
            snapshot: snapshot.status === 'fulfilled' ? snapshot.value : current.snapshot,
            isLoading: false,
            isRefreshing: false,
            error: failures[0] ?? null,
            lastReceivedAt: received ? Date.now() : current.lastReceivedAt,
        }));
        if (abortRef.current === controller) abortRef.current = null;
    }, []);

    usePollingRefresh(refresh, MONITOR_POLL_MS, abortRef);
    return { ...state, refresh };
}

interface ValidatorState {
    record: ValidatorSnapshot | null;
    requestedAddress: Address | null;
    isLoading: boolean;
    error: string | null;
}

export function useHostedValidator(address: Address | null) {
    const [state, setState] = useState<ValidatorState>({
        record: null,
        requestedAddress: null,
        isLoading: false,
        error: null,
    });
    const abortRef = useRef<AbortController | null>(null);

    const refresh = useCallback(async () => {
        abortRef.current?.abort();
        if (!address) {
            setState({
                record: null,
                requestedAddress: null,
                isLoading: false,
                error: null,
            });
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setState((current) => ({
            record: current.requestedAddress === address ? current.record : null,
            requestedAddress: address,
            isLoading: true,
            error: null,
        }));
        try {
            const record = await monitorApi.getValidator(address, controller.signal);
            if (!controller.signal.aborted) {
                setState({
                    record,
                    requestedAddress: address,
                    isLoading: false,
                    error: null,
                });
            }
        }
        catch (error) {
            if (!controller.signal.aborted) {
                setState((current) => ({
                    ...current,
                    requestedAddress: address,
                    isLoading: false,
                    error: errorMessage(error),
                }));
            }
        }
        finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [address]);

    usePollingRefresh(refresh, VALIDATOR_POLL_MS, abortRef);
    const isCurrent = state.requestedAddress === address;
    return {
        record: isCurrent ? state.record : null,
        isLoading: Boolean(address) && (!isCurrent || state.isLoading),
        error: isCurrent ? state.error : null,
        refresh,
    };
}

function usePollingRefresh(
    refresh: () => Promise<void>,
    intervalMs: number,
    abortRef: MutableRefObject<AbortController | null>,
): void {
    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void refresh();
        }, intervalMs);
        const refreshVisible = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        window.addEventListener('online', refreshVisible);
        document.addEventListener('visibilitychange', refreshVisible);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('online', refreshVisible);
            document.removeEventListener('visibilitychange', refreshVisible);
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, [abortRef, intervalMs, refresh]);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The hosted monitor did not return a usable response.';
}
