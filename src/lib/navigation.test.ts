import { describe, expect, it } from 'vitest';
import { parseAppSearch, urlForNetwork, urlForSequencer, urlForView } from './navigation';

describe('query-based application navigation', () => {
    it('parses supported views and defaults unknown values to the mainnet monitor', () => {
        expect(parseAppSearch('')).toEqual({ view: 'monitor', network: 'mainnet', selectedEventId: null, selectedSequencer: null });
        expect(parseAppSearch('?view=pingme&network=testnet&event=event_1&sequencer=0x1111111111111111111111111111111111111111')).toEqual({
            view: 'pingme',
            network: 'testnet',
            selectedEventId: 'event_1',
            selectedSequencer: '0x1111111111111111111111111111111111111111',
        });
        expect(parseAppSearch('?view=unknown&network=unknown&event=not%20valid&sequencer=invalid')).toEqual({
            view: 'monitor',
            network: 'mainnet',
            selectedEventId: null,
            selectedSequencer: null,
        });
        expect(parseAppSearch('?view=admin')).toEqual({ view: 'monitor', network: 'mainnet', selectedEventId: null, selectedSequencer: null });
    });

    it('preserves the network and unrelated query state when changing views', () => {
        const pingme = urlForView('https://slashmon.example/?network=testnet&utm_source=alert', 'pingme');
        expect(pingme.searchParams.get('view')).toBe('pingme');
        expect(pingme.searchParams.get('network')).toBe('testnet');
        expect(pingme.searchParams.get('utm_source')).toBe('alert');

        const monitor = urlForView(pingme.href, 'monitor');
        expect(monitor.searchParams.has('view')).toBe(false);
        expect(monitor.searchParams.get('network')).toBe('testnet');
    });

    it('removes a notification event whenever navigation leaves PINGME', () => {
        const current = 'https://slashmon.example/?view=pingme&network=testnet&event=event-1';
        expect(urlForView(current, 'monitor').searchParams.has('event')).toBe(false);
        expect(urlForView(current, 'pingme').searchParams.get('event')).toBe('event-1');
    });

    it('preserves the active view when switching networks and drops a stale event selection', () => {
        const next = urlForNetwork(
            'https://slashmon.example/?view=pingme&network=testnet&event=testnet-event&utm_source=push',
            'mainnet',
        );
        expect(parseAppSearch(next.search)).toEqual({
            view: 'pingme',
            network: 'mainnet',
            selectedEventId: null,
            selectedSequencer: null,
        });
        expect(next.searchParams.has('event')).toBe(false);
        expect(next.searchParams.get('utm_source')).toBe('push');
    });

    it('opens and clears a sequencer record without carrying an event selection', () => {
        const address = '0x1111111111111111111111111111111111111111';
        const record = urlForSequencer(
            'https://slashmon.example/?view=pingme&event=event-1&utm_source=alert',
            address,
        );
        expect(record.searchParams.get('view')).toBe('pingme');
        expect(record.searchParams.get('sequencer')).toBe(address);
        expect(record.searchParams.has('event')).toBe(false);
        expect(record.searchParams.get('utm_source')).toBe('alert');

        expect(urlForSequencer(record.href, null).searchParams.has('sequencer')).toBe(false);
    });
});
