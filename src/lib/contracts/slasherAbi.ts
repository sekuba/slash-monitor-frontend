/**
 * Minimal ABI for Slasher contract
 * Contains only the functions needed for the slashing monitor
 */
export const slasherAbi = [
  // View functions
  {
    type: 'function',
    name: 'vetoedPayloads',
    stateMutability: 'view',
    inputs: [{ name: 'payload', type: 'address' }],
    outputs: [{ name: 'vetoed', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isSlashingEnabled',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'VETOER',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'GOVERNANCE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'PROPOSER',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'slashingDisabledUntil',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'SLASHING_DISABLE_DURATION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // State-changing functions
  {
    type: 'function',
    name: 'vetoPayload',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_payload', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'setSlashingEnabled',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_enabled', type: 'bool' }],
    outputs: [],
  },
  // Events
  {
    type: 'event',
    name: 'VetoedPayload',
    inputs: [{ name: 'payload', type: 'address', indexed: false }],
  },
  {
    type: 'event',
    name: 'SlashingDisabled',
    inputs: [{ name: 'slashingDisabledUntil', type: 'uint256', indexed: false }],
  },
] as const
