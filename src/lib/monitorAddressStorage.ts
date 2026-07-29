import type { MonitorNetwork } from '@/types/backendApi';

const PREFIX = 'slashmon:v3:monitor-addresses:';

export function loadMonitorAddresses(network: MonitorNetwork): string[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(`${PREFIX}${network}`) ?? '[]');
        return Array.isArray(value)
            ? value.filter((item): item is string =>
                typeof item === 'string' && /^0x[0-9a-f]{40}$/.test(item))
            : [];
    }
    catch {
        return [];
    }
}

export function saveMonitorAddresses(
    network: MonitorNetwork,
    addresses: readonly string[],
): void {
    localStorage.setItem(`${PREFIX}${network}`, JSON.stringify(addresses));
}
