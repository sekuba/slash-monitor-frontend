import { formatAztec, humanizeOffense, shortAddress } from './format.ts';
import type {
    AddressStatus,
    CaseReason,
    CaseStage,
    CaseState,
    CaseTransition,
    CaseUrgency,
    NetworkSummary,
    Observation,
    ProtocolSnapshot,
    SlashingCase,
    TransitionSeverity,
} from './types.ts';

const STAGE_RANK: Record<CaseStage, number> = {
    reorged: 0,
    resolved: 1,
    precursor: 2,
    node_offense: 3,
    awaiting_round: 4,
    l1_support: 5,
    candidate: 6,
    delayed: 7,
    vetoed: 8,
    expired: 9,
    executable: 10,
    executed: 11,
    stake_removed: 12,
    ejected: 13,
};

const URGENCY_RANK: Record<CaseUrgency, number> = {
    normal: 0,
    info: 1,
    warning: 2,
    critical: 3,
};

export function caseIdFor(observation: Pick<
    Observation,
    'network' | 'lineageId' | 'sequencer' | 'targetEpoch'
>): string {
    return [
        'case',
        observation.network,
        observation.lineageId.toLowerCase(),
        observation.sequencer.toLowerCase(),
        observation.targetEpoch,
    ].join(':');
}

export function projectCases(
    observations: readonly Observation[],
    protocol: ProtocolSnapshot | null,
): SlashingCase[] {
    const grouped = new Map<string, Observation[]>();
    for (const observation of observations) {
        const id = caseIdFor(observation);
        const existing = grouped.get(id);
        if (existing) existing.push(observation);
        else grouped.set(id, [observation]);
    }

    return [...grouped.entries()]
        .map(([id, evidence]) => projectCase(id, evidence, protocol))
        .sort(compareCases);
}

export function projectAddressStatus(
    sequencer: string,
    cases: readonly SlashingCase[],
): AddressStatus {
    const normalized = sequencer.toLowerCase();
    const matching = cases
        .filter((item) => item.sequencer === normalized)
        .sort(compareCases);
    const activeCase = matching.find((item) => item.state.active) ?? matching[0] ?? null;
    return {
        sequencer: normalized,
        headline: activeCase?.state.headline ?? 'No slashing evidence observed',
        urgency: activeCase?.state.urgency ?? 'normal',
        activeCase,
        cases: matching,
    };
}

export function transitionFor(
    previous: SlashingCase | null,
    current: SlashingCase,
): CaseTransition | null {
    if (
        previous?.state.stage === 'l1_support' &&
        current.state.stage === 'l1_support'
    ) {
        return null;
    }
    if (
        previous &&
        previous.state.stage === current.state.stage &&
        previous.state.headline === current.state.headline &&
        previous.state.requestedAmount === current.state.requestedAmount &&
        previous.state.actualAmount === current.state.actualAmount &&
        previous.state.payloadAddress === current.state.payloadAddress
    ) {
        return null;
    }

    const observedAt = current.lastObservedAt;
    const from = previous?.state.stage ?? null;
    return {
        id: [
            'transition',
            current.id,
            from ?? 'new',
            current.state.stage,
            observedAt,
        ].join(':'),
        caseId: current.id,
        sequencer: current.sequencer,
        fromStage: from,
        toStage: current.state.stage,
        severity: transitionSeverity(current.state),
        title: `${shortAddress(current.sequencer)} · ${stageLabel(current.state.stage)}`,
        body: transitionBody(previous, current),
        observedAt,
    };
}

export function summarizeNetwork(
    cases: readonly SlashingCase[],
): NetworkSummary {
    let stakeAtRisk = 0n;
    for (const item of cases) {
        if (item.state.active && item.state.requestedAmount) {
            stakeAtRisk += BigInt(item.state.requestedAmount);
        }
    }
    return {
        activeCases: cases.filter((item) => item.state.active).length,
        precursors: cases.filter((item) => item.state.stage === 'precursor').length,
        nodeOffenses: cases.filter((item) =>
            ['node_offense', 'awaiting_round'].includes(item.state.stage)).length,
        l1Supported: cases.filter((item) => item.state.stage === 'l1_support').length,
        candidates: cases.filter((item) =>
            ['candidate', 'delayed', 'vetoed'].includes(item.state.stage)).length,
        executable: cases.filter((item) => item.state.stage === 'executable').length,
        actualSlashes: cases.filter((item) =>
            ['stake_removed', 'ejected'].includes(item.state.stage)).length,
        ejections: cases.filter((item) => item.state.stage === 'ejected').length,
        stakeAtRisk: stakeAtRisk.toString(),
    };
}

