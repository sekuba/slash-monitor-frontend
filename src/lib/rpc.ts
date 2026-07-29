import { http } from 'viem';

const HTTP_TIMEOUT_MS = 12_000;
const HTTP_RETRY_COUNT = 1;
const HTTP_RETRY_DELAY_MS = 250;

export function createPublicRpcTransport(input: string) {
    const url = input.trim();
    if (!url) throw new Error('One RPC URL is required');
    if (url.includes(',')) {
        throw new Error('Monitor accepts one RPC URL at a time');
    }
    return http(url, {
        timeout: HTTP_TIMEOUT_MS,
        retryCount: HTTP_RETRY_COUNT,
        retryDelay: HTTP_RETRY_DELAY_MS,
    });
}
