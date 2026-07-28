import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorApiClient, SlashmonApiError } from './monitorClient';

const VALIDATOR = '0x1111111111111111111111111111111111111111';

describe('MonitorApiClient', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            setTimeout: globalThis.setTimeout,
            clearTimeout: globalThis.clearTimeout,
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('uses only the unversioned fixed-network resources', async () => {
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            const body = url.endsWith('/config')
                ? {
                    network: 'mainnet',
                    maxWatchlistAddresses: 100,
                    channels: {
                        webPush: { available: false, publicKey: null },
                        telegram: { available: false, botUsername: null },
                    },
                }
                : {
                    address: VALIDATOR,
                    observedAt: null,
                    cases: [],
                    nodeOffenses: [],
                    slashes: { confirmed: [], removed: [] },
                };
            return new Response(JSON.stringify(body), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        const client = new MonitorApiClient('https://api.example');

        await client.getConfig();
        await client.getValidator(VALIDATOR);

        expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
            'https://api.example/api/config',
            `https://api.example/api/validators/${VALIDATOR}`,
        ]);
    });

    it('keeps the management capability in Authorization for watchlist updates', async () => {
        const fetchMock = vi.fn(async (
            _input: string | URL | Request,
            _init?: RequestInit,
        ) => new Response(JSON.stringify({
            id: '11111111-1111-4111-8111-111111111111',
            addresses: [VALIDATOR],
            channels: {
                webPush: { connected: false, enabled: false, verified: false },
                telegram: { connected: false, enabled: false, verified: false },
            },
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new MonitorApiClient('https://api.example');

        await client.updateWatchlist('watch/1', 'management-secret', [VALIDATOR]);

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://api.example/api/watchlists/watch%2F1');
        expect(init?.method).toBe('PATCH');
        expect((init?.headers as Headers).get('authorization')).toBe('Bearer management-secret');
        expect(init?.cache).toBe('no-store');
    });

    it('surfaces the nested backend error code and message', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            error: {
                code: 'watchlist_capacity',
                message: 'Watchlist capacity is full',
            },
        }), { status: 503 })));
        const client = new MonitorApiClient('https://api.example');

        await expect(client.createWatchlist([VALIDATOR])).rejects.toMatchObject({
            name: 'SlashmonApiError',
            status: 503,
            code: 'watchlist_capacity',
            message: 'Watchlist capacity is full',
        } satisfies Partial<SlashmonApiError>);
    });

    it('returns exact notification mutation results', async () => {
        const fetchMock = vi.fn(async (
            input: string | URL | Request,
            init?: RequestInit,
        ) => {
            const url = String(input);
            const body = url.endsWith('/channels/web-push/verify')
                ? { verified: false, queued: 0 }
                : url.endsWith('/channels/web-push') && init?.method === 'PUT'
                    ? {
                        connected: true,
                        enabled: true,
                        verified: false,
                        verificationQueued: 1,
                    }
                    : { queued: 2 };
            return new Response(JSON.stringify(body), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        const client = new MonitorApiClient('https://api.example');
        const id = '11111111-1111-4111-8111-111111111111';

        await expect(client.setWebPush(id, 'management-secret', {
            endpoint: 'https://push.example/subscription',
            expirationTime: null,
            keys: { auth: 'auth', p256dh: 'p256dh' },
        })).resolves.toMatchObject({
            verified: false,
            verificationQueued: 1,
        });
        await expect(client.verifyWebPush(id, 'management-secret')).resolves.toEqual({
            verified: false,
            queued: 0,
        });
        await expect(client.sendTest(id, 'management-secret')).resolves.toEqual({
            queued: 2,
        });
    });

    it('preserves the exact JSON retry delay ahead of the rounded header', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            error: {
                code: 'notification_test_rate_limited',
                message: 'A notification test was sent recently',
            },
            retryAfterMs: 12_345,
        }), {
            status: 429,
            headers: { 'retry-after': '13' },
        })));
        const client = new MonitorApiClient('https://api.example');

        await expect(client.createWatchlist([VALIDATOR])).rejects.toMatchObject({
            status: 429,
            retryAfterMs: 12_345,
        } satisfies Partial<SlashmonApiError>);
    });

    it('falls back to a Retry-After header when the JSON has no delay', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            error: {
                code: 'rate_limited',
                message: 'Too many requests',
            },
        }), {
            status: 429,
            headers: { 'retry-after': '17' },
        })));
        const client = new MonitorApiClient('https://api.example');

        await expect(client.createWatchlist([VALIDATOR])).rejects.toMatchObject({
            retryAfterMs: 17_000,
        } satisfies Partial<SlashmonApiError>);
    });
});
