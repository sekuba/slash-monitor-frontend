import {
    decodeCreatedSubscription,
    decodeEventDetail,
    decodeEventPage,
    decodePublicConfig,
    decodeStatus,
    decodeSubscription,
    decodeTelegramLink,
} from './decode';
import type { WebPushSubscriptionJson } from '@/lib/push';
import type {
    CreatedSubscription,
    EventPage,
    ManagedSubscription,
    MonitorEvent,
    MonitorNetwork,
    TelegramLink,
    BackendConfig,
    BackendStatus,
} from '@/types/backendApi';

const REQUEST_TIMEOUT_MS = 12_000;
const API_ROOT = '/api/v2';

export class SlashmonApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string | null,
    ) {
        super(message);
        this.name = 'SlashmonApiError';
    }
}

export class SlashmonApiClient {
    private readonly baseUrl: string;

    constructor(baseUrl = import.meta.env.VITE_API_BASE_URL ?? '') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async getConfig(signal?: AbortSignal): Promise<BackendConfig> {
        return decodePublicConfig(await this.request('/config', { signal }));
    }

    async getStatus(network: MonitorNetwork, signal?: AbortSignal): Promise<BackendStatus> {
        return decodeStatus(await this.request(`/status?network=${network}`, { signal }), network);
    }

    async getEvents(network: MonitorNetwork, signal?: AbortSignal, cursor?: string): Promise<EventPage> {
        const query = new URLSearchParams({ network, limit: '40' });
        if (cursor) {
            query.set('cursor', cursor);
        }
        return decodeEventPage(await this.request(`/events?${query}`, { signal }), network);
    }

    async getSubscriptionEvents(
        id: string,
        token: string,
        network: MonitorNetwork,
        signal?: AbortSignal,
        cursor?: string,
    ): Promise<EventPage> {
        const query = new URLSearchParams({ limit: '40' });
        if (cursor) {
            query.set('cursor', cursor);
        }
        return decodeEventPage(await this.request(
            `/subscriptions/${encodeURIComponent(id)}/events?${query}`,
            { token, signal },
        ), network);
    }

    async getEvent(id: string, network: MonitorNetwork, signal?: AbortSignal): Promise<MonitorEvent> {
        const query = new URLSearchParams({ network });
        return decodeEventDetail(await this.request(
            `/events/${encodeURIComponent(id)}?${query}`,
            { signal },
        ), network);
    }

    async getSubscriptionEvent(
        subscriptionId: string,
        eventId: string,
        token: string,
        network: MonitorNetwork,
        signal?: AbortSignal,
    ): Promise<MonitorEvent> {
        return decodeEventDetail(await this.request(
            `/subscriptions/${encodeURIComponent(subscriptionId)}/events/${encodeURIComponent(eventId)}`,
            { token, signal },
        ), network);
    }

    async createSubscription(network: MonitorNetwork, sequencers: readonly string[]): Promise<CreatedSubscription> {
        return decodeCreatedSubscription(await this.request('/subscriptions', {
            method: 'POST',
            body: { network, addresses: sequencers },
        }));
    }

    async getSubscription(id: string, token: string, signal?: AbortSignal): Promise<ManagedSubscription> {
        return decodeSubscription(await this.request(`/subscriptions/${encodeURIComponent(id)}`, {
            token,
            signal,
        }));
    }

    async updateSubscription(
        id: string,
        token: string,
        sequencers: readonly string[],
    ): Promise<ManagedSubscription> {
        return decodeSubscription(await this.request(`/subscriptions/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            token,
            body: { addresses: sequencers },
        }));
    }

    async deleteSubscription(id: string, token: string): Promise<void> {
        await this.request(`/subscriptions/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            token,
        });
    }

    async setWebPushChannel(
        id: string,
        token: string,
        subscription: WebPushSubscriptionJson,
    ): Promise<void> {
        await this.request(
            `/subscriptions/${encodeURIComponent(id)}/channels/web-push`,
            { method: 'PUT', token, body: { subscription } },
        );
    }

    async deleteWebPushChannel(id: string, token: string): Promise<void> {
        await this.request(
            `/subscriptions/${encodeURIComponent(id)}/channels/web-push`,
            { method: 'DELETE', token },
        );
    }

    async createTelegramLink(id: string, token: string): Promise<TelegramLink> {
        return decodeTelegramLink(await this.request(
            `/subscriptions/${encodeURIComponent(id)}/channels/telegram-link`,
            { method: 'POST', token, body: {} },
        ));
    }

    async sendTest(id: string, token: string): Promise<void> {
        await this.request(`/subscriptions/${encodeURIComponent(id)}/test`, {
            method: 'POST',
            token,
            body: {},
        });
    }

    private async request(path: string, options: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        token?: string;
        body?: Record<string, unknown>;
        signal?: AbortSignal;
    } = {}): Promise<unknown> {
        const timeoutController = new AbortController();
        const timeout = window.setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
        const handleExternalAbort = () => timeoutController.abort();
        if (options.signal?.aborted) {
            timeoutController.abort();
        }
        else {
            options.signal?.addEventListener('abort', handleExternalAbort, { once: true });
        }
        const headers = new Headers({ accept: 'application/json' });
        if (options.body) {
            headers.set('content-type', 'application/json');
        }
        if (options.token) {
            headers.set('authorization', `Bearer ${options.token}`);
        }

        try {
            const response = await fetch(`${this.baseUrl}${API_ROOT}${path}`, {
                method: options.method ?? 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: timeoutController.signal,
                cache: 'no-store',
            });
            const text = await response.text();
            const payload: unknown = text ? parseJson(text) : null;
            if (!response.ok) {
                const apiError = readApiError(payload);
                throw new SlashmonApiError(
                    apiError.message ?? `Slashmon API request failed with HTTP ${response.status}`,
                    response.status,
                    apiError.code,
                );
            }
            return payload;
        }
        catch (error) {
            if (error instanceof SlashmonApiError) {
                throw error;
            }
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new Error(options.signal?.aborted
                    ? 'Slashmon API request was cancelled'
                    : 'Slashmon API did not respond in time');
            }
            throw error;
        }
        finally {
            window.clearTimeout(timeout);
            options.signal?.removeEventListener('abort', handleExternalAbort);
        }
    }
}

export const slashmonApi = new SlashmonApiClient();

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    }
    catch {
        throw new SlashmonApiError('Slashmon API returned invalid JSON', 502, 'invalid_json');
    }
}

function readApiError(value: unknown): { code: string | null; message: string | null } {
    if (!isRecord(value) || !isRecord(value.error)) {
        return { code: null, message: null };
    }
    return {
        code: typeof value.error.code === 'string' ? value.error.code : null,
        message: typeof value.error.message === 'string' ? value.error.message : null,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
