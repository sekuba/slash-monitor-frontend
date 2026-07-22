import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlashmonApiClient } from './client';

const address = '0x00000000000000000000000000000000000000aa';
const source = {
    status: 'healthy',
    dataFresh: true,
    dataAgeMs: 10,
    lastAttemptAt: '2026-07-21T10:00:00.000Z',
    lastSuccessAt: '2026-07-21T10:00:00.000Z',
    lastError: null,
};

describe('Slashmon capability-scoped API reads', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            setTimeout: globalThis.setTimeout,
            clearTimeout: globalThis.clearTimeout,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps the capability in Authorization across status, history, and event detail reads', async () => {
        const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
            const url = String(input);
            const payload = url.endsWith('/status')
                ? {
                    schemaVersion: 2,
                    network: 'mainnet',
                    status: 'healthy',
                    generatedAt: '2026-07-21T10:00:01.000Z',
                    sources: { l1: source, aztec: source },
                    delivery: { status: 'healthy' },
                    pendingOffenses: [],
                }
                : url.includes('/events/pending-event-1')
                    ? {
                        schemaVersion: 2,
                        data: event('pending-event-1', 'pending_offense_detected', 'aztec_node', 'pending'),
                    }
                    : {
                        schemaVersion: 2,
                        data: [event('event-1', 'onchain_targeted', 'ethereum_l1', 'confirmed')],
                        pagination: { nextCursor: null },
                    };
            return new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const client = new SlashmonApiClient('https://api.slashmon.invalid');

        await client.getSubscriptionStatus('watch/1', 'bearer-secret', 'mainnet');
        await client.getSubscriptionEvents('watch/1', 'bearer-secret', 'mainnet');
        const detail = await client.getSubscriptionEvent(
            'watch/1',
            'pending-event-1',
            'bearer-secret',
            'mainnet',
        );

        expect(detail.certainty).toBe('pending');
        expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
            'https://api.slashmon.invalid/api/v2/subscriptions/watch%2F1/status',
            'https://api.slashmon.invalid/api/v2/subscriptions/watch%2F1/events?limit=40',
            'https://api.slashmon.invalid/api/v2/subscriptions/watch%2F1/events/pending-event-1',
        ]);
        for (const [, init] of fetchMock.mock.calls) {
            expect((init?.headers as Headers).get('authorization')).toBe('Bearer bearer-secret');
            expect(init?.cache).toBe('no-store');
        }
    });
});

function event(id: string, type: string, eventSource: string, certainty: 'pending' | 'confirmed') {
    return {
        id,
        network: 'mainnet',
        type,
        source: eventSource,
        certainty,
        sequencer: address,
        targets: [address],
        title: 'Test event',
        body: 'Test event body',
        data: {},
        occurredAt: '2026-07-21T10:00:00.000Z',
    };
}
