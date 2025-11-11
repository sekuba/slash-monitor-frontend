import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dashboard } from './components/Dashboard'
import { useSlashingMonitor } from './hooks/useSlashingMonitor'
import type { SlashingMonitorConfig } from './types/slashing'
import type { Address } from 'viem'

// Create query client
const queryClient = new QueryClient()

// Configuration loaded from environment variables
const slashingConfig: SlashingMonitorConfig = {
  // L1 Configuration
  l1RpcUrl: import.meta.env.VITE_L1_RPC_URL || 'http://localhost:8545',
  tallySlashingProposerAddress: (import.meta.env.VITE_TALLY_PROPOSER_ADDRESS || '0x') as Address,
  slasherAddress: (import.meta.env.VITE_SLASHER_ADDRESS || '0x') as Address,
  rollupAddress: (import.meta.env.VITE_ROLLUP_ADDRESS || '0x') as Address,

  // L2 Configuration
  nodeRpcUrl: import.meta.env.VITE_NODE_RPC_URL || 'http://localhost:8080',
  nodeAdminUrl: import.meta.env.VITE_NODE_ADMIN_URL || 'http://localhost:8880',

  // Network Parameters (will be loaded from contracts)
  slashingRoundSize: 4,
  slashingRoundSizeInEpochs: 2,
  executionDelayInRounds: 1,
  lifetimeInRounds: 2,
  slashOffsetInRounds: 2,
  quorum: 3,
  committeeSize: 4,
  slotDuration: 8,
  epochDuration: 2,

  // Slash amounts (will be loaded from contracts)
  slashAmountSmall: 20n * 10n ** 18n,
  slashAmountMedium: 40n * 10n ** 18n,
  slashAmountLarge: 60n * 10n ** 18n,

  // Polling Interval
  l2PollInterval: 120000, // 2 minutes - sufficient for days-long slashing window

  // Vetoer
  vetoerAddress: import.meta.env.VITE_VETOER_ADDRESS as Address | undefined,
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
