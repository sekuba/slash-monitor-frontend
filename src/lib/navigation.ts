import type { MonitorNetwork } from '@/types/backendApi';

export type AppView = 'monitor' | 'pingme';

export interface AppLocation {
    view: AppView;
    network: MonitorNetwork;
    selectedCaseId: string | null;
}

export function parseAppSearch(search: string): AppLocation {
    const params = new URLSearchParams(search);
    const view = params.get('view') === 'pingme' ? 'pingme' : 'monitor';
    return {
        view,
        network: params.get('network') === 'testnet' ? 'testnet' : 'mainnet',
        selectedCaseId: view === 'pingme' ? readCaseId(params.get('case')) : null,
    };
}

export function urlForView(currentHref: string, view: AppView): URL {
    const next = new URL(currentHref);
    if (view === 'monitor') next.searchParams.delete('view');
    else next.searchParams.set('view', view);
    if (view !== 'pingme') next.searchParams.delete('case');
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
    next.searchParams.set('view', 'pingme');
    if (caseId) next.searchParams.set('case', caseId);
    else next.searchParams.delete('case');
    return next;
}

function readCaseId(value: string | null): string | null {
    return value && /^[a-zA-Z0-9:_-]{1,300}$/.test(value) ? value : null;
}
