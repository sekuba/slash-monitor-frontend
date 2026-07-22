const CUSTOM_L1_RPC_URL_KEY_PREFIX = 'customL1RpcUrl';

function getCustomRpcUrlKey(chainId: number): string {
    return `${CUSTOM_L1_RPC_URL_KEY_PREFIX}:${chainId}`;
}

export function getCustomRpcUrl(chainId: number): string | null {
    return localStorage.getItem(getCustomRpcUrlKey(chainId));
}

export function clearCustomRpcUrl(chainId: number): void {
    localStorage.removeItem(getCustomRpcUrlKey(chainId));
}

export function setCustomRpcUrl(chainId: number, url: string): void {
    localStorage.setItem(getCustomRpcUrlKey(chainId), url);
}