export function stageLabel(stage: CaseStage): string {
    return {
        precursor: 'Duty miss',
        node_offense: 'Node offense',
        awaiting_round: 'Awaiting L1 round',
        l1_support: 'L1 mention',
        candidate: 'Candidate',
        delayed: 'Execution delay',
        executable: 'Executable',
        vetoed: 'Vetoed candidate',
        expired: 'Expired',
        executed: 'Executed',
        stake_removed: 'Stake removed',
        ejected: 'Ejection',
        resolved: 'Resolved locally',
        reorged: 'L1 correction',
    }[stage];
}

function projectCase(
    id: string,
    evidence: Observation[],
    protocol: ProtocolSnapshot | null,
): SlashingCase {
    const observations = [...evidence].sort(compareObservations);
    const first = observations[0];
    const lastObservedAt = observations.reduce(
        (latestAt, observation) => {
            const candidate = observation.provenance.invalidatedAt ??
                observation.provenance.observedAt;
            return candidate > latestAt ? candidate : latestAt;
        },
        first.provenance.observedAt,
    );
    return {
        id,
        network: first.network,
        sequencer: first.sequencer.toLowerCase(),
        lineageId: first.lineageId.toLowerCase(),
        targetEpoch: first.targetEpoch,
        firstObservedAt: first.provenance.observedAt,
        lastObservedAt,
        state: deriveState(observations, protocol),
        observations,
    };
}

function deriveState(
    observations: readonly Observation[],
    protocol: ProtocolSnapshot | null,
): CaseState {
    const canonical = observations.filter((item) => item.provenance.canonical);
    if (canonical.length === 0) {
        return state(
            'reorged',
            'info',
            'Prior L1 evidence was removed by a reorg',
            'The case is retained as a correction, but no canonical evidence currently supports it.',
            unknownReason(),
            false,
        );
    }

    const reason = deriveReason(canonical);
    const ejection = latest(canonical, 'stake_status');
    if (ejection && readBoolean(ejection.data.ejected)) {
        const actual = readString(ejection.data.actualAmount);
        return state(
            'ejected',
            'critical',
            'Ejected from the active validator set',
            actual
                ? `${formatAztec(actual)} AZTEC was removed and the remaining stake entered the exit flow.`
                : 'Canonical stake state reports that this sequencer left the active validator set.',
            reason,
            false,
            { actualAmount: actual },
        );
    }

    const slash = latest(canonical, 'l1_slash');
    if (slash) {
        const actual = readString(slash.data.amount);
        return state(
            'stake_removed',
            'critical',
            actual ? `${formatAztec(actual)} AZTEC removed from stake` : 'Stake removed',
            'A canonical Rollup Slashed log confirms the actual deduction.',
            reason,
            false,
            {
                actualAmount: actual,
                round: readString(slash.data.round),
            },
        );
    }

    const execution = latest(canonical, 'l1_execution');
    const round = latest(canonical, 'l1_round');
    if (round) {
        return roundState(round, reason, execution ?? undefined);
    }

    const offense = latest(canonical, 'node_offense');
    if (offense) {
        const active = readString(offense.data.status) !== 'withdrawn';
        if (!active) {
            return state(
                'resolved',
                'normal',
                'Node offense no longer active',
                'The observing node withdrew this local offense before any linked L1 continuation.',
                reason,
                false,
            );
        }
        const expectedRound = readString(offense.data.expectedRound);
        const currentRound = lineageCurrentRound(protocol, offense.lineageId);
        const waiting = expectedRound !== null && currentRound !== null &&
            BigInt(currentRound) < BigInt(expectedRound);
        const offenseName = humanizeOffense(readString(offense.data.offenseTypeName) ?? 'node offense');
        const amount = readString(offense.data.amount);
        return state(
            waiting ? 'awaiting_round' : 'node_offense',
            'warning',
            waiting ? `${offenseName}; awaiting L1 round ${expectedRound}` : `${offenseName} recorded by this node`,
            amount
                ? `This node assigned a local penalty of ${formatAztec(amount)} AZTEC. No L1 vote is implied.`
                : 'This is local node evidence, not network consensus.',
            reason,
            true,
            {
                requestedAmount: amount,
                round: expectedRound,
            },
        );
    }

    const inactivity = latest(canonical, 'inactivity_epoch');
    if (inactivity) {
        const streak = readNumber(inactivity.data.streak) ?? 1;
        const threshold = readNumber(inactivity.data.threshold) ?? 1;
        const missed = readNumber(inactivity.data.missed);
        const total = readNumber(inactivity.data.total);
        return state(
            'precursor',
            streak >= threshold ? 'warning' : 'info',
            `${streak} of ${threshold} qualifying inactive epochs`,
            missed !== null && total !== null
                ? `This node observed ${missed} missed duties out of ${total}. This is not yet an L1 vote.`
                : 'This node observed a qualifying inactive epoch. This is not yet an L1 vote.',
            reason,
            true,
        );
    }

    return state(
        'precursor',
        'info',
        'Missed duty observed',
        'This node observed a duty problem. The inactivity threshold has not yet been met.',
        reason,
        true,
    );
}

