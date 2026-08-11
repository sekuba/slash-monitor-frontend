import { describe, expect, it } from 'vitest';
import { formatAztec, humanizeOffense, shortAddress } from './format.ts';

describe('formatAztec', () => {
    it('converts exact 18-decimal token amounts consistently', () => {
        expect(formatAztec('2000000000000000000000')).toBe('2,000');
        expect(formatAztec('5000000000000000000000')).toBe('5,000');
        expect(formatAztec(5_000_000_000_000_000_000_000n)).toBe('5,000');
        expect(formatAztec('1234567890123456789')).toBe('1.234567890123456789');
        expect(formatAztec('0')).toBe('0');
        expect(formatAztec(-1_500_000_000_000_000_000n)).toBe('-1.5');
    });

    it('returns non-numeric input unchanged instead of throwing', () => {
        expect(formatAztec('not-a-number')).toBe('not-a-number');
    });
});

describe('shortAddress', () => {
    it('abbreviates well-formed addresses and passes other values through', () => {
        expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678'))
            .toBe('0x1234…5678');
        expect(shortAddress('validator-7')).toBe('validator-7');
    });
});

describe('humanizeOffense', () => {
    it('turns node offense identifiers into title-case labels', () => {
        expect(humanizeOffense('data_withholding')).toBe('Data Withholding');
        expect(humanizeOffense('broadcasted_invalid_block_proposal'))
            .toBe('Broadcasted Invalid Block Proposal');
    });
});
