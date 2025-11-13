import { Dashboard } from './components/Dashboard';
import { useSlashingMonitor } from './hooks/useSlashingMonitor';
import type { SlashingMonitorConfig } from './types/slashing';
import type { Address } from 'viem';
const parseRpcUrls = (urlString: string): string | string[] => {
    const urls = urlString.split(',').map(url => url.trim()).filter(url => url.length > 0);
    return urls.length === 1 ? urls[0] : urls;
};
const slashingConfig: SlashingMonitorConfig = {
    l1RpcUrl: parseRpcUrls(import.meta.env.VITE_L1_RPC_URL || 'http://localhost:8545'),
    tallySlashingProposerAddress: (import.meta.env.VITE_TALLY_PROPOSER_ADDRESS || '0x') as Address,
    slasherAddress: (import.meta.env.VITE_SLASHER_ADDRESS || '0x') as Address,
    rollupAddress: (import.meta.env.VITE_ROLLUP_ADDRESS || '0x') as Address,
    nodeAdminUrl: import.meta.env.VITE_NODE_ADMIN_URL || '',
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
    maxExecutedRoundsToShow: Number(import.meta.env.VITE_MAX_EXECUTED_ROUNDS_TO_SHOW) || 10,
    maxRoundsToScanForHistory: Number(import.meta.env.VITE_MAX_ROUNDS_TO_SCAN_FOR_HISTORY) || 20,
    copyFeedbackDuration: Number(import.meta.env.VITE_COPY_FEEDBACK_DURATION) || 2000,
    hoursThresholdForDayDisplay: Number(import.meta.env.VITE_HOURS_THRESHOLD_FOR_DAY_DISPLAY) || 24,
    consoleLogProbability: Number(import.meta.env.VITE_CONSOLE_LOG_PROBABILITY) || 0.2,
};
export function App() {
    useSlashingMonitor(slashingConfig);
    return (<div className="min-h-screen bg-gray-950 text-white">
      <Dashboard />
    </div>);
}
