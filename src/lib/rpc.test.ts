import { describe, expect, it } from 'vitest';
import { createPublicRpcTransport } from './rpc';

describe('Monitor RPC transport', () => {
    it('uses exactly one explicit RPC', () => {
        expect(() => createPublicRpcTransport('https://rpc.example')).not.toThrow();
        expect(() => createPublicRpcTransport('')).toThrow(/One RPC URL/);
        expect(() => createPublicRpcTransport(
            'https://one.example,https://two.example',
        )).toThrow(/one RPC URL at a time/);
    });
});
