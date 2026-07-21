import { useCallback, useMemo } from 'react';
import { Dashboard } from './components/Dashboard';
import { useSlashingMonitor } from './hooks/useSlashingMonitor';
import type { MonitorConfigInput } from './types/slashing';
import type { Address } from 'viem';
import { getCustomRpcUrl } from './lib/rpcOverride';
import { normalizeRpcUrls } from './lib/rpc';

const MAINNET_REGISTRY_ADDRESS = '0x35b22e09Ee0390539439E24f06Da43D83f90e298' as Address;
const TESTNET_REGISTRY_ADDRESS = '0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba' as Address;

const createConfig = (isTestnet: boolean): MonitorConfigInput => {
    const chainId = isTestnet ? 11155111 : 1;
    // Check for custom RPC URL in localStorage (set via debug view)
    const customRpcUrl = getCustomRpcUrl(chainId);
    const defaultL1RpcUrl = isTestnet
        ? (import.meta.env.VITE_TESTNET_L1_RPC_URL || import.meta.env.VITE_L1_RPC_URL || '')
        : (import.meta.env.VITE_L1_RPC_URL || '');

    return {
        l1RpcUrl: normalizeRpcUrls(customRpcUrl || defaultL1RpcUrl),
        chainId,
        registryAddress: (
            isTestnet
                ? (import.meta.env.VITE_TESTNET_REGISTRY_ADDRESS || TESTNET_REGISTRY_ADDRESS)
                : (import.meta.env.VITE_REGISTRY_ADDRESS || MAINNET_REGISTRY_ADDRESS)
        ) as Address,
        pollInterval: Number(import.meta.env.VITE_POLL_INTERVAL) || 180000,
        realtimeCountdownInterval: Number(import.meta.env.VITE_REALTIME_COUNTDOWN_INTERVAL) || 1000,
        hoursThresholdForDayDisplay: Number(import.meta.env.VITE_HOURS_THRESHOLD_FOR_DAY_DISPLAY) || 24,
        consoleLogProbability: Number(import.meta.env.VITE_CONSOLE_LOG_PROBABILITY) || 0.2,
    };
};

export function App() {
    // Determine network from URL query parameter
    const params = new URLSearchParams(window.location.search);
    const isTestnet = params.get('network') === 'testnet';
    const network = isTestnet ? 'testnet' : 'mainnet';

    // Memoize config to prevent re-creation on every render
    const config = useMemo(() => createConfig(isTestnet), [isTestnet]);
    const toggleNetwork = useCallback(() => {
        const next = new URL(window.location.href);
        if (isTestnet) {
            next.searchParams.delete('network');
        }
        else {
            next.searchParams.set('network', 'testnet');
        }
        window.location.assign(next);
    }, [isTestnet]);

    useSlashingMonitor(config);

    return (
        <div className="min-h-screen bg-brand-black text-white">
            <Dashboard network={network} onToggleNetwork={toggleNetwork} />
        </div>
    );
}
