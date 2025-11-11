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

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${secs}s`
  } else if (hours > 0) {
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
 * Get Tailwind color classes for a round status (neo-brutalist with brand colors)
 */
export function getStatusColor(status: RoundStatus): string {
  switch (status) {
    case 'quorum-reached':
      return 'bg-lapis text-aqua border-5 border-aqua shadow-brutal-aqua'
    case 'in-veto-window':
      return 'bg-malachite text-chartreuse border-5 border-chartreuse shadow-brutal-chartreuse'
    case 'executable':
      return 'bg-oxblood text-vermillion border-5 border-vermillion shadow-brutal-vermillion'
    case 'executed':
      return 'bg-aubergine/50 text-whisper-white border-5 border-brand-black shadow-brutal'
    case 'expired':
      return 'bg-malachite/30 text-whisper-white/60 border-5 border-brand-black shadow-brutal'
    case 'voting':
      return 'bg-lapis/50 text-whisper-white border-5 border-brand-black shadow-brutal'
    default:
      return 'bg-lapis text-aqua border-5 border-aqua shadow-brutal-aqua'
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
 * Get color class for offense type (neo-brutalist with brand colors)
 */
export function getOffenseTypeColor(offenseType: OffenseType): string {
  switch (offenseType) {
    case OffenseType.DATA_WITHHOLDING:
      return 'bg-oxblood text-vermillion border-3 border-vermillion' // Most severe - data availability
    case OffenseType.VALID_EPOCH_PRUNED:
      return 'bg-oxblood/70 text-vermillion border-3 border-vermillion/70' // Severe - epoch not proven
    case OffenseType.INACTIVITY:
      return 'bg-malachite text-chartreuse border-3 border-chartreuse' // Moderate - inactivity
    case OffenseType.BROADCASTED_INVALID_BLOCK_PROPOSAL:
      return 'bg-aubergine text-orchid border-3 border-orchid' // Malicious behavior
    case OffenseType.PROPOSED_INSUFFICIENT_ATTESTATIONS:
      return 'bg-aubergine/70 text-orchid border-3 border-orchid/70' // Invalid proposal
    case OffenseType.PROPOSED_INCORRECT_ATTESTATIONS:
      return 'bg-aubergine/50 text-orchid/80 border-3 border-orchid/80' // Invalid attestations
    case OffenseType.ATTESTED_DESCENDANT_OF_INVALID:
      return 'bg-lapis text-aqua border-3 border-aqua' // Propagated invalid
    case OffenseType.UNKNOWN:
    default:
      return 'bg-malachite/30 text-whisper-white border-3 border-brand-black'
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
