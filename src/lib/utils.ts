import type { Address } from 'viem'
import type { RoundStatus, Offense } from '@/types/slashing'
import { OffenseType } from '@/types/slashing'

/**
 * Format an Ethereum address for display (0x1234...5678)
 */
export function formatAddress(address: Address, chars = 6): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

/**
 * Format wei to ether with specified decimals
 */
export function formatEther(wei: bigint, decimals = 4): string {
  const ether = Number(wei) / 1e18
  return ether.toFixed(decimals)
}

/**
 * Format seconds remaining into human-readable format
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) {
    return 'Expired'
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`
  } else {
    return `${secs}s`
  }
}

/**
 * Format a large number with commas
 */
export function formatNumber(num: number | bigint): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Check if a round status requires action from the vetoer
 */
export function isActionableStatus(status: RoundStatus): boolean {
  return (
    status === 'quorum-reached' ||
    status === 'in-veto-window' ||
    status === 'executable'
  )
}

/**
 * Get Tailwind color classes for a round status
 */
export function getStatusColor(status: RoundStatus): string {
  switch (status) {
    case 'quorum-reached':
      return 'bg-blue-500/20 text-blue-400 border-blue-600'
    case 'in-veto-window':
      return 'bg-yellow-500/20 text-yellow-500 border-yellow-700'
    case 'executable':
      return 'bg-red-500/20 text-red-500 border-red-700'
    case 'executed':
      return 'bg-gray-500/20 text-gray-500 border-gray-700'
    case 'expired':
      return 'bg-gray-600/20 text-gray-600 border-gray-700'
    case 'voting':
      return 'bg-gray-700/20 text-gray-400 border-gray-600'
    default:
      return 'bg-blue-500/20 text-blue-500 border-blue-700'
  }
}

/**
 * Get display text for a round status
 */
export function getStatusText(status: RoundStatus): string {
  switch (status) {
    case 'quorum-reached':
      return 'Quorum Reached'
    case 'in-veto-window':
      return 'Newly Executable'
    case 'executable':
      return 'Executable'
    case 'executed':
      return 'Executed'
    case 'expired':
      return 'Expired'
    case 'voting':
      return 'Voting'
    default:
      return 'Pending'
  }
}

/**
 * Get display text for offense type
 */
export function getOffenseTypeName(offenseType: OffenseType): string {
  switch (offenseType) {
    case OffenseType.DATA_WITHHOLDING:
      return 'Data Withholding'
    case OffenseType.VALID_EPOCH_PRUNED:
      return 'Epoch Pruned'
    case OffenseType.INACTIVITY:
      return 'Inactivity'
    case OffenseType.BROADCASTED_INVALID_BLOCK_PROPOSAL:
      return 'Invalid Broadcast'
    case OffenseType.PROPOSED_INSUFFICIENT_ATTESTATIONS:
      return 'Insufficient Attestations'
    case OffenseType.PROPOSED_INCORRECT_ATTESTATIONS:
      return 'Incorrect Attestations'
    case OffenseType.ATTESTED_DESCENDANT_OF_INVALID:
      return 'Attested Invalid'
    case OffenseType.UNKNOWN:
    default:
      return 'Unknown'
  }
}

/**
 * Get color class for offense type
 */
export function getOffenseTypeColor(offenseType: OffenseType): string {
  switch (offenseType) {
    case OffenseType.DATA_WITHHOLDING:
      return 'bg-red-500/20 text-red-400 border-red-600' // Most severe - data availability
    case OffenseType.VALID_EPOCH_PRUNED:
      return 'bg-orange-500/20 text-orange-400 border-orange-600' // Severe - epoch not proven
    case OffenseType.INACTIVITY:
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-600' // Moderate - inactivity
    case OffenseType.BROADCASTED_INVALID_BLOCK_PROPOSAL:
      return 'bg-pink-500/20 text-pink-400 border-pink-600' // Malicious behavior
    case OffenseType.PROPOSED_INSUFFICIENT_ATTESTATIONS:
      return 'bg-purple-500/20 text-purple-400 border-purple-600' // Invalid proposal
    case OffenseType.PROPOSED_INCORRECT_ATTESTATIONS:
      return 'bg-violet-500/20 text-violet-400 border-violet-600' // Invalid attestations
    case OffenseType.ATTESTED_DESCENDANT_OF_INVALID:
      return 'bg-indigo-500/20 text-indigo-400 border-indigo-600' // Propagated invalid
    case OffenseType.UNKNOWN:
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-600'
  }
}

/**
 * Find offense for a validator in given target epochs
 * Uses fallback matching strategy for older rounds where offense data may be incomplete
 */
export function findOffenseForValidator(
  validator: Address,
  targetEpochs: bigint[],
  offenses: Offense[],
  round?: bigint
): Offense | undefined {
  const normalizedValidator = validator.toLowerCase()

  // Strategy 1: Exact match by validator + epoch (best match)
  const exactMatch = offenses.find((offense) => {
    if (offense.validator.toLowerCase() !== normalizedValidator) {
      return false
    }
    if (offense.epoch !== undefined) {
      return targetEpochs.some(epoch => epoch === offense.epoch)
    }
    return false
  })

  if (exactMatch) return exactMatch

  // Strategy 2: Match by validator + round (for offenses with round but no epoch)
  if (round !== undefined) {
    const roundMatch = offenses.find((offense) => {
      if (offense.validator.toLowerCase() !== normalizedValidator) {
        return false
      }
      if (offense.round !== undefined) {
        return offense.round === round
      }
      return false
    })

    if (roundMatch) return roundMatch
  }

  // Strategy 3: Fallback - match by validator only (for old/incomplete data)
  // Only use this for older offenses where epoch/round data might be missing
  const validatorMatch = offenses.find((offense) => {
    if (offense.validator.toLowerCase() !== normalizedValidator) {
      return false
    }
    // Only use validator-only match if offense has no epoch or round info
    // This indicates it might be old/incomplete data
    return offense.epoch === undefined && offense.round === undefined
  })

  return validatorMatch
}
