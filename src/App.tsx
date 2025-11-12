import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dashboard } from './components/Dashboard'
import { useSlashingMonitor } from './hooks/useSlashingMonitor'
import type { SlashingMonitorConfig } from './types/slashing'
import type { Address } from 'viem'

// Create query client
const queryClient = new QueryClient()

// Parse L1 RPC URLs (supports comma-separated list for failover)
const parseRpcUrls = (urlString: string): string | string[] => {
  const urls = urlString.split(',').map(url => url.trim()).filter(url => url.length > 0)
  return urls.length === 1 ? urls[0] : urls
}

// Configuration loaded from environment variables
const slashingConfig: SlashingMonitorConfig = {
  // L1 Configuration
  l1RpcUrl: parseRpcUrls(import.meta.env.VITE_L1_RPC_URL || 'http://localhost:8545'),
  tallySlashingProposerAddress: (import.meta.env.VITE_TALLY_PROPOSER_ADDRESS || '0x') as Address,
  slasherAddress: (import.meta.env.VITE_SLASHER_ADDRESS || '0x') as Address,
  rollupAddress: (import.meta.env.VITE_ROLLUP_ADDRESS || '0x') as Address,

  // L2 Configuration
  nodeAdminUrl: import.meta.env.VITE_NODE_ADMIN_URL || 'http://localhost:8880',

  // Network Parameters (loaded dynamically from L1 contracts during initialization)
  // These placeholder values are immediately overwritten by contract data in useSlashingMonitor
  slashingRoundSize: 0,
  slashingRoundSizeInEpochs: 0,
  executionDelayInRounds: 0,
  lifetimeInRounds: 0,
  slashOffsetInRounds: 0,
  quorum: 0,
  committeeSize: 0,
  slotDuration: 0,
  epochDuration: 0,

  // Polling & Update Intervals
  l2PollInterval: Number(import.meta.env.VITE_L2_POLL_INTERVAL) || 120000, // 2 minutes
  realtimeCountdownInterval: Number(import.meta.env.VITE_REALTIME_COUNTDOWN_INTERVAL) || 1000, // 1 second

  // Cache Configuration
  l1RoundCacheTTL: Number(import.meta.env.VITE_L1_ROUND_CACHE_TTL) || 30000, // 30 seconds
  detailsCacheTTL: Number(import.meta.env.VITE_DETAILS_CACHE_TTL) || 300000, // 5 minutes

  // Scanning Configuration
  maxExecutedRoundsToShow: Number(import.meta.env.VITE_MAX_EXECUTED_ROUNDS_TO_SHOW) || 2,
  maxRoundsToScanForHistory: Number(import.meta.env.VITE_MAX_ROUNDS_TO_SCAN_FOR_HISTORY) || 5,

  // UI/UX Configuration
  copyFeedbackDuration: Number(import.meta.env.VITE_COPY_FEEDBACK_DURATION) || 2000, // 2 seconds
  hoursThresholdForDayDisplay: Number(import.meta.env.VITE_HOURS_THRESHOLD_FOR_DAY_DISPLAY) || 24,

  // Debug Configuration
  consoleLogProbability: Number(import.meta.env.VITE_CONSOLE_LOG_PROBABILITY) || 0.2, // 20%

}

function AppContent() {
  useSlashingMonitor(slashingConfig)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Dashboard />
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}
