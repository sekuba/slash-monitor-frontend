import { describe, expect, it } from 'vitest';
import { parseAppSearch, urlForCase, urlForNetwork, urlForView } from './navigation';

describe('v3 navigation', () => {
    it('parses only the view, network, and exact case', () => {
        expect(parseAppSearch('')).toEqual({
            view: 'monitor',
            network: 'mainnet',
            selectedCaseId: null,
        });
        expect(parseAppSearch('?view=pingme&network=testnet&case=case%3Atestnet%3Aabc')).toEqual({
            view: 'pingme',
            network: 'testnet',
            selectedCaseId: 'case:testnet:abc',
        });
    });

    it('clears case focus when changing context', () => {
        const caseUrl = urlForCase('https://slashveto.me/', 'case:mainnet:abc');
        expect(caseUrl.searchParams.get('view')).toBe('pingme');
        expect(caseUrl.searchParams.get('case')).toBe('case:mainnet:abc');
        expect(urlForView(caseUrl.href, 'monitor').searchParams.has('case')).toBe(false);
        expect(urlForNetwork(caseUrl.href, 'testnet').searchParams.has('case')).toBe(false);
    });
});
