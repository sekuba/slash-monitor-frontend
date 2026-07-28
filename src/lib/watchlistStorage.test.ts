import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearWatchlistCredentials,
    isCapabilityStorageSafeOrigin,
    loadWatchlistCredentials,
    saveWatchlistCredentials,
    signalWatchlistChanged,
    subscribeToWatchlistChanges,
} from './watchlistStorage';

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length(): number {
        return this.values.size;
    }

    clear(): void {
        this.values.clear();
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

describe('watchlist capability storage signaling', () => {
    beforeEach(() => {
        vi.stubGlobal('window', new EventTarget());
        vi.stubGlobal('localStorage', new MemoryStorage());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rejects origin-wide capability storage on shared GitHub project Pages', () => {
        expect(isCapabilityStorageSafeOrigin({ hostname: 'watchtower.example' })).toBe(true);
        expect(isCapabilityStorageSafeOrigin({ hostname: 'operator.github.io' })).toBe(false);

        vi.stubGlobal('location', { hostname: 'operator.github.io' });
        expect(() => saveWatchlistCredentials('mainnet', {
            id: 'watch-1',
            managementToken: 'secret-capability',
        })).toThrow(/dedicated site origin/i);
        expect(loadWatchlistCredentials('mainnet')).toBeNull();
    });

    it('wakes same-tab readers when credentials are saved or cleared', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToWatchlistChanges('mainnet', listener);
        const credentials = { id: 'watch-1', managementToken: 'secret-capability' };

        saveWatchlistCredentials('mainnet', credentials);
        expect(loadWatchlistCredentials('mainnet')).toEqual(credentials);
        expect(listener).toHaveBeenCalledTimes(1);

        clearWatchlistCredentials('mainnet');
        expect(loadWatchlistCredentials('mainnet')).toBeNull();
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        signalWatchlistChanged('mainnet');
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('keeps network scopes isolated', () => {
        const mainnetListener = vi.fn();
        const stop = subscribeToWatchlistChanges('mainnet', mainnetListener);

        saveWatchlistCredentials('testnet', {
            id: 'watch-testnet',
            managementToken: 'testnet-capability',
        });

        expect(mainnetListener).not.toHaveBeenCalled();
        expect(loadWatchlistCredentials('mainnet')).toBeNull();
        stop();
    });
});
