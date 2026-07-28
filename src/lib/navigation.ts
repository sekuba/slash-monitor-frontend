import type { Address } from 'viem';
import type { MonitorNetwork } from '@/types/api';

export type AppView = 'live' | 'independent';

export interface AppLocation {
    view: AppView;
    network: MonitorNetwork;
    selectedValidator: Address | null;
}

export function parseAppSearch(search: string): AppLocation {
    const params = new URLSearchParams(search);

    return {
        view: params.get('view') === 'independent' ? 'independent' : 'live',
        network: params.get('network') === 'testnet' ? 'testnet' : 'mainnet',
        selectedValidator: readAddress(params.get('validator')),
    };
}

function readAddress(value: string | null): Address | null {
    return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as Address : null;
}

export function urlForView(currentHref: string, view: AppView): URL {
    const next = new URL(currentHref);
    if (view === 'live') {
        next.searchParams.delete('view');
        next.searchParams.delete('network');
    } else {
        next.searchParams.set('view', view);
    }
    return next;
}

export function urlForNetwork(currentHref: string, network: MonitorNetwork): URL {
    const next = new URL(currentHref);
    next.searchParams.set('view', 'independent');
    if (network === 'mainnet') {
        next.searchParams.delete('network');
    } else {
        next.searchParams.set('network', network);
    }
    return next;
}

export function urlForValidator(currentHref: string, validator: Address | null): URL {
    const next = new URL(currentHref);
    if (validator) {
        next.searchParams.set('validator', validator.toLowerCase());
    } else {
        next.searchParams.delete('validator');
    }
    return next;
}
