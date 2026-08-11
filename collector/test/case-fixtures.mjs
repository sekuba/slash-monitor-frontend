import { CaseRepository } from '../src/case-repository.mjs';

export const REGISTRY = '0x1111111111111111111111111111111111111111';
export const ROLLUP = '0x2222222222222222222222222222222222222222';
export const SLASHER = '0x3333333333333333333333333333333333333333';
export const PROPOSER = '0x4444444444444444444444444444444444444444';
export const PAYLOAD = '0x6666666666666666666666666666666666666666';

export function protocolSnapshot({
  block = 100,
  currentSlot = 280,
  currentEpoch = 28,
  currentRound = 14,
  rounds = [],
} = {}) {
  return {
    chainId: 1,
    blockNumber: String(block),
    blockHash: hash(block),
    blockTimestamp: String(1_700_000_000 + block),
    registryAddress: REGISTRY,
    rollupAddress: ROLLUP,
    rollupVersion: '5',
    l1GenesisTime: '1700000000',
    slotDuration: '12',
    epochDuration: '10',
    currentSlot: String(currentSlot),
    currentEpoch: String(currentEpoch),
    stackErrors: [],
    degraded: false,
    reorgDetected: false,
    stacks: [{
      role: 'active',
      rollupAddress: ROLLUP,
      slasherAddress: SLASHER,
      proposerAddress: PROPOSER,
      currentRound: String(currentRound),
      isSlashingEnabled: true,
      slashingDisabledUntil: '0',
      pauseStartedAtSlot: null,
      pauseEndsAtSlot: null,
      parameters: {
        quorum: '2',
        roundSize: '20',
        roundSizeInEpochs: '2',
        executionDelayInRounds: '2',
        lifetimeInRounds: '4',
        slashOffsetInRounds: '1',
        committeeSize: '4',
      },
      roundErrors: [],
      rounds,
    }],
  };
}

export function targetRound({
  sequencer,
  targetEpoch = '24',
  round = '14',
  status = 'quorum-reached',
  amount = '1000',
  executed = false,
} = {}) {
  return {
    round,
    ballotCount: '2',
    status,
    isExecuted: executed,
    isVetoed: false,
    isAuthorized: true,
    isExecutionPaused: false,
    isProtected: false,
    payloadAddress: PAYLOAD,
    executableSlot: '320',
    expirySlot: '360',
    actions: amount === null ? [] : [{ sequencer, amount }],
    earlyTargets: [],
    actionDetails: [{
      sequencer,
      targetEpoch,
      actionIndex: 0,
      epochIndex: 0,
      committeeIndex: 0,
      voteCount: 2,
      support: 2,
      maxSlashUnits: 1,
      unitVoteCounts: [2, 0, 0],
      amount,
    }],
  };
}

export function hash(value) {
  return `0x${Number(value).toString(16).padStart(64, '0')}`;
}

// One in-memory repository bound to the fixture identity, as most suites need.
export function createRepository() {
  const repository = new CaseRepository(':memory:');
  repository.bindRuntimeIdentity({
    network: 'mainnet',
    chainId: 1,
    registryAddress: REGISTRY,
  });
  return repository;
}
