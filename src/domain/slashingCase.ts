import { getAddress, isAddress, type Address } from 'viem';

export type SlashingNetwork = 'mainnet' | 'testnet';
export type SlashingCaseSource = 'hosted-monitor' | 'independent-l1';
export type SlashingStackRole = 'active' | 'legacy';
export type CasePhase = 'voting' | 'review' | 'ready' | 'paused';
export type CaseTerminal =
    | 'no-consensus'
    | 'vetoed'
    | 'executed'
    | 'expired'
    | 'stack-retired';
export type IntegerLike = bigint | number | string;

export type CaseState =
    | { kind: 'phase'; phase: CasePhase }
    | { kind: 'terminal'; terminal: CaseTerminal };

export interface SlashingTiming {
    roundSizeSlots: bigint;
    executionDelayRounds: bigint;
    lifetimeRounds: bigint;
}

export interface CaseWindow {
    executableSlot: bigint;
    expirySlot: bigint;
}

export interface RawValidatorAction {
    validator: string;
    amount: IntegerLike;
}

export interface ValidatorProposal {
    validator: Address;
    proposedAmount: bigint;
    actionCount: number;
}

export interface ValidatorTarget {
    validator: Address;
    proposedAmount: bigint;
    proposedActionCount: number;
}

export interface SlashingCaseObservation {
    source: SlashingCaseSource;
    observedAt: string;
    blockNumber: bigint | null;
}

export interface SlashingCase {
    id: string;
    network: SlashingNetwork;
    round: bigint;
    currentRound: bigint;
    currentSlot: bigint;
    targetEpochs: bigint[];
    stack: {
        role: SlashingStackRole;
        slasherAddress: Address | null;
        authorized: boolean;
    };
    state: CaseState;
    provisionalQuorum: boolean;
    ballotCount: bigint;
    quorumPerTarget: bigint;
    payload: {
        address: Address;
        vetoed: boolean;
        final: boolean;
    } | null;
    targets: ValidatorTarget[];
    proposedTotalAmount: bigint;
    timing: CaseWindow & {
        executableAt: string | null;
        expiresAt: string | null;
    };
    pauseEndsAt: string | null;
    observation: SlashingCaseObservation;
}

export interface CaseLifecycleInput {
    round: IntegerLike;
    currentRound: IntegerLike;
    currentSlot: IntegerLike;
    timing: {
        roundSizeSlots: IntegerLike;
        executionDelayRounds: IntegerLike;
        lifetimeRounds: IntegerLike;
    };
    hasProposedActions: boolean;
    payloadAddress?: string | null;
    exactPayloadVetoed: boolean;
    roundExecuted: boolean;
    slashingEnabled: boolean;
    slasherAuthorized: boolean;
}

export interface BuildSlashingCaseInput extends Omit<
    CaseLifecycleInput,
    'hasProposedActions' | 'slasherAuthorized'
> {
    id: string;
    network: SlashingNetwork;
    targetEpochs?: readonly IntegerLike[];
    stack: {
        role: SlashingStackRole;
        slasherAddress?: string | null;
        authorized: boolean;
    };
    ballotCount: IntegerLike;
    quorumPerTarget: IntegerLike;
    reachedQuorum: boolean;
    proposedActions: readonly RawValidatorAction[];
    executableAt?: string | null;
    expiresAt?: string | null;
    pauseEndsAt?: string | null;
    observation: {
        source: SlashingCaseSource;
        observedAt: string;
        blockNumber?: IntegerLike | null;
    };
}

export interface CategorizedCases {
    open: SlashingCase[];
    closed: SlashingCase[];
}

export function calculateCaseWindow(
    roundValue: IntegerLike,
    timingInput: CaseLifecycleInput['timing'],
): CaseWindow {
    const round = toUnsignedBigInt(roundValue, 'round');
    const timing = normalizeTiming(timingInput);
    return {
        executableSlot: (round + 1n + timing.executionDelayRounds) * timing.roundSizeSlots,
        expirySlot: (round + 1n + timing.lifetimeRounds) * timing.roundSizeSlots,
    };
}

/**
 * Derive only what current Ethereum state proves. In particular, a veto is
 * terminal only after voting closes and only for a known exact payload.
 */
export function deriveCaseState(input: CaseLifecycleInput): CaseState {
    const round = toUnsignedBigInt(input.round, 'round');
    const currentRound = toUnsignedBigInt(input.currentRound, 'currentRound');
    const currentSlot = toUnsignedBigInt(input.currentSlot, 'currentSlot');
    const { executableSlot, expirySlot } = calculateCaseWindow(round, input.timing);
    const votingIsOpen = currentRound <= round;
    const hasExactPayload = Boolean(input.payloadAddress);

    if (input.roundExecuted) {
        return { kind: 'terminal', terminal: 'executed' };
    }
    if (votingIsOpen) {
        return { kind: 'phase', phase: 'voting' };
    }
    if (!input.hasProposedActions) {
        return { kind: 'terminal', terminal: 'no-consensus' };
    }
    if (hasExactPayload && input.hasProposedActions && input.exactPayloadVetoed) {
        return { kind: 'terminal', terminal: 'vetoed' };
    }
    if (currentSlot >= expirySlot) {
        return { kind: 'terminal', terminal: 'expired' };
    }
    if (!input.slasherAuthorized) {
        return { kind: 'terminal', terminal: 'stack-retired' };
    }
    if (currentSlot < executableSlot) {
        return { kind: 'phase', phase: 'review' };
    }
    if (!input.slashingEnabled) {
        return { kind: 'phase', phase: 'paused' };
    }
    return { kind: 'phase', phase: 'ready' };
}

