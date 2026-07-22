import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRpcOverride, getRpcOverride, setRpcOverride, validateRpcOverride } from './rpcOverride';

describe('Monitor RPC overrides', () => {
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

    it('keeps a separate override for each chain', () => {
        setRpcOverride(1, 'https://rpc.example/mainnet');
        setRpcOverride(11_155_111, 'https://rpc.example/testnet');

        clearRpcOverride(1);

        expect(getRpcOverride(1)).toBeNull();
        expect(getRpcOverride(11_155_111)).toBe('https://rpc.example/testnet');
    });

    it('trims and validates browser RPC URLs', () => {
        expect(validateRpcOverride('  https://rpc.example/key  ')).toBe('https://rpc.example/key');
        expect(() => validateRpcOverride('')).toThrow('valid RPC URL');
        expect(() => validateRpcOverride('ws://rpc.example')).toThrow('HTTP or HTTPS');
        expect(() => validateRpcOverride('https://user:secret@rpc.example')).toThrow('username or password');
        expect(() => validateRpcOverride('https://rpc.example/#secret')).toThrow('fragment');
    });

    it('ignores unavailable or corrupt browser storage', () => {
        storage.set('slashmon:monitor-rpc:1', 'not a URL');
        expect(getRpcOverride(1)).toBeNull();

        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('storage blocked'); },
        });
        expect(getRpcOverride(1)).toBeNull();
    });
});
