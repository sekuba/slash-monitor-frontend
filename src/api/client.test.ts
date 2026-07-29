import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlashmonApiClient } from './client';

describe('Slashmon v3 API client', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('uses the case API and keeps watch authority in the bearer header', async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            network: 'mainnet',
            addresses: [],
            endpoints: [],
            cases: [],
            createdAt: '2026-07-29T00:00:00.000Z',
            updatedAt: '2026-07-29T00:00:00.000Z',
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new SlashmonApiClient('https://api.example');
        await client.getWatch(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'secret-token',
        );

        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'https://api.example/api/v3/watches/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        );
        expect((fetchMock.mock.calls[0][1]?.headers as Headers).get('authorization'))
            .toBe('Bearer secret-token');
    });

    it('opens exact case IDs without an event feed', async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
            new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new SlashmonApiClient('https://api.example');
        await client.getCase('case:mainnet:lineage:address:42');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'https://api.example/api/v3/cases/case%3Amainnet%3Alineage%3Aaddress%3A42',
        );
    });
});
