export const CUSTOM_L1_RPC_URL_KEY = 'customL1RpcUrl';

export function getCustomRpcUrl(): string | null {
    return localStorage.getItem(CUSTOM_L1_RPC_URL_KEY);
}

export function clearCustomRpcUrl(): void {
    localStorage.removeItem(CUSTOM_L1_RPC_URL_KEY);
}

export function reloadApp(): void {
    window.location.reload();
}

export function updateRpcUrl(url: string): void {
    localStorage.setItem(CUSTOM_L1_RPC_URL_KEY, url);
    reloadApp();
}
