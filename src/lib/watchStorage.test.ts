import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isWatchStorageSafe,
    loadWatchCredentials,
    saveWatchCredentials,
} from './watchStorage';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('watch credential storage', () => {
    it('refuses shared *.github.io origins and accepts dedicated ones', () => {
        expect(isWatchStorageSafe({ hostname: 'sekuba.github.io' })).toBe(false);
        expect(isWatchStorageSafe({ hostname: ' SEKUBA.GITHUB.IO ' })).toBe(false);
        expect(isWatchStorageSafe({ hostname: 'slashveto.me' })).toBe(true);
        expect(isWatchStorageSafe({ hostname: 'localhost' })).toBe(true);
        expect(isWatchStorageSafe(undefined)).toBe(true);
    });

    it('never persists or reads management tokens on a shared origin', () => {
        const setItem = vi.fn();
        const getItem = vi.fn(() => JSON.stringify({ id: 'w', managementToken: 't' }));
        vi.stubGlobal('location', { hostname: 'sekuba.github.io' });
        vi.stubGlobal('localStorage', { setItem, getItem });

        expect(() => saveWatchCredentials('mainnet', { id: 'w', managementToken: 't' }))
            .toThrow(/dedicated browser origin/);
        expect(setItem).not.toHaveBeenCalled();
        expect(loadWatchCredentials('mainnet')).toBeNull();
        expect(getItem).not.toHaveBeenCalled();
    });

    it('validates the stored credential shape before trusting it', () => {
        vi.stubGlobal('location', { hostname: 'slashveto.me' });
        const stored = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => stored.set(key, value),
        });
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });

        stored.set('slashmon:watch:mainnet', JSON.stringify({ id: 42 }));
        expect(loadWatchCredentials('mainnet')).toBeNull();

        saveWatchCredentials('mainnet', { id: 'watch-1', managementToken: 'token-1' });
        expect(loadWatchCredentials('mainnet'))
            .toEqual({ id: 'watch-1', managementToken: 'token-1' });
    });
});
