import { Routes, Route } from 'react-router-dom';
import { useMemo } from 'react';
import { Dashboard } from './components/Dashboard';
import { useSlashingMonitor } from './hooks/useSlashingMonitor';
import type { SlashingMonitorConfig } from './types/slashing';
import type { Address } from 'viem';

const parseRpcUrls = (urlString: string): string | string[] => {
    const urls = urlString.split(',').map(url => url.trim()).filter(url => url.length > 0);
    return urls.length === 1 ? urls[0] : urls;
};

const createConfig = (isTestnet: boolean): SlashingMonitorConfig => {
    return {
        l1RpcUrl: parseRpcUrls(
            isTestnet
                ? (import.meta.env.VITE_TESTNET_L1_RPC_URL || import.meta.env.VITE_L1_RPC_URL || 'http://localhost:8545')
                : (import.meta.env.VITE_L1_RPC_URL || 'http://localhost:8545')
        ),
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
        nodeAdminUrl: isTestnet
            ? (import.meta.env.VITE_TESTNET_NODE_ADMIN_URL || import.meta.env.VITE_NODE_ADMIN_URL || '')
            : (import.meta.env.VITE_NODE_ADMIN_URL || ''),
        slashingRoundSize: 0,
        slashingRoundSizeInEpochs: 0,
        executionDelayInRounds: 0,
        lifetimeInRounds: 0,
        slashOffsetInRounds: 0,
        quorum: 0,
        committeeSize: 0,
        slotDuration: 0,
        epochDuration: 0,
        l2PollInterval: Number(import.meta.env.VITE_L2_POLL_INTERVAL) || 180000,
        realtimeCountdownInterval: Number(import.meta.env.VITE_REALTIME_COUNTDOWN_INTERVAL) || 1000,
        l1RoundCacheTTL: Number(import.meta.env.VITE_L1_ROUND_CACHE_TTL) || 120000,
        detailsCacheTTL: Number(import.meta.env.VITE_DETAILS_CACHE_TTL) || 300000,
        copyFeedbackDuration: Number(import.meta.env.VITE_COPY_FEEDBACK_DURATION) || 2000,
        hoursThresholdForDayDisplay: Number(import.meta.env.VITE_HOURS_THRESHOLD_FOR_DAY_DISPLAY) || 24,
        consoleLogProbability: Number(import.meta.env.VITE_CONSOLE_LOG_PROBABILITY) || 0.2,
    };
};

function MonitorPage({ isTestnet }: { isTestnet: boolean }) {
    // Memoize config to prevent re-creation on every render
    const config = useMemo(() => createConfig(isTestnet), [isTestnet]);
    useSlashingMonitor(config);

    return (
        <div className="min-h-screen bg-gray-950 text-white">
            <Dashboard />
        </div>
    );
}

export function App() {
    return (
        <Routes>
            <Route path="/" element={<MonitorPage isTestnet={false} />} />
            <Route path="/testnet" element={<MonitorPage isTestnet={true} />} />
        </Routes>
    );
}
