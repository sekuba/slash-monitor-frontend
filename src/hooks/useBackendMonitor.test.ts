import { describe, expect, it, vi } from 'vitest';
import { createBackendReadRequests } from './useBackendMonitor';
import type { EventPage, MonitorEvent, V2Status } from '@/types/v2Api';

const status = {} as V2Status;
const page = { data: [], nextCursor: null } satisfies EventPage;
const event = {} as MonitorEvent;

function fakeApi() {
    return {
        getStatus: vi.fn(async () => status),
        getEvents: vi.fn(async () => page),
        getEvent: vi.fn(async () => event),
        getSubscriptionStatus: vi.fn(async () => status),
        getSubscriptionEvents: vi.fn(async () => page),
        getSubscriptionEvent: vi.fn(async () => event),
    };
}

describe('backend read capability selection', () => {
    it('uses only public status and L1 event reads without stored credentials', async () => {
        const api = fakeApi();
        const requests = createBackendReadRequests(api, 'mainnet', null, 'event-1');

        await Promise.all([requests.status, requests.events, requests.selectedEvent]);

        expect(api.getStatus).toHaveBeenCalledWith('mainnet', undefined);
        expect(api.getEvents).toHaveBeenCalledWith('mainnet', undefined);
        expect(api.getEvent).toHaveBeenCalledWith('event-1', 'mainnet', undefined);
        expect(api.getSubscriptionStatus).not.toHaveBeenCalled();
        expect(api.getSubscriptionEvents).not.toHaveBeenCalled();
        expect(api.getSubscriptionEvent).not.toHaveBeenCalled();
    });

    it('uses watchlist-scoped reads and resolves a private deep-linked event', async () => {
        const api = fakeApi();
        const credentials = { id: 'watch-1', managementToken: 'secret-capability' };
        const requests = createBackendReadRequests(api, 'testnet', credentials, 'pending-event-1');

        await Promise.all([requests.status, requests.events, requests.selectedEvent]);

        expect(api.getSubscriptionStatus).toHaveBeenCalledWith(
            'watch-1',
            'secret-capability',
            'testnet',
            undefined,
        );
        expect(api.getSubscriptionEvents).toHaveBeenCalledWith(
            'watch-1',
            'secret-capability',
            'testnet',
            undefined,
        );
        expect(api.getSubscriptionEvent).toHaveBeenCalledWith(
            'watch-1',
            'pending-event-1',
            'secret-capability',
            'testnet',
            undefined,
        );
        expect(api.getStatus).not.toHaveBeenCalled();
        expect(api.getEvents).not.toHaveBeenCalled();
        expect(api.getEvent).not.toHaveBeenCalled();
    });
});