export function aggregateValidatorActions(
    actions: readonly RawValidatorAction[],
): ValidatorProposal[] {
    const byValidator = new Map<string, ValidatorProposal>();

    for (const action of actions) {
        const validator = normalizeAddress(action.validator, 'validator');
        const key = validator.toLowerCase();
        const amount = toUnsignedBigInt(action.amount, `proposed amount for ${validator}`);
        const existing = byValidator.get(key);
        if (existing) {
            existing.proposedAmount += amount;
            existing.actionCount += 1;
        }
        else {
            byValidator.set(key, {
                validator,
                proposedAmount: amount,
                actionCount: 1,
            });
        }
    }

    return [...byValidator.values()];
}

export function buildSlashingCase(input: BuildSlashingCaseInput): SlashingCase {
    const round = toUnsignedBigInt(input.round, 'round');
    const currentRound = toUnsignedBigInt(input.currentRound, 'currentRound');
    const currentSlot = toUnsignedBigInt(input.currentSlot, 'currentSlot');
    const timing = normalizeTiming(input.timing);
    const window = calculateCaseWindow(round, timing);
    const proposals = aggregateValidatorActions(input.proposedActions);
    const targets = proposals.map((proposal) => ({
        validator: proposal.validator,
        proposedAmount: proposal.proposedAmount,
        proposedActionCount: proposal.actionCount,
    }));
    const payloadAddress = input.payloadAddress
        ? normalizeAddress(input.payloadAddress, 'payloadAddress')
        : null;
    const votingIsOpen = currentRound <= round;
    const state = deriveCaseState({
        ...input,
        round,
        currentRound,
        currentSlot,
        timing,
        hasProposedActions: proposals.length > 0,
        payloadAddress,
        slasherAuthorized: input.stack.authorized,
    });

    return {
        id: requireText(input.id, 'id'),
        network: input.network,
        round,
        currentRound,
        currentSlot,
        targetEpochs: (input.targetEpochs ?? []).map((epoch) =>
            toUnsignedBigInt(epoch, 'target epoch')),
        stack: {
            role: input.stack.role,
            slasherAddress: input.stack.slasherAddress
                ? normalizeAddress(input.stack.slasherAddress, 'slasherAddress')
                : null,
            authorized: input.stack.authorized,
        },
        state,
        provisionalQuorum: votingIsOpen && input.reachedQuorum,
        ballotCount: toUnsignedBigInt(input.ballotCount, 'ballotCount'),
        quorumPerTarget: toUnsignedBigInt(input.quorumPerTarget, 'quorumPerTarget'),
        payload: payloadAddress
            ? {
                address: payloadAddress,
                vetoed: input.exactPayloadVetoed,
                final: !votingIsOpen,
            }
            : null,
        targets,
        proposedTotalAmount: proposals.reduce(
            (total, proposal) => total + proposal.proposedAmount,
            0n,
        ),
        timing: {
            ...window,
            executableAt: normalizeOptionalIsoDate(input.executableAt, 'executableAt'),
            expiresAt: normalizeOptionalIsoDate(input.expiresAt, 'expiresAt'),
        },
        pauseEndsAt: normalizeOptionalIsoDate(input.pauseEndsAt, 'pauseEndsAt'),
        observation: {
            source: input.observation.source,
            observedAt: normalizeIsoDate(input.observation.observedAt, 'observation.observedAt'),
            blockNumber: input.observation.blockNumber === null ||
                input.observation.blockNumber === undefined
                ? null
                : toUnsignedBigInt(input.observation.blockNumber, 'observation.blockNumber'),
        },
    };
}

export function categorizeCases(cases: readonly SlashingCase[]): CategorizedCases {
    return cases.reduce<CategorizedCases>((result, slashingCase) => {
        (isOpenCase(slashingCase) ? result.open : result.closed).push(slashingCase);
        return result;
    }, { open: [], closed: [] });
}

export function isOpenCase(slashingCase: SlashingCase): boolean {
    return slashingCase.state.kind === 'phase';
}

function normalizeTiming(input: CaseLifecycleInput['timing']): SlashingTiming {
    const timing = {
        roundSizeSlots: toUnsignedBigInt(input.roundSizeSlots, 'roundSizeSlots'),
        executionDelayRounds: toUnsignedBigInt(
            input.executionDelayRounds,
            'executionDelayRounds',
        ),
        lifetimeRounds: toUnsignedBigInt(input.lifetimeRounds, 'lifetimeRounds'),
    };
    if (timing.roundSizeSlots === 0n) {
        throw new Error('roundSizeSlots must be greater than zero');
    }
    if (timing.lifetimeRounds < timing.executionDelayRounds) {
        throw new Error('lifetimeRounds must not be smaller than executionDelayRounds');
    }
    return timing;
}

function toUnsignedBigInt(value: IntegerLike, label: string): bigint {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
    if (typeof value === 'string' && !/^\d+$/.test(value)) {
        throw new Error(`${label} must be a non-negative integer`);
    }
    const result = BigInt(value);
    if (result < 0n) {
        throw new Error(`${label} must be non-negative`);
    }
    return result;
}

function normalizeAddress(value: string, label: string): Address {
    if (!isAddress(value, { strict: false })) {
        throw new Error(`${label} must be a 20-byte Ethereum address`);
    }
    return getAddress(value.toLowerCase());
}


function normalizeIsoDate(value: string, label: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        throw new Error(`${label} must be an ISO date`);
    }
    return new Date(timestamp).toISOString();
}

function normalizeOptionalIsoDate(
    value: string | null | undefined,
    label: string,
): string | null {
    return value ? normalizeIsoDate(value, label) : null;
}

function requireText(value: string, label: string): string {
    if (!value.trim()) {
        throw new Error(`${label} must not be empty`);
    }
    return value;
}
