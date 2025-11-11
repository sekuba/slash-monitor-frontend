import type { Address } from 'viem'
import type { RoundStatus } from '@/types/slashing'

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
