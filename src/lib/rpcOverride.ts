const STORAGE_KEY_PREFIX = 'slashmon:monitor-rpc:';

function storageKey(chainId: number): string {
    return `${STORAGE_KEY_PREFIX}${chainId}`;
}

export function getRpcOverride(chainId: number): string | null {
    try {
        const value = localStorage.getItem(storageKey(chainId));
        return value === null ? null : validateRpcOverride(value);
    }
    catch {
        return null;
    }
}

export function setRpcOverride(chainId: number, input: string): string {
    const url = validateRpcOverride(input);
    localStorage.setItem(storageKey(chainId), url);
    return url;
}

export function clearRpcOverride(chainId: number): void {
    localStorage.removeItem(storageKey(chainId));
}

export function validateRpcOverride(input: string): string {
    const value = input.trim();
    let url: URL;

    try {
        url = new URL(value);
    }
    catch {
        throw new Error('Enter a valid RPC URL');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('RPC URL must use HTTP or HTTPS');
    }
    if (url.username || url.password) {
        throw new Error('RPC URL must not contain a username or password');
    }
    if (url.hash) {
        throw new Error('RPC URL must not contain a fragment');
    }

    return value;
}
