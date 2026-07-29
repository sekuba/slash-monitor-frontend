import type { MonitorNetwork } from '@/types/backendApi';

export interface StoredWatchCredentials {
    id: string;
    managementToken: string;
}

const STORAGE_PREFIX = 'slashmon:v3:watch:';
const CHANGE_EVENT_PREFIX = 'slashmon:v3:watch-change:';

export function isWatchStorageSafe(
    locationValue: { readonly hostname: string } | undefined =
        typeof location === 'undefined' ? undefined : location,
): boolean {
    return !(locationValue?.hostname.trim().toLowerCase() ?? '')
        .endsWith('.github.io');
}

export function loadWatchCredentials(
    network: MonitorNetwork,
): StoredWatchCredentials | null {
    if (!isWatchStorageSafe()) return null;
    try {
        const value: unknown = JSON.parse(
            localStorage.getItem(`${STORAGE_PREFIX}${network}`) ?? 'null',
        );
        if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            typeof (value as Record<string, unknown>).id !== 'string' ||
            typeof (value as Record<string, unknown>).managementToken !== 'string'
        ) {
            return null;
        }
        return value as StoredWatchCredentials;
    }
    catch {
        return null;
    }
}

export function saveWatchCredentials(
    network: MonitorNetwork,
    credentials: StoredWatchCredentials,
): void {
    if (!isWatchStorageSafe()) {
        throw new Error('PINGME watch keys require a dedicated browser origin');
    }
    localStorage.setItem(`${STORAGE_PREFIX}${network}`, JSON.stringify(credentials));
    signalWatchChanged(network);
}

export function clearWatchCredentials(network: MonitorNetwork): void {
    localStorage.removeItem(`${STORAGE_PREFIX}${network}`);
    signalWatchChanged(network);
}

export function signalWatchChanged(network: MonitorNetwork): void {
    window.dispatchEvent(new Event(`${CHANGE_EVENT_PREFIX}${network}`));
}

export function onWatchChanged(
    network: MonitorNetwork,
    listener: () => void,
): () => void {
    const eventName = `${CHANGE_EVENT_PREFIX}${network}`;
    const storageKey = `${STORAGE_PREFIX}${network}`;
    const storageListener = (event: StorageEvent) => {
        if (event.storageArea === localStorage && event.key === storageKey) listener();
    };
    window.addEventListener(eventName, listener);
    window.addEventListener('storage', storageListener);
    return () => {
        window.removeEventListener(eventName, listener);
        window.removeEventListener('storage', storageListener);
    };
}