function roundState(
    observation: Observation,
    reason: CaseReason,
    execution?: Observation,
): CaseState {
    const data = observation.data;
    const round = readString(data.round) ?? observation.round ?? null;
    const amount = readString(data.amount);
    const payloadAddress = readString(data.payloadAddress);
    const roundStatus = readString(data.status);
    const support = readNumber(data.support) ?? 0;
    const quorum = readNumber(data.quorum);
    const common = {
        requestedAmount: amount,
        payloadAddress,
        round,
    };

    if (readBoolean(data.escaped)) {
        return state(
            'resolved',
            'normal',
            'Excluded by the censorship-resistance escape hatch',
            'Votes were visible, but the target epoch was in an open escape-hatch window and the contract excluded it from the tally.',
            reason,
            false,
            common,
        );
    }

    if (readBoolean(data.isExecuted) || roundStatus === 'executed') {
        if (!amount) {
            return state(
                'resolved',
                'normal',
                'Round executed without slashing this sequencer',
                'The round closed onchain, but its final tally contained no action for this target.',
                reason,
                false,
                common,
            );
        }
        if (execution) {
            return state(
                'resolved',
                'normal',
                `Round executed · ${formatAztec(amount)} AZTEC requested`,
                'The execution receipt was inspected and contains no Rollup Slashed log for this sequencer.',
                reason,
                false,
                common,
            );
        }
        const receiptStatus = readString(data.executionReceiptStatus);
        if (receiptStatus === 'scanning') {
            return state(
                'executed',
                'critical',
                `Round executed · ${formatAztec(amount)} AZTEC requested`,
                'Contract state marks this round executed. This page is scanning for its execution receipt.',
                reason,
                false,
                common,
            );
        }
        if (receiptStatus === 'paused') {
            return state(
                'executed',
                'critical',
                `Round executed · ${formatAztec(amount)} AZTEC requested`,
                'Contract state marks this round executed. The RPC paused before this page located its execution receipt.',
                reason,
                false,
                common,
            );
        }
        if (receiptStatus === 'unavailable') {
            return state(
                'executed',
                'critical',
                `Round executed · ${formatAztec(amount)} AZTEC requested`,
                'Contract state marks this round executed, but its receipt was not found inside the completed history window.',
                reason,
                false,
                common,
            );
        }
        return state(
            'executed',
            'critical',
            `Round executed · ${formatAztec(amount)} AZTEC requested`,
            'The action payload was called. A Rollup Slashed log is still required to confirm this sequencer’s deduction.',
            reason,
            false,
            common,
        );
    }
    if (roundStatus === 'expired') {
        return state(
            'expired',
            'normal',
            'Candidate expired without execution',
            'The execution lifetime ended. This candidate can no longer execute.',
            reason,
            false,
            common,
        );
    }
    if (readBoolean(data.isVetoed)) {
        return state(
            'vetoed',
            'info',
            'Exact candidate payload is vetoed',
            'This veto applies to the displayed predicted address. A changed tally can produce another address.',
            reason,
            true,
            common,
        );
    }
    if (['newly-executable', 'executable'].includes(roundStatus ?? '')) {
        return state(
            'executable',
            'critical',
            amount ? `${formatAztec(amount)} AZTEC candidate is executable now` : 'Candidate is executable now',
            readBoolean(data.isExecutionPaused)
                ? 'Execution is currently paused, but the candidate remains inside its execution window.'
                : 'The execution delay has passed and the candidate has not expired.',
            reason,
            true,
            {
                ...common,
                nextTransition: transitionFrom(data, 'Expires'),
            },
        );
    }
    if (amount) {
        const stable = readBoolean(data.stable);
        return state(
            stable ? 'delayed' : 'candidate',
            'critical',
            `${formatAztec(amount)} AZTEC candidate`,
            stable
                ? 'Voting has closed. The candidate is waiting for its execution window.'
                : 'The current tally has an action, but it can still change until the voting round closes.',
            reason,
            true,
            {
                ...common,
                nextTransition: transitionFrom(data, stable ? 'Executable' : 'Voting closes'),
            },
        );
    }

    return state(
        'l1_support',
        'warning',
        quorum
            ? `${support} of ${quorum} L1 ballots support a penalty`
            : `${support} L1 ballot${support === 1 ? '' : 's'} support a penalty`,
        'The sequencer is mentioned in L1 voting. The tally does not currently produce a candidate action.',
        reason,
        true,
        common,
    );
}

