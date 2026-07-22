import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCustomRpcUrl, getCustomRpcUrl, setCustomRpcUrl } from './rpcOverride';

describe('origin-local RPC overrides', () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
        storage.clear();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('stores and clears each network override without reloading or changing the URL', () => {
        setCustomRpcUrl(1, 'https://rpc.example/mainnet');
        setCustomRpcUrl(11155111, 'https://rpc.example/testnet');

        expect(getCustomRpcUrl(1)).toBe('https://rpc.example/mainnet');
        expect(getCustomRpcUrl(11155111)).toBe('https://rpc.example/testnet');

        clearCustomRpcUrl(1);
        expect(getCustomRpcUrl(1)).toBeNull();
        expect(getCustomRpcUrl(11155111)).toBe('https://rpc.example/testnet');
    });
});
