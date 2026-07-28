import type { MonitorNetwork, ApiSlashingCase, ProtocolSnapshot } from '@/types/api';
import type { CaseState, SlashingCase } from './slashingCase';

export function apiCaseToDomain(
    source: ApiSlashingCase,
    protocol: ProtocolSnapshot,
    network: MonitorNetwork,
): SlashingCase {
    const targets = source.targets.map((target) => ({
        validator: target.address,
        proposedAmount: BigInt(target.proposedAmount),
        proposedActionCount: target.actionCount,
    }));

    return {
        id: source.id,
        network,
        round: BigInt(source.round),
        currentRound: BigInt(protocol.currentRound),
        currentSlot: BigInt(protocol.currentSlot),
        targetEpochs: source.targetEpochs.map(BigInt),
        stack: {
            role: source.role,
            slasherAddress: source.slasherAddress,
            authorized: source.outcome !== 'stack-retired',
        },
        state: apiCaseState(source),
        provisionalQuorum: source.phase === 'voting' && targets.length > 0,
        ballotCount: BigInt(source.votesCast),
        quorumPerTarget: BigInt(source.quorum),
        payload: source.payloadAddress
            ? {
                address: source.payloadAddress,
                vetoed: source.currentPayloadVetoed,
                final: source.phase !== 'voting',
            }
            : null,
        targets,
        proposedTotalAmount: targets.reduce(
            (total, target) => total + (target.proposedAmount ?? 0n),
            0n,
        ),
        timing: {
            executableSlot: BigInt(source.executableSlot),
            expirySlot: BigInt(source.expirySlot),
            executableAt: source.executableAt,
            expiresAt: source.expiryAt,
        },
        pauseEndsAt: source.pauseEndsAt,
        observation: {
            source: 'hosted-monitor',
            observedAt: source.observedAt,
            blockNumber: BigInt(source.blockNumber),
        },
    };
}

export function apiCasesToDomain(
    cases: readonly ApiSlashingCase[],
    protocol: ProtocolSnapshot | null,
    network: MonitorNetwork,
): SlashingCase[] {
    if (!protocol) return [];
    return cases.map((slashingCase) =>
        apiCaseToDomain(slashingCase, protocol, network));
}

function apiCaseState(source: ApiSlashingCase): CaseState {
    if (source.phase === 'closed') {
        if (!source.outcome) {
            throw new Error(`Closed slashing case ${source.id} has no outcome`);
        }
        return { kind: 'terminal', terminal: source.outcome };
    }
    return { kind: 'phase', phase: source.phase };
}
