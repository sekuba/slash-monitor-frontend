import { describe, expect, it } from 'vitest';
import { parseAppSearch, urlForNetwork, urlForView } from './navigation';

describe('query-based application navigation', () => {
    it('parses supported views and defaults unknown values to the mainnet monitor', () => {
        expect(parseAppSearch('')).toEqual({ view: 'monitor', network: 'mainnet', selectedEventId: null });
        expect(parseAppSearch('?view=watch&network=testnet&event=event_1')).toEqual({ view: 'watch', network: 'testnet', selectedEventId: 'event_1' });
        expect(parseAppSearch('?view=debug&network=unknown&event=not%20valid')).toEqual({ view: 'debug', network: 'mainnet', selectedEventId: null });
        expect(parseAppSearch('?view=admin')).toEqual({ view: 'monitor', network: 'mainnet', selectedEventId: null });
    });

    it('preserves the network and unrelated query state when changing views', () => {
        const watch = urlForView('https://slashmon.example/?network=testnet&utm_source=alert', 'watch');
        expect(watch.searchParams.get('view')).toBe('watch');
        expect(watch.searchParams.get('network')).toBe('testnet');
        expect(watch.searchParams.get('utm_source')).toBe('alert');

        const monitor = urlForView(watch.href, 'monitor');
        expect(monitor.searchParams.has('view')).toBe(false);
        expect(monitor.searchParams.get('network')).toBe('testnet');
    });

    it('removes a notification event whenever navigation leaves Watch', () => {
        const current = 'https://slashmon.example/?view=watch&network=testnet&event=event-1';
        expect(urlForView(current, 'debug').searchParams.has('event')).toBe(false);
        expect(urlForView(current, 'monitor').searchParams.has('event')).toBe(false);
        expect(urlForView(current, 'watch').searchParams.get('event')).toBe('event-1');
    });

    it('preserves the active view when switching networks and drops a stale event selection', () => {
        const next = urlForNetwork(
            'https://slashmon.example/?view=watch&network=testnet&event=testnet-event&utm_source=push',
            'mainnet',
        );
        expect(parseAppSearch(next.search)).toEqual({ view: 'watch', network: 'mainnet', selectedEventId: null });
        expect(next.searchParams.has('event')).toBe(false);
        expect(next.searchParams.get('utm_source')).toBe('push');
    });
});
