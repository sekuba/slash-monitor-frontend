import type { MonitorNetwork } from '@/types/v2Api';

export type AppView = 'monitor' | 'pingme' | 'debug';

export interface AppLocation {
    view: AppView;
    network: MonitorNetwork;
    selectedEventId: string | null;
}

export function parseAppSearch(search: string): AppLocation {
    const params = new URLSearchParams(search);
    const requestedView = params.get('view');
    const view = requestedView === 'pingme' || requestedView === 'debug' ? requestedView : 'monitor';

    return {
        view,
        network: params.get('network') === 'testnet' ? 'testnet' : 'mainnet',
        selectedEventId: view === 'pingme' ? readEventId(params.get('event')) : null,
    };
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
    }
    return next;
}
