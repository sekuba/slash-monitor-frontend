import { describe, expect, it } from 'vitest';
import { parseAddressList } from './addresses';

describe('parseAddressList', () => {
    it('normalizes and deduplicates mixed separators', () => {
        const result = parseAddressList(`
            0x00000000000000000000000000000000000000aa,
            0x00000000000000000000000000000000000000AA;
            0x00000000000000000000000000000000000000bb
        `);

        expect(result.errors).toEqual([]);
        expect(result.addresses.map((address) => address.toLowerCase())).toEqual([
            '0x00000000000000000000000000000000000000aa',
            '0x00000000000000000000000000000000000000bb',
        ]);
    });

    it('reports invalid and over-limit input without returning beyond the limit', () => {
        const result = parseAddressList([
            'not-an-address',
            '0x0000000000000000000000000000000000000001',
            '0x0000000000000000000000000000000000000002',
        ].join('\n'), 1);

        expect(result.addresses).toHaveLength(1);
        expect(result.errors).toHaveLength(2);
    });
});
