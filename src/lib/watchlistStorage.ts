import type { MonitorNetwork } from '@/types/api';

export interface StoredWatchlistCredentials {
    id: string;
    managementToken: string;
}

const STORAGE_PREFIX = 'slashmon:watchlist:';
const CHANGE_EVENT_PREFIX = 'slashmon:watchlist-change:';
const SHARED_GITHUB_PAGES_SUFFIX = '.github.io';

/**
 * Management capabilities are origin-wide secrets. GitHub project Pages for
 * one account all share `https://account.github.io`, so any sibling project
 * could read Slashmon's localStorage even though the PWA has a narrow path and
 * service-worker scope. Keep that host useful as a public monitor only.
 */
export function isCapabilityStorageSafeOrigin(
    locationValue: { readonly hostname: string } | undefined = typeof location === 'undefined'
        ? undefined
        : location,
): boolean {
    const hostname = locationValue?.hostname.trim().toLowerCase() ?? '';
    return hostname === '' || !hostname.endsWith(SHARED_GITHUB_PAGES_SUFFIX);
}

export function loadWatchlistCredentials(network: MonitorNetwork): StoredWatchlistCredentials | null {
    try {
        if (!isCapabilityStorageSafeOrigin()) {
            localStorage.removeItem(`${STORAGE_PREFIX}mainnet`);
            localStorage.removeItem(`${STORAGE_PREFIX}testnet`);
            return null;
        }
        const raw = localStorage.getItem(`${STORAGE_PREFIX}${network}`);
        if (!raw) {
            return null;
        }
        const value: unknown = JSON.parse(raw);
        if (!isRecord(value) || typeof value.id !== 'string' || typeof value.managementToken !== 'string') {
            return null;
        }
        if (!value.id || !value.managementToken) {
            return null;
        }
        return { id: value.id, managementToken: value.managementToken };
    }
    catch {
        return null;
    }
}

export function saveWatchlistCredentials(
    network: MonitorNetwork,
    credentials: StoredWatchlistCredentials,
): void {
    if (!isCapabilityStorageSafeOrigin()) {
        throw new Error('Notification watchlists require a dedicated site origin; shared github.io project hosting is public-monitor only');
    }
    localStorage.setItem(`${STORAGE_PREFIX}${network}`, JSON.stringify(credentials));
    signalWatchlistChanged(network);
}

export function clearWatchlistCredentials(network: MonitorNetwork): void {
    localStorage.removeItem(`${STORAGE_PREFIX}${network}`);
    signalWatchlistChanged(network);
}

/**
 * Wake same-tab readers after a watchlist or its local capability changes.
 * The browser's native `storage` event covers other tabs, but deliberately does
 * not fire in the tab which performed the write.
 */
export function signalWatchlistChanged(network: MonitorNetwork): void {
    window.dispatchEvent(new Event(`${CHANGE_EVENT_PREFIX}${network}`));
}

export function subscribeToWatchlistChanges(
    network: MonitorNetwork,
    listener: () => void,
): () => void {
    const localEventName = `${CHANGE_EVENT_PREFIX}${network}`;
    const storageKey = `${STORAGE_PREFIX}${network}`;
    const handleLocalChange = () => listener();
    const handleStorageChange = (event: StorageEvent) => {
        if (event.storageArea === localStorage && (event.key === storageKey || event.key === null)) {
            listener();
        }
    };

    window.addEventListener(localEventName, handleLocalChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
        window.removeEventListener(localEventName, handleLocalChange);
        window.removeEventListener('storage', handleStorageChange);
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
