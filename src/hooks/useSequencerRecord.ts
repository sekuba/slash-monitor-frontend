import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { slashmonApi } from '@/api/client';
import type { MonitorNetwork, SequencerRecordPage } from '@/types/backendApi';

const REFRESH_INTERVAL_MS = 15_000;

interface SequencerRecordState {
    record: SequencerRecordPage | null;
    isLoading: boolean;
    isLoadingMore: boolean;
    error: string | null;
}

const EMPTY_STATE: SequencerRecordState = {
    record: null,
    isLoading: false,
    isLoadingMore: false,
    error: null,
};

export function useSequencerRecord(
    network: MonitorNetwork,
    sequencer: Address | null,
) {
    const [state, setState] = useState<SequencerRecordState>(EMPTY_STATE);
    const requestRef = useRef<AbortController | null>(null);

    const refresh = useCallback(async () => {
        if (!sequencer) {
            setState(EMPTY_STATE);
            return;
        }
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setState((previous) => ({
            ...previous,
            isLoading: previous.record?.sequencer.toLowerCase() !== sequencer.toLowerCase(),
            error: null,
        }));
        try {
            const page = await slashmonApi.getSequencerRecord(
                sequencer,
                network,
                controller.signal,
            );
            if (controller.signal.aborted) return;
            setState((previous) => {
                const sameRecord = previous.record?.sequencer.toLowerCase() ===
                    page.sequencer.toLowerCase();
                const retainedOlderEvents = sameRecord
                    ? previous.record!.events.filter((event) =>
                        !page.events.some((fresh) => fresh.id === event.id))
                    : [];
                return {
                    record: {
                        ...page,
                        events: [...page.events, ...retainedOlderEvents],
                        nextCursor: retainedOlderEvents.length > 0
                            ? previous.record!.nextCursor
                            : page.nextCursor,
                    },
                    isLoading: false,
                    isLoadingMore: false,
                    error: null,
                };
            });
        } catch (error) {
            if (controller.signal.aborted) return;
            setState((previous) => ({
                ...previous,
                isLoading: false,
                isLoadingMore: false,
                error: errorMessage(error),
            }));
        } finally {
            if (requestRef.current === controller) requestRef.current = null;
        }
    }, [network, sequencer]);

    const loadOlder = useCallback(async () => {
        const cursor = state.record?.nextCursor;
        if (!sequencer || !cursor || state.isLoadingMore) return;
        const controller = new AbortController();
        requestRef.current = controller;
        setState((previous) => ({ ...previous, isLoadingMore: true, error: null }));
        try {
            const page = await slashmonApi.getSequencerRecord(
                sequencer,
                network,
                controller.signal,
                cursor,
            );
            if (controller.signal.aborted) return;
            setState((previous) => ({
                record: previous.record
                    ? {
                        ...previous.record,
                        protocol: page.protocol ?? previous.record.protocol,
                        events: [
                            ...previous.record.events,
                            ...page.events.filter((event) =>
                                !previous.record!.events.some((known) => known.id === event.id)),
                        ],
                        nextCursor: page.nextCursor,
                    }
                    : page,
                isLoading: false,
                isLoadingMore: false,
                error: null,
            }));
        } catch (error) {
            if (controller.signal.aborted) return;
            setState((previous) => ({
                ...previous,
                isLoadingMore: false,
                error: errorMessage(error),
            }));
        } finally {
            if (requestRef.current === controller) requestRef.current = null;
        }
    }, [network, sequencer, state.isLoadingMore, state.record]);

    useEffect(() => {
        setState(sequencer ? { ...EMPTY_STATE, isLoading: true } : EMPTY_STATE);
        const initial = window.setTimeout(() => void refresh(), 0);
        const interval = window.setInterval(() => {
            if (sequencer && document.visibilityState === 'visible') void refresh();
        }, REFRESH_INTERVAL_MS);
        return () => {
            window.clearTimeout(initial);
            window.clearInterval(interval);
            requestRef.current?.abort();
            requestRef.current = null;
        };
    }, [refresh, sequencer]);

    return { ...state, refresh, loadOlder };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Sequencer record is unavailable';
}
