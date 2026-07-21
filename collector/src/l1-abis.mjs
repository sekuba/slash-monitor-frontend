// Small, committed ABI surface extracted from the reviewed Aztec contracts.
// Runtime code never depends on the gitignored source reference dump.
export const registryAbi = [
  fn('getCanonicalRollup', [], [out('address')]),
];

// Registry upgrades are the canonical resolution trail for historical Rollup
// emitters. Slashed is emitted by the Rollup itself (the StakingLib code emits
// IStakingCore.Slashed while executing in the Rollup's context), not by the
// Slasher or SlashingProposer.
export const canonicalRollupUpdatedEvent = {
  type: 'event',
  name: 'CanonicalRollupUpdated',
  inputs: [
    { name: 'instance', type: 'address', indexed: true },
    { name: 'version', type: 'uint256', indexed: true },
  ],
};

export const slashedEvent = {
  type: 'event',
  name: 'Slashed',
  inputs: [
    { name: 'attester', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
  ],
};

export const rollupAbi = [
  fn('getVersion', [], [out('uint256')]),
  fn('getSlasher', [], [out('address')]),
  fn('getPendingSlasher', [], [out('address', 'slasher'), out('uint256', 'readyAt')]),
  fn('getLegacySlasher', [], [out('address', 'slasher'), out('uint256', 'authorizedUntil')]),
  fn('getCurrentSlot', [], [out('uint256')]),
  fn('getCurrentEpoch', [], [out('uint256')]),
  fn('getSlotAt', [input('uint256', '_timestamp')], [out('uint256')]),
  fn('getEpochDuration', [], [out('uint256')]),
  fn('getSlotDuration', [], [out('uint256')]),
];

export const slasherAbi = [
  fn('vetoedPayloads', [input('address', 'payload')], [out('bool', 'vetoed')]),
  fn('isSlashingEnabled', [], [out('bool')]),
  fn('PROPOSER', [], [out('address')]),
  fn('slashingDisabledUntil', [], [out('uint256')]),
  fn('SLASHING_DISABLE_DURATION', [], [out('uint256')]),
];

const slashAction = {
  name: 'actions',
  type: 'tuple[]',
  components: [input('address', 'validator'), input('uint256', 'slashAmount')],
};

export const slashingProposerAbi = [
  fn('getCurrentRound', [], [out('uint256')]),
  fn('getRound', [input('uint256', '_round')], [out('bool', 'isExecuted'), out('uint256', 'voteCount')]),
  fn('getVotes', [input('uint256', '_round'), input('uint256', '_index')], [out('bytes')]),
  fn('getSlashTargetCommittees', [input('uint256', '_round')], [out('address[][]', 'committees')], 'nonpayable'),
  fn('getTally', [input('uint256', '_round'), input('address[][]', '_committees')], [slashAction]),
  fn('getPayloadAddress', [input('uint256', '_round'), { ...slashAction, name: '_actions' }], [out('address')]),
  fn('QUORUM', [], [out('uint256')]),
  fn('ROUND_SIZE', [], [out('uint256')]),
  fn('ROUND_SIZE_IN_EPOCHS', [], [out('uint256')]),
  fn('EXECUTION_DELAY_IN_ROUNDS', [], [out('uint256')]),
  fn('LIFETIME_IN_ROUNDS', [], [out('uint256')]),
  fn('SLASH_OFFSET_IN_ROUNDS', [], [out('uint256')]),
  fn('COMMITTEE_SIZE', [], [out('uint256')]),
  fn('INSTANCE', [], [out('address')]),
  fn('SLASHER', [], [out('address')]),
];

function fn(name, inputs, outputs, stateMutability = 'view') {
  return { type: 'function', name, stateMutability, inputs, outputs };
}

function input(type, name = '') {
  return { name, type };
}

function out(type, name = '') {
  return { name, type };
}
