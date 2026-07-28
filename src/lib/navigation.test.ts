import { describe, expect, it } from 'vitest';
import { parseAppSearch, urlForNetwork, urlForValidator, urlForView } from './navigation';

describe('query-based application navigation', () => {
    it('defaults to the hosted live view with an unrecognized view value', () => {
        expect(parseAppSearch('')).toEqual({
            view: 'live',
            network: 'mainnet',
            selectedValidator: null,
        });
        expect(parseAppSearch('?view=unknown&utm_source=test')).toEqual({
            view: 'live',
            network: 'mainnet',
            selectedValidator: null,
        });
    });

    it('parses the independent network and a validator deep link', () => {
        expect(parseAppSearch('?view=independent&network=testnet&validator=0x1111111111111111111111111111111111111111')).toEqual({
            view: 'independent',
            network: 'testnet',
            selectedValidator: '0x1111111111111111111111111111111111111111',
        });
    });

    it('uses a clean URL for the live view', () => {
        const live = urlForView(
            'https://slashmon.example/?view=independent&network=testnet&validator=0x1111111111111111111111111111111111111111&utm_source=alert',
            'live',
        );
        expect(live.searchParams.has('view')).toBe(false);
        expect(live.searchParams.has('network')).toBe(false);
        expect(live.searchParams.get('validator')).toBe('0x1111111111111111111111111111111111111111');
        expect(live.searchParams.get('utm_source')).toBe('alert');
    });

    it('switches networks only in the independent view', () => {
        const next = urlForNetwork('https://slashmon.example/?utm_source=alert', 'testnet');
        expect(parseAppSearch(next.search)).toEqual({
            view: 'independent',
            network: 'testnet',
            selectedValidator: null,
        });
        expect(next.searchParams.get('utm_source')).toBe('alert');
    });

    it('opens and clears a validator without changing the selected view', () => {
        const address = '0x1111111111111111111111111111111111111111';
        const record = urlForValidator(
            'https://slashmon.example/?view=independent&utm_source=alert',
            address,
        );
        expect(record.searchParams.get('view')).toBe('independent');
        expect(record.searchParams.get('validator')).toBe(address);
        expect(record.searchParams.get('utm_source')).toBe('alert');
        expect(urlForValidator(record.href, null).searchParams.has('validator')).toBe(false);
    });
});
