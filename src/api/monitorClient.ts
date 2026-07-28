import type { WebPushSubscriptionJson } from '@/lib/push';
import type {
    BackendStatus,
    CreatedWatchlist,
    MonitorSnapshot,
    NotificationTestResult,
    PublicConfig,
    TelegramLink,
    ValidatorSnapshot,
    Watchlist,
    WebPushConnectionResult,
    WebPushVerificationResult,
} from '@/types/api';
import {
    decodeConfig,
    decodeCreatedWatchlist,
    decodeMonitor,
    decodeNotificationTest,
    decodeStatus,
    decodeTelegramLink,
    decodeValidator,
    decodeWatchlist,
    decodeWebPushConnection,
    decodeWebPushVerification,
} from './monitorDecode';

const REQUEST_TIMEOUT_MS = 12_000;
const API_ROOT = '/api';

export class SlashmonApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string | null,
        readonly retryAfterMs: number | null = null,
    ) {
        super(message);
        this.name = 'SlashmonApiError';
    }
}

export class MonitorApiClient {
    private readonly baseUrl: string;

    constructor(baseUrl = import.meta.env.VITE_API_BASE_URL ?? '') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async getConfig(signal?: AbortSignal): Promise<PublicConfig> {
        return decodeConfig(await this.request('/config', { signal }));
    }

    async getStatus(signal?: AbortSignal): Promise<BackendStatus> {
        return decodeStatus(await this.request('/status', { signal }));
    }

    async getMonitor(signal?: AbortSignal): Promise<MonitorSnapshot> {
        return decodeMonitor(await this.request('/monitor', { signal }));
    }

    async getValidator(address: string, signal?: AbortSignal): Promise<ValidatorSnapshot> {
        return decodeValidator(await this.request(
            `/validators/${encodeURIComponent(address)}`,
            { signal },
        ));
    }

    async createWatchlist(addresses: readonly string[]): Promise<CreatedWatchlist> {
        return decodeCreatedWatchlist(await this.request('/watchlists', {
            method: 'POST',
            body: { addresses },
        }));
    }

    async getWatchlist(id: string, token: string, signal?: AbortSignal): Promise<Watchlist> {
        return decodeWatchlist(await this.request(`/watchlists/${encodeURIComponent(id)}`, {
            token,
            signal,
        }));
    }

    async updateWatchlist(
        id: string,
        token: string,
        addresses: readonly string[],
    ): Promise<Watchlist> {
        return decodeWatchlist(await this.request(`/watchlists/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            token,
            body: { addresses },
        }));
    }

    async deleteWatchlist(id: string, token: string): Promise<void> {
        await this.request(`/watchlists/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            token,
        });
    }

    async setWebPush(
        id: string,
        token: string,
        subscription: WebPushSubscriptionJson,
    ): Promise<WebPushConnectionResult> {
        return decodeWebPushConnection(await this.request(
            `/watchlists/${encodeURIComponent(id)}/channels/web-push`,
            {
                method: 'PUT',
                token,
                body: { subscription },
            },
        ));
    }

    async deleteWebPush(id: string, token: string): Promise<void> {
        await this.request(`/watchlists/${encodeURIComponent(id)}/channels/web-push`, {
            method: 'DELETE',
            token,
        });
    }

    async createTelegramLink(id: string, token: string): Promise<TelegramLink> {
        return decodeTelegramLink(await this.request(
            `/watchlists/${encodeURIComponent(id)}/channels/telegram`,
            { method: 'POST', token, body: {} },
        ));
    }

    async deleteTelegram(id: string, token: string): Promise<void> {
        await this.request(`/watchlists/${encodeURIComponent(id)}/channels/telegram`, {
            method: 'DELETE',
            token,
        });
    }

    async verifyWebPush(id: string, token: string): Promise<WebPushVerificationResult> {
        return decodeWebPushVerification(await this.request(
            `/watchlists/${encodeURIComponent(id)}/channels/web-push/verify`,
            {
                method: 'POST',
                token,
                body: {},
            },
        ));
    }

    async sendTest(id: string, token: string): Promise<NotificationTestResult> {
        return decodeNotificationTest(await this.request(`/watchlists/${encodeURIComponent(id)}/test`, {
            method: 'POST',
            token,
            body: {},
        }));
    }

    private async request(path: string, options: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        token?: string;
        body?: Record<string, unknown>;
        signal?: AbortSignal;
    } = {}): Promise<unknown> {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const abort = () => controller.abort();
        if (options.signal?.aborted) controller.abort();
        else options.signal?.addEventListener('abort', abort, { once: true });

        const headers = new Headers({ accept: 'application/json' });
        if (options.body) headers.set('content-type', 'application/json');
        if (options.token) headers.set('authorization', `Bearer ${options.token}`);

        try {
            const response = await fetch(`${this.baseUrl}${API_ROOT}${path}`, {
                method: options.method ?? 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal,
                cache: 'no-store',
            });
            const text = await response.text();
            const payload: unknown = text ? parseJson(text) : null;
            if (!response.ok) {
                const failure = apiFailure(payload);
                throw new SlashmonApiError(
                    failure.message ?? `Slashmon API returned HTTP ${response.status}`,
                    response.status,
                    failure.code,
                    failure.retryAfterMs ?? retryAfterHeaderMs(response.headers.get('retry-after')),
                );
            }
            return payload;
        }
        catch (error) {
            if (error instanceof SlashmonApiError) throw error;
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new Error(options.signal?.aborted
                    ? 'Slashmon API request was cancelled'
                    : 'Slashmon API did not respond in time');
            }
            throw error;
        }
        finally {
            window.clearTimeout(timeout);
            options.signal?.removeEventListener('abort', abort);
        }
    }
}

export const monitorApi = new MonitorApiClient();

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    }
    catch {
        throw new SlashmonApiError('Slashmon API returned invalid JSON', 502, 'invalid_json');
    }
}

function apiFailure(value: unknown): {
    code: string | null;
    message: string | null;
    retryAfterMs: number | null;
} {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { code: null, message: null, retryAfterMs: null };
    }
    const data = value as Record<string, unknown>;
    const nested = typeof data.error === 'object' &&
        data.error !== null &&
        !Array.isArray(data.error)
        ? data.error as Record<string, unknown>
        : data;
    return {
        code: typeof nested.code === 'string' ? nested.code : null,
        message: typeof nested.message === 'string' ? nested.message : null,
        retryAfterMs: nonNegativeInteger(data.retryAfterMs) ??
            nonNegativeInteger(nested.retryAfterMs),
    };
}

function nonNegativeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && (value as number) >= 0
        ? value as number
        : null;
}

function retryAfterHeaderMs(value: string | null): number | null {
    const text = value?.trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
        const seconds = Number(text);
        const milliseconds = seconds * 1_000;
        return Number.isSafeInteger(milliseconds) ? milliseconds : null;
    }
    const retryAt = Date.parse(text);
    return Number.isFinite(retryAt)
        ? Math.max(0, retryAt - Date.now())
        : null;
}
