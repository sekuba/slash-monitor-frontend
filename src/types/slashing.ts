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
  nodeRpcUrl: string // http://localhost:8080
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

  // Slash amounts
  slashAmountSmall: bigint
  slashAmountMedium: bigint
  slashAmountLarge: bigint

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
  DOUBLE_PROPOSE = 1,
  INVALID_BLOCK = 2,
  INACTIVITY = 3,
  VALID_EPOCH_PRUNED = 4,
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
