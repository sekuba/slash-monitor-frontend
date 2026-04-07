import { useCallback, useMemo } from 'react';
import { Dashboard } from './components/Dashboard';
import { useSlashingMonitor } from './hooks/useSlashingMonitor';
import type { MonitorConfigInput } from './types/slashing';
import type { Address } from 'viem';
import { getCustomRpcUrl } from './lib/cacheManager';
import { normalizeRpcUrls } from './lib/rpc';

const createConfig = (isTestnet: boolean): MonitorConfigInput => {
    // Check for custom RPC URL in localStorage (set via debug view)
    const customRpcUrl = getCustomRpcUrl();
    const defaultL1RpcUrl = isTestnet
        ? (import.meta.env.VITE_TESTNET_L1_RPC_URL || import.meta.env.VITE_L1_RPC_URL || 'http://localhost:8545')
        : (import.meta.env.VITE_L1_RPC_URL || 'http://localhost:8545');

    return {
        l1RpcUrl: normalizeRpcUrls(customRpcUrl || defaultL1RpcUrl),
        tallySlashingProposerAddress: (
            isTestnet
                ? (import.meta.env.VITE_TESTNET_TALLY_PROPOSER_ADDRESS || import.meta.env.VITE_TALLY_PROPOSER_ADDRESS || '0x')
                : (import.meta.env.VITE_TALLY_PROPOSER_ADDRESS || '0x')
        ) as Address,
        slasherAddress: (
            isTestnet
                ? (import.meta.env.VITE_TESTNET_SLASHER_ADDRESS || import.meta.env.VITE_SLASHER_ADDRESS || '0x')
                : (import.meta.env.VITE_SLASHER_ADDRESS || '0x')
        ) as Address,
        rollupAddress: (
            isTestnet
                ? (import.meta.env.VITE_TESTNET_ROLLUP_ADDRESS || import.meta.env.VITE_ROLLUP_ADDRESS || '0x')
                : (import.meta.env.VITE_ROLLUP_ADDRESS || '0x')
        ) as Address,
        l2PollInterval: Number(import.meta.env.VITE_L2_POLL_INTERVAL) || 180000,
        realtimeCountdownInterval: Number(import.meta.env.VITE_REALTIME_COUNTDOWN_INTERVAL) || 1000,
        l1RoundCacheTTL: Number(import.meta.env.VITE_L1_ROUND_CACHE_TTL) || 120000,
        detailsCacheTTL: Number(import.meta.env.VITE_DETAILS_CACHE_TTL) || 300000,
        copyFeedbackDuration: Number(import.meta.env.VITE_COPY_FEEDBACK_DURATION) || 2000,
        hoursThresholdForDayDisplay: Number(import.meta.env.VITE_HOURS_THRESHOLD_FOR_DAY_DISPLAY) || 24,
        consoleLogProbability: Number(import.meta.env.VITE_CONSOLE_LOG_PROBABILITY) || 0.2,
        lookbackRounds: Number(
            isTestnet
                ? (import.meta.env.VITE_TESTNET_LOOKBACK_ROUNDS || import.meta.env.VITE_LOOKBACK_ROUNDS || 0)
                : (import.meta.env.VITE_LOOKBACK_ROUNDS || 0)
        ),
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
        window.location.href = isTestnet ? '/' : '/?network=testnet';
    }, [isTestnet]);

    useSlashingMonitor(config);

    return (
        <div className="min-h-screen bg-gray-950 text-white">
            <Dashboard network={network} onToggleNetwork={toggleNetwork} />
        </div>
    );
}
