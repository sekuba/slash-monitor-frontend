import { fallback, http } from 'viem';

const HTTP_TIMEOUT_MS = 12_000;
const HTTP_RETRY_COUNT = 1;
const HTTP_RETRY_DELAY_MS = 250;

export function parseRpcUrls(value: string | string[] | null | undefined): string[] {
    if (!value) {
        return [];
    }

    const rawValues = Array.isArray(value) ? value : [value];
    const urls = rawValues
        .flatMap((item) => item.split(','))
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    return Array.from(new Set(urls));
}

export function normalizeRpcUrls(value: string | string[]): string | string[] {
    const urls = parseRpcUrls(value);
    return urls.length <= 1 ? (urls[0] ?? '') : urls;
}

export function createPublicRpcTransport(urls: string | string[]) {
    const normalizedUrls = parseRpcUrls(urls);
    const transports = normalizedUrls.map((url) =>
        http(url, {
            timeout: HTTP_TIMEOUT_MS,
            retryCount: HTTP_RETRY_COUNT,
            retryDelay: HTTP_RETRY_DELAY_MS,
        })
    );

    if (transports.length === 0) {
        throw new Error('At least one RPC URL is required');
    }

    if (transports.length === 1) {
        return transports[0];
    }

    return fallback(transports, {
        rank: {
            sampleCount: 5,
            timeout: 1_000,
            weights: {
                latency: 0.25,
                stability: 0.75,
            },
        },
        retryCount: 0,
    });
}
