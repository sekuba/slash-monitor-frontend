import type { Address } from 'viem';
import type { MonitorNetwork } from '@/types/backendApi';

export type AppView = 'monitor' | 'pingme';

export interface AppLocation {
    view: AppView;
    network: MonitorNetwork;
    selectedEventId: string | null;
    selectedSequencer: Address | null;
}

export function parseAppSearch(search: string): AppLocation {
    const params = new URLSearchParams(search);
    const requestedView = params.get('view');
    const view = requestedView === 'pingme' ? requestedView : 'monitor';

    return {
        view,
        network: params.get('network') === 'testnet' ? 'testnet' : 'mainnet',
        selectedEventId: view === 'pingme' ? readEventId(params.get('event')) : null,
        selectedSequencer: view === 'pingme' ? readSequencer(params.get('sequencer')) : null,
    };
}

function readSequencer(value: string | null): Address | null {
    return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as Address : null;
}

function readEventId(value: string | null): string | null {
    return value && /^[a-zA-Z0-9:_-]{1,200}$/.test(value) ? value : null;
}

export function urlForView(currentHref: string, view: AppView): URL {
    const next = new URL(currentHref);
    if (view === 'monitor') {
        next.searchParams.delete('view');
    }
    else {
        next.searchParams.set('view', view);
    }
    if (view !== 'pingme') {
        next.searchParams.delete('event');
        next.searchParams.delete('sequencer');
    }
    return next;
}

export function urlForNetwork(currentHref: string, network: MonitorNetwork): URL {
    const next = new URL(currentHref);
    const current = parseAppSearch(next.search).network;
    if (network === 'mainnet') {
        next.searchParams.delete('network');
    }
    else {
        next.searchParams.set('network', 'testnet');
    }
    if (network !== current) {
        next.searchParams.delete('event');
        next.searchParams.delete('sequencer');
    }
    return next;
}

export function urlForSequencer(currentHref: string, sequencer: Address | null): URL {
    const next = new URL(currentHref);
    next.searchParams.set('view', 'pingme');
    next.searchParams.delete('event');
    if (sequencer) {
        next.searchParams.set('sequencer', sequencer.toLowerCase());
    } else {
        next.searchParams.delete('sequencer');
    }
    return next;
}
