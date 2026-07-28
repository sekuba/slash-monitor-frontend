import { describe, expect, it } from 'vitest';
import { formatAztec } from './formatToken';

describe('formatAztec', () => {
    it('converts exact 18-decimal token amounts consistently', () => {
        expect(formatAztec('2000000000000000000000')).toBe('2,000');
        expect(formatAztec('5000000000000000000000')).toBe('5,000');
        expect(formatAztec(5_000_000_000_000_000_000_000n)).toBe('5,000');
        expect(formatAztec('1234567890123456789')).toBe('1.234567890123456789');
        expect(formatAztec('0')).toBe('0');
    });
});
