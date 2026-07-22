import { describe, expect, it } from 'vitest';
import { debugScanLabel } from './DebugView';

describe('Debug scanner state', () => {
    it('distinguishes loading, fatal initialization, and initialized audit states', () => {
        expect(debugScanLabel(false, null, 'ok')).toBe('NOT INITIALIZED');
        expect(debugScanLabel(false, 'RPC failed', 'fatal')).toBe('INITIALIZATION FAILED');
        expect(debugScanLabel(true, null, 'fatal')).toBe('UNAVAILABLE');
        expect(debugScanLabel(true, null, 'ok')).toBe('FULLY VERIFIED');
    });
});