function state(
    stage: CaseStage,
    urgency: CaseUrgency,
    headline: string,
    explanation: string,
    reason: CaseReason,
    active: boolean,
    overrides: Partial<CaseState> = {},
): CaseState {
    return {
        stage,
        urgency,
        headline,
        explanation,
        reason,
        nextTransition: null,
        requestedAmount: null,
        actualAmount: null,
        payloadAddress: null,
        round: null,
        active,
        ...overrides,
    };
}

function deriveReason(observations: readonly Observation[]): CaseReason {
    const offenseEvidence = observations.filter((item) => item.kind === 'node_offense');
    const latestOffense = offenseEvidence[offenseEvidence.length - 1];
    if (latestOffense) {
        return {
            label: humanizeOffense(
                readString(latestOffense.data.offenseTypeName) ?? 'Node offense',
            ),
            provenance: 'node_evidence',
            evidenceIds: offenseEvidence.map((item) => item.id),
        };
    }
    const inactivity = observations.filter((item) =>
        item.kind === 'inactivity_epoch' || item.kind === 'duty_miss');
    if (inactivity.length > 0) {
        return {
            label: 'Inactivity',
            provenance: 'node_evidence',
            evidenceIds: inactivity.map((item) => item.id),
        };
    }
    return unknownReason();
}

function unknownReason(): CaseReason {
    return {
        label: 'Reason unknown on L1',
        provenance: 'unknown_on_l1',
        evidenceIds: [],
    };
}

function transitionFrom(data: Record<string, unknown>, label: string) {
    return {
        label,
        slot: readString(
            label === 'Expires' ? data.expirySlot :
                label === 'Executable' ? data.executableSlot :
                    data.roundEndSlot,
        ),
        at: readString(
            label === 'Expires' ? data.expiryAt :
                label === 'Executable' ? data.executableAt :
                    data.roundEndAt,
        ),
    };
}

function transitionBody(
    previous: SlashingCase | null,
    item: SlashingCase,
): string {
    const lines = [
        `Event: ${transitionEventLabel(previous, item)}`,
        `Epoch: ${item.targetEpoch}`,
    ];
    const slot = transitionSlot(item);
    if (slot) lines.push(`Slot: ${slot}`);
    const round = transitionRound(item);
    if (round) lines.push(`Round: ${round}`);
    lines.push(`Time: ${formatTime(item.lastObservedAt)}`);
    lines.push(item.state.reason.provenance === 'node_evidence'
        ? `Reason: ${item.state.reason.label} (node evidence)`
        : 'Reason: Not encoded on L1');
    if (item.state.nextTransition) {
        let next = `Next: ${item.state.nextTransition.label}`;
        if (item.state.nextTransition.at) {
            next += ` at ${formatTime(item.state.nextTransition.at)}`;
        }
        if (item.state.nextTransition.slot) {
            next += `${item.state.nextTransition.at ? ' ·' : ' at'} ` +
                `slot ${item.state.nextTransition.slot}`;
        }
        lines.push(next);
    }
    return lines.join('\n');
}

