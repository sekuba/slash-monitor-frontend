import type { MonitorNetwork } from '@/types/backendApi';

export type AppView = 'monitor' | 'pingme';

export interface AppLocation {
    view: AppView;
    network: MonitorNetwork;
    watchlistAddresses: string[];
    selectedCaseId: string | null;
}

export function parseAppSearch(search: string): AppLocation {
    const params = new URLSearchParams(search);
    const view = params.get('view') === 'pingme' ? 'pingme' : 'monitor';
    return {
        view,
        network: params.get('network') === 'testnet' ? 'testnet' : 'mainnet',
        watchlistAddresses: readWatchlist(params.get('watch')),
        selectedCaseId: readCaseId(params.get('case')),
    };
}

export function urlForView(currentHref: string, view: AppView): URL {
    const next = new URL(currentHref);
    if (view === 'monitor') next.searchParams.delete('view');
    else next.searchParams.set('view', view);
    next.searchParams.delete('case');
    return next;
}

export function urlForNetwork(currentHref: string, network: MonitorNetwork): URL {
    const next = new URL(currentHref);
    const current = parseAppSearch(next.search).network;
    if (network === 'mainnet') next.searchParams.delete('network');
    else next.searchParams.set('network', 'testnet');
    if (network !== current) next.searchParams.delete('case');
    return next;
}

export function urlForCase(currentHref: string, caseId: string | null): URL {
    const next = new URL(currentHref);
    if (caseId) next.searchParams.set('case', caseId);
    else next.searchParams.delete('case');
    return next;
}

export function urlForWatchlist(
    currentHref: string,
    view: AppView,
    network: MonitorNetwork,
    addresses: readonly string[],
): URL {
    const next = new URL(currentHref);
    if (view === 'monitor') next.searchParams.delete('view');
    else next.searchParams.set('view', view);
    if (network === 'mainnet') next.searchParams.delete('network');
    else next.searchParams.set('network', 'testnet');
    next.searchParams.delete('case');
    const normalized = normalizeWatchlist(addresses);
    if (normalized.length > 0) next.searchParams.set('watch', normalized.join(','));
    else next.searchParams.delete('watch');
    return next;
}

function readCaseId(value: string | null): string | null {
    return value && /^[a-zA-Z0-9:_-]{1,300}$/.test(value) ? value : null;
}

function readWatchlist(value: string | null): string[] {
    if (!value) return [];
    const candidates = value.split(',');
    if (
        candidates.length > 100 ||
        candidates.some((item) => !/^0x[0-9a-fA-F]{40}$/.test(item))
    ) {
        return [];
    }
    return normalizeWatchlist(candidates);
}

function normalizeWatchlist(addresses: readonly string[]): string[] {
    return [...new Set(addresses.map((item) => item.toLowerCase()))]
        .filter((item) => /^0x[0-9a-f]{40}$/.test(item))
        .slice(0, 100);
}
