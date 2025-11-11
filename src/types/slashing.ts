import type { Address } from 'viem'

/**
 * Configuration for the slashing monitor
 */
export interface SlashingMonitorConfig {
  // L1 Configuration
  l1RpcUrl: string
  tallySlashingProposerAddress: Address
  slasherAddress: Address
  rollupAddress: Address

  // L2 Configuration
  nodeAdminUrl: string // http://localhost:8880

  // Network Parameters (read from contract)
  slashingRoundSize: number
  slashingRoundSizeInEpochs: number
  executionDelayInRounds: number
  lifetimeInRounds: number
  slashOffsetInRounds: number
  quorum: number
  committeeSize: number
  slotDuration: number // in seconds
  epochDuration: number // in slots

  // Polling Interval
  l2PollInterval: number // Background poll interval

  // Vetoer
  vetoerAddress?: Address
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
