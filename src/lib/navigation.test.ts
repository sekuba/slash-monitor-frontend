import { describe, expect, it } from 'vitest';
import {
    parseAppSearch,
    urlForCase,
    urlForNetwork,
    urlForView,
    urlForWatchlist,
} from './navigation';

describe('navigation', () => {
    it('parses the view, network, public watchlist, and exact case', () => {
        expect(parseAppSearch('')).toEqual({
            view: 'monitor',
            network: 'mainnet',
            watchlistAddresses: [],
            selectedCaseId: null,
        });
        expect(parseAppSearch(
            '?view=pingme&network=testnet&watch=0x1111111111111111111111111111111111111111%2C0x2222222222222222222222222222222222222222&case=case%3Atestnet%3Aabc',
        )).toEqual({
            view: 'pingme',
            network: 'testnet',
            watchlistAddresses: [
                '0x1111111111111111111111111111111111111111',
                '0x2222222222222222222222222222222222222222',
            ],
            selectedCaseId: 'case:testnet:abc',
        });
    });

    it('keeps a case on its evidence page and clears focus when changing context', () => {
        const caseUrl = urlForCase(
            'https://slashveto.me/?watch=0x1111111111111111111111111111111111111111',
            'case:mainnet:abc',
        );
        expect(caseUrl.searchParams.has('view')).toBe(false);
        expect(caseUrl.searchParams.get('case')).toBe('case:mainnet:abc');
        expect(caseUrl.searchParams.has('watch')).toBe(true);
        expect(urlForView(caseUrl.href, 'monitor').searchParams.has('case')).toBe(false);
        expect(urlForNetwork(caseUrl.href, 'testnet').searchParams.has('case')).toBe(false);
    });

    it('creates credential-free links for watchlists on either page', () => {
        const address = '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD';
        const pingme = urlForWatchlist(
            'https://slashveto.me/?case=case%3Amainnet%3Aabc',
            'pingme',
            'mainnet',
            [address, address.toLowerCase()],
        );
        expect(pingme.searchParams.get('view')).toBe('pingme');
        expect(pingme.searchParams.get('watch')).toBe(address.toLowerCase());
        expect(pingme.searchParams.has('case')).toBe(false);
        expect(pingme.href).not.toContain('token');
    });

    it('rejects a malformed watchlist atomically', () => {
        expect(parseAppSearch(
            '?watch=0x1111111111111111111111111111111111111111%2Cnope',
        ).watchlistAddresses).toEqual([]);
    });
});
