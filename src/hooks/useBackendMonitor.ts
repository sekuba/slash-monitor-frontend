import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { slashmonApi } from '@/api/client';
import {
    loadSubscriptionCredentials,
    subscribeToSubscriptionScope,
    type StoredSubscriptionCredentials,
} from '@/lib/subscriptionStorage';
import type { EventPage, MonitorEvent, MonitorNetwork, V2PublicConfig, V2Status } from '@/types/v2Api';

const POLL_INTERVAL_MS = 15_000;

interface BackendMonitorState {
    config: V2PublicConfig | null;
    status: V2Status | null;
    events: EventPage | null;
    scopeKey: string | null;
    isLoading: boolean;
    error: string | null;
    lastReceivedAt: number | null;
}

const initialState: BackendMonitorState = {
    config: null,
    status: null,
    events: null,
    scopeKey: null,
    isLoading: true,
    error: null,
    lastReceivedAt: null,
};

export function useBackendMonitor(network: MonitorNetwork) {
    const [state, setState] = useState<BackendMonitorState>(initialState);
    const [credentialSnapshot, setCredentialSnapshot] = useState(() => ({
        network,
        credentials: loadSubscriptionCredentials(network),
    }));
    const abortRef = useRef<AbortController | null>(null);
    const credentials = useMemo(
        () => credentialSnapshot.network === network
            ? credentialSnapshot.credentials
            : loadSubscriptionCredentials(network),
        [credentialSnapshot, network],
    );
    const scopeKey = credentials ? `${network}:watchlist:${credentials.id}` : `${network}:public`;

    useEffect(() => subscribeToSubscriptionScope(network, () => {
        setCredentialSnapshot({
            network,
            credentials: loadSubscriptionCredentials(network),
        });
    }), [network]);

    const refresh = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const selectedEventId = readSelectedEventId();
        const scopedRequests = createBackendReadRequests(
            slashmonApi,
            network,
            credentials,
            selectedEventId,
            controller.signal,
        );
        const [config, status, events, selectedEvent] = await Promise.allSettled([
            slashmonApi.getConfig(controller.signal),
            scopedRequests.status,
            scopedRequests.events,
            scopedRequests.selectedEvent,
        ]);

        if (!controller.signal.aborted) {
            const failures = [config, status, events]
                .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
                .map((result) => toErrorMessage(result.reason));
            const receivedAnything = [config, status, events].some((result) => result.status === 'fulfilled');

            setState((previous) => {
                const previousStatus = previous.scopeKey === scopeKey ? previous.status : null;
                const previousEvents = previous.scopeKey === scopeKey ? previous.events : null;
                const receivedStatus = status.status === 'fulfilled'
                    ? restrictPublicStatus(status.value, Boolean(credentials))
                    : previousStatus;
                const baseEvents = events.status === 'fulfilled'
                    ? restrictPublicEvents(events.value, Boolean(credentials))
                    : previousEvents;
                const receivedSelectedEvent = selectedEvent.status === 'fulfilled'
                    ? restrictPublicEvent(selectedEvent.value, Boolean(credentials))
                    : null;
                const nextEvents = baseEvents
                    ? prependSelectedEvent(baseEvents, receivedSelectedEvent)
                    : null;
                return {
                    config: config.status === 'fulfilled' ? config.value : previous.config,
                    status: receivedStatus,
                    events: nextEvents,
                    scopeKey,
                    isLoading: false,
                    error: failures.length > 0 ? failures[0] : null,
                    lastReceivedAt: receivedAnything ? Date.now() : previous.lastReceivedAt,
                };
            });
        }

        if (abortRef.current === controller) {
            abortRef.current = null;
        }
    }, [credentials, network, scopeKey]);

    useEffect(() => {
        const initialRefresh = window.setTimeout(() => void refresh(), 0);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void refresh();
            }
        }, POLL_INTERVAL_MS);
        const handleOnline = () => void refresh();
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                void refresh();
            }
        };
        window.addEventListener('online', handleOnline);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            window.clearTimeout(initialRefresh);
            window.clearInterval(timer);
            window.removeEventListener('online', handleOnline);
            document.removeEventListener('visibilitychange', handleVisibility);
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, [network, refresh]);

    const scopeIsCurrent = state.scopeKey === scopeKey;
    return {
        ...state,
        status: scopeIsCurrent ? state.status : null,
        events: scopeIsCurrent ? state.events : null,
        error: scopeIsCurrent ? state.error : null,
        isLoading: state.isLoading || !scopeIsCurrent,
        hasWatchlistCapability: Boolean(credentials),
        refresh,
    };
}

type BackendReadClient = Pick<
    typeof slashmonApi,
    | 'getStatus'
    | 'getEvents'
    | 'getEvent'
    | 'getSubscriptionStatus'
    | 'getSubscriptionEvents'
    | 'getSubscriptionEvent'
>;

interface BackendReadRequests {
    status: Promise<V2Status>;
    events: Promise<EventPage>;
    selectedEvent: Promise<MonitorEvent | null>;
}

export function createBackendReadRequests(
    api: BackendReadClient,
    network: MonitorNetwork,
    credentials: StoredSubscriptionCredentials | null,
    selectedEventId: string | null,
    signal?: AbortSignal,
): BackendReadRequests {
    if (credentials) {
        return {
            status: api.getSubscriptionStatus(
                credentials.id,
                credentials.managementToken,
                network,
                signal,
            ),
            events: api.getSubscriptionEvents(
                credentials.id,
                credentials.managementToken,
                network,
                signal,
            ),
            selectedEvent: selectedEventId
                ? api.getSubscriptionEvent(
                    credentials.id,
                    selectedEventId,
                    credentials.managementToken,
                    network,
                    signal,
                )
                : Promise.resolve(null),
        };
    }

    return {
        status: api.getStatus(network, signal),
        events: api.getEvents(network, signal),
        selectedEvent: selectedEventId
            ? api.getEvent(selectedEventId, network, signal)
            : Promise.resolve(null),
    };
}

function readSelectedEventId(): string | null {
    const value = new URLSearchParams(window.location.search).get('event');
    return value && /^[a-zA-Z0-9:_-]{1,200}$/.test(value) ? value : null;
}

function prependSelectedEvent(page: EventPage, selected: EventPage['data'][number] | null): EventPage {
    if (!selected || page.data.some((event) => event.id === selected.id)) return page;
    return { ...page, data: [selected, ...page.data] };
}

function restrictPublicStatus(status: V2Status, hasWatchlistCapability: boolean): V2Status {
    return hasWatchlistCapability ? status : { ...status, pendingOffenses: [] };
}

function restrictPublicEvents(page: EventPage, hasWatchlistCapability: boolean): EventPage {
    return hasWatchlistCapability
        ? page
        : { ...page, data: page.data.filter((event) => event.certainty === 'confirmed') };
}

function restrictPublicEvent(
    event: MonitorEvent | null,
    hasWatchlistCapability: boolean,
): MonitorEvent | null {
    return hasWatchlistCapability || event?.certainty === 'confirmed' ? event : null;
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to reach the Slashmon backend';
}