function transitionEventLabel(
    previous: SlashingCase | null,
    item: SlashingCase,
): string {
    const requested = tokenAmount(item.state.requestedAmount);
    const actual = tokenAmount(item.state.actualAmount);
    switch (item.state.stage) {
        case 'precursor':
            return item.state.headline === 'Missed duty observed'
                ? 'Duty missed'
                : item.state.headline;
        case 'node_offense':
        case 'awaiting_round':
            return 'Offense recorded by this node';
        case 'l1_support':
            return previous && [
                'candidate',
                'delayed',
                'executable',
                'vetoed',
            ].includes(previous.state.stage)
                ? 'Slash support fell below quorum'
                : 'First L1 slash vote recorded';
        case 'candidate':
            return requested
                ? `Quorum reached for a ${requested} slash`
                : 'Slash quorum reached';
        case 'delayed':
            return requested
                ? `Voting closed for a ${requested} slash`
                : 'Voting closed for the slash candidate';
        case 'executable':
            return requested
                ? `${requested} slash became executable`
                : 'Slash became executable';
        case 'vetoed':
            return 'Slash candidate vetoed';
        case 'expired':
            return 'Slash candidate expired';
        case 'executed':
            return requested
                ? `Slash round executed for a ${requested} action`
                : 'Slash round executed';
        case 'stake_removed':
            return actual ? `${actual} slashed` : 'Stake slashed';
        case 'ejected':
            return actual
                ? `Sequencer ejected after a ${actual} slash`
                : 'Sequencer ejected';
        case 'resolved':
            return item.state.headline;
        case 'reorged':
            return 'L1 evidence removed';
    }
}

function tokenAmount(value: string | null): string | null {
    return value ? `${formatAztec(value)} AZTEC` : null;
}

function transitionSlot(item: SlashingCase): string | null {
    const observation = [...item.observations].reverse().find((candidate) =>
        candidate.provenance.canonical &&
        candidate.slot &&
        (candidate.provenance.invalidatedAt ?? candidate.provenance.observedAt) ===
            item.lastObservedAt);
    return observation?.slot ?? null;
}

function transitionRound(item: SlashingCase): string | null {
    if (item.state.round) return item.state.round;
    return [...item.observations].reverse().find((candidate) =>
        candidate.provenance.canonical && candidate.round)?.round ?? null;
}

function formatTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, ' UTC');
}

function transitionSeverity(stateValue: CaseState): TransitionSeverity {
    if (stateValue.urgency === 'critical') return 'critical';
    if (stateValue.urgency === 'warning') return 'warning';
    return 'info';
}

function lineageCurrentRound(
    protocol: ProtocolSnapshot | null,
    lineageId: string,
): string | null {
    return protocol?.lineages.find((lineage) =>
        lineage.proposerAddress.toLowerCase() === lineageId.toLowerCase())?.currentRound ?? null;
}

function latest(
    observations: readonly Observation[],
    kind: Observation['kind'],
): Observation | null {
    const matches = observations.filter((item) => item.kind === kind);
    return matches[matches.length - 1] ?? null;
}

function compareObservations(left: Observation, right: Observation): number {
    return left.provenance.observedAt.localeCompare(right.provenance.observedAt) ||
        left.id.localeCompare(right.id);
}

function compareCases(left: SlashingCase, right: SlashingCase): number {
    return Number(right.state.active) - Number(left.state.active) ||
        URGENCY_RANK[right.state.urgency] - URGENCY_RANK[left.state.urgency] ||
        STAGE_RANK[right.state.stage] - STAGE_RANK[left.state.stage] ||
        right.lastObservedAt.localeCompare(left.lastObservedAt);
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean {
    return value === true;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
