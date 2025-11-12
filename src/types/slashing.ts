import type { Address } from 'viem'

/**
 * Configuration for the slashing monitor
 */
export interface SlashingMonitorConfig {
  // L1 Configuration
  l1RpcUrl: string | string[] // Single URL or array of URLs for failover
  tallySlashingProposerAddress: Address
  slasherAddress: Address
  rollupAddress: Address

  // L2 Configuration
  nodeAdminUrl: string // http://localhost:8880

  // Network Parameters (loaded dynamically from L1 contracts during initialization)
  // The initial values provided here are overwritten by contract data
  slashingRoundSize: number
  slashingRoundSizeInEpochs: number
  executionDelayInRounds: number
  lifetimeInRounds: number
  slashOffsetInRounds: number
  quorum: number
  committeeSize: number
  slotDuration: number // in seconds
  epochDuration: number // in slots

  // Polling & Update Intervals
  l2PollInterval: number // Background poll interval (default: 120000ms = 2 minutes)
  realtimeCountdownInterval: number // Real-time countdown update interval (default: 1000ms = 1 second)

  // Cache Configuration
  l1RoundCacheTTL: number // L1 monitor round cache TTL in ms (default: 30000ms = 30 seconds)
  detailsCacheTTL: number // Slashing detector details cache TTL in ms (default: 300000ms = 5 minutes)

  // Scanning Configuration
  maxExecutedRoundsToShow: number // Max executed rounds to show in history (default: 2)
  maxRoundsToScanForHistory: number // Max rounds back to scan for executed rounds (default: 5)

  // UI/UX Configuration
  copyFeedbackDuration: number // Copy button feedback timeout in ms (default: 2000ms = 2 seconds)
  hoursThresholdForDayDisplay: number // Hours threshold for displaying days (default: 24)

  // Debug Configuration
  consoleLogProbability: number // Probability of logging poll results (0-1, default: 0.2 = 20%)
}

/**
 * Represents a slash action against a validator
 */
export interface SlashAction {
  validator: Address
  slashAmount: bigint
}

/**
 * Information about a slashing round
 */
export interface RoundInfo {
  round: bigint
  voteCount: bigint
  isExecuted: boolean
}

/**
 * Status of an executable round
 */
export type RoundStatus =
  | 'voting' // Still in voting phase
  | 'quorum-reached' // Quorum reached, waiting for execution delay
  | 'in-veto-window' // In veto/execution window (just became executable)
  | 'executable' // Executable and within lifetime
  | 'executed' // Already executed
  | 'expired' // Past lifetime

/**
 * Complete information about a detected slashing round
 */
export interface DetectedSlashing {
  round: bigint
  status: RoundStatus
  voteCount: bigint
  isExecuted: boolean
  isVetoed: boolean

  // Computed when in veto window
  committees?: Address[][]
  slashActions?: SlashAction[]
  payloadAddress?: Address

  // Timing information
  slotWhenExecutable?: bigint
  slotWhenExpires?: bigint
  secondsUntilExecutable?: number
  secondsUntilExpires?: number
  lastUpdatedTimestamp?: number // Timestamp when timing info was calculated (for real-time countdown)

  // Metadata
  targetEpochs?: bigint[]
  totalSlashAmount?: bigint
  affectedValidatorCount?: number
}

/**
 * Offense types from the node RPC
 */
export enum OffenseType {
  UNKNOWN = 0,
  /** The data for proving an epoch was not publicly available, we slash its committee */
  DATA_WITHHOLDING = 1,
  /** An epoch was not successfully proven in time, we slash its committee */
  VALID_EPOCH_PRUNED = 2,
  /** A proposer failed to attest or propose during an epoch according to the Sentinel */
  INACTIVITY = 3,
  /** A proposer sent an invalid block proposal over the p2p network to the committee */
  BROADCASTED_INVALID_BLOCK_PROPOSAL = 4,
  /** A proposer pushed to L1 a block with insufficient committee attestations */
  PROPOSED_INSUFFICIENT_ATTESTATIONS = 5,
  /** A proposer pushed to L1 a block with incorrect committee attestations (ie signature from a non-committee member) */
  PROPOSED_INCORRECT_ATTESTATIONS = 6,
  /** A committee member attested to a block that was built as a descendent of an invalid block (as in a block with invalid attestations) */
  ATTESTED_DESCENDANT_OF_INVALID = 7,
}

/**
 * Offense detected by the node
 */
export interface Offense {
  validator: Address
  offenseType: OffenseType
  amount: bigint
  epoch?: bigint
  blockNumber?: bigint
  round?: bigint
}

/**
 * Statistics for the dashboard
 */
export interface SlashingStats {
  currentRound: bigint
  totalRoundsMonitored: number
  activeSlashings: number
  vetoedPayloads: number
  executedRounds: number
  totalValidatorsSlashed: number
  totalSlashAmount: bigint
}
