/**
 * Minimal ABI for TallySlashingProposer contract
 * Contains only the functions needed for the slashing monitor
 */
export const tallySlashingProposerAbi = [
  // View functions
  {
    type: 'function',
    name: 'getCurrentRound',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getRound',
    stateMutability: 'view',
    inputs: [{ name: '_round', type: 'uint256' }],
    outputs: [
      { name: 'isExecuted', type: 'bool' },
      { name: 'readyToExecute', type: 'bool' },
      { name: 'voteCount', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'isRoundReadyToExecute',
    stateMutability: 'view',
    inputs: [
      { name: '_round', type: 'uint256' },
      { name: '_slot', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getSlashTargetEpoch',
    stateMutability: 'view',
    inputs: [
      { name: '_round', type: 'uint256' },
      { name: '_epochIndex', type: 'uint256' },
    ],
    outputs: [{ name: 'epochNumber', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getSlashTargetCommittees',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_round', type: 'uint256' }],
    outputs: [{ name: 'committees', type: 'address[][]' }],
  },
  {
    type: 'function',
    name: 'getTally',
    stateMutability: 'view',
    inputs: [
      { name: '_round', type: 'uint256' },
      { name: '_committees', type: 'address[][]' },
    ],
    outputs: [
      {
        name: 'actions',
        type: 'tuple[]',
        components: [
          { name: 'validator', type: 'address' },
          { name: 'slashAmount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getPayloadAddress',
    stateMutability: 'view',
    inputs: [
      { name: '_round', type: 'uint256' },
      {
        name: '_actions',
        type: 'tuple[]',
        components: [
          { name: 'validator', type: 'address' },
          { name: 'slashAmount', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  // Constants
  {
    type: 'function',
    name: 'QUORUM',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ROUND_SIZE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ROUND_SIZE_IN_EPOCHS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'EXECUTION_DELAY_IN_ROUNDS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'LIFETIME_IN_ROUNDS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'SLASH_OFFSET_IN_ROUNDS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'COMMITTEE_SIZE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'SLASH_AMOUNT_SMALL',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'SLASH_AMOUNT_MEDIUM',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'SLASH_AMOUNT_LARGE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'INSTANCE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'SLASHER',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // Events
  {
    type: 'event',
    name: 'VoteCast',
    inputs: [
      { name: 'round', type: 'uint256', indexed: true },
      { name: 'slot', type: 'uint256', indexed: true },
      { name: 'proposer', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'RoundExecuted',
    inputs: [
      { name: 'round', type: 'uint256', indexed: true },
      { name: 'slashCount', type: 'uint256', indexed: false },
    ],
  },

  // Error definitions
  {
    type: 'error',
    name: 'TallySlashingProposer__RoundOutOfRange',
    inputs: [
      { name: 'round', type: 'uint256' },
      { name: 'currentRound', type: 'uint256' },
    ],
  },
] as const
