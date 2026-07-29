import {
    projectCases,
    type Observation,
    type ProtocolSnapshot,
    type SlashingCase,
} from '../../shared/protocol/index.ts';
import { isRoundProtectedByPause } from './pauseProtection';
import type {
    ConfirmedSlash,
    CurrentChainState,
    DetectedSlashing,
    ResolvedMonitorConfig,
} from '@/types/slashing';
import type { MonitorNetwork } from '@/types/backendApi';

export function projectMonitorCases({
    network,
    config,
    state,
    slashings,
    confirmedSlashes,
}: {
    network: MonitorNetwork;
    config: ResolvedMonitorConfig;
    state: CurrentChainState;
    slashings: DetectedSlashing[];
    confirmedSlashes: ConfirmedSlash[];
}): { protocol: ProtocolSnapshot; cases: SlashingCase[] } {
    const observedAt = new Date(Number(state.l1Timestamp) * 1_000).toISOString();
    const protocol: ProtocolSnapshot = {
        network,
        chainId: config.chainId,
        observedAt,
        blockNumber: state.l1BlockNumber.toString(),
        blockHash: state.l1BlockHash,
        registryAddress: config.registryAddress.toLowerCase(),
        rollupAddress: config.rollupAddress.toLowerCase(),
        genesisTime: config.l1GenesisTime.toString(),
        currentSlot: state.currentSlot.toString(),
        currentEpoch: state.currentEpoch.toString(),
        slotDurationSeconds: config.slotDuration,
        epochDurationSlots: config.epochDuration,
        inactivity: null,
        lineages: [{
            role: 'active',
            rollupAddress: config.rollupAddress.toLowerCase(),
            slasherAddress: config.slasherAddress.toLowerCase(),
            proposerAddress: config.slashingProposerAddress.toLowerCase(),
            currentRound: state.currentRound.toString(),
            isSlashingEnabled: state.isSlashingEnabled,
            disabledUntil: state.slashingDisabledUntil === 0n
                ? null
                : state.slashingDisabledUntil.toString(),
            parameters: {
                quorum: config.quorum,
                roundSizeSlots: config.slashingRoundSize,
                roundSizeEpochs: config.slashingRoundSizeInEpochs,
                executionDelayRounds: config.executionDelayInRounds,
                lifetimeRounds: config.lifetimeInRounds,
                slashOffsetRounds: config.slashOffsetInRounds,
                committeeSize: config.committeeSize,
            },
        }],
    };
    const roundObservations: Observation[] = slashings.flatMap((round) =>
        (round.targetDetails ?? []).map((target) => {
            const roundEndSlot = (
                (round.round + 1n) * BigInt(config.slashingRoundSize)
            );
            const executableSlot = round.slotWhenExecutable ??
                (round.round + 1n + BigInt(config.executionDelayInRounds)) *
                    BigInt(config.slashingRoundSize);
            const expirySlot = round.slotWhenExpires ??
                (round.round + 1n + BigInt(config.lifetimeInRounds)) *
                    BigInt(config.slashingRoundSize);
            return {
                id: [
                    'monitor',
                    state.l1BlockHash,
                    round.round,
                    target.targetEpoch,
                    target.sequencer.toLowerCase(),
                ].join(':'),
                network,
                source: 'ethereum_l1',
                kind: 'l1_round',
                sequencer: target.sequencer.toLowerCase(),
                lineageId: config.slashingProposerAddress.toLowerCase(),
                targetEpoch: target.targetEpoch.toString(),
                round: round.round.toString(),
                provenance: {
                    observedAt,
                    blockNumber: state.l1BlockNumber.toString(),
                    blockHash: state.l1BlockHash,
                    canonical: true,
                },
                data: {
                    round: round.round.toString(),
                    status: round.status,
                    support: target.support,
                    quorum: config.quorum,
                    amount: target.amount?.toString() ?? null,
                    maxSlashUnits: target.maxSlashUnits,
                    unitVoteCounts: target.unitVoteCounts,
                    escaped: Boolean(target.escaped),
                    payloadAddress: round.payloadAddress?.toLowerCase() ?? null,
                    isVetoed: round.isVetoed,
                    isExecuted: round.isExecuted,
                    stable: state.currentRound > round.round,
                    isExecutionPaused: !state.isSlashingEnabled && !round.isExecuted,
                    isProtected: isRoundProtectedByPause(
                        round.round,
                        config,
                        state.isSlashingEnabled,
                        state.pauseStartedAtSlot,
                        state.pauseEndsAtSlot,
                    ),
                    roundEndSlot: roundEndSlot.toString(),
                    executableSlot: executableSlot.toString(),
                    expirySlot: expirySlot.toString(),
                    roundEndAt: slotAt(protocol, roundEndSlot),
                    executableAt: slotAt(protocol, executableSlot),
                    expiryAt: slotAt(protocol, expirySlot),
                },
            } satisfies Observation;
        }));
    const slashObservations: Observation[] = confirmedSlashes.flatMap((slash) => {
        const base: Observation = {
            id: [
                'monitor-slash',
                slash.blockHash,
                slash.transactionHash,
                slash.actionIndex,
            ].join(':'),
            network,
            source: 'ethereum_l1',
            kind: 'l1_slash',
            sequencer: slash.sequencer.toLowerCase(),
            lineageId: config.slashingProposerAddress.toLowerCase(),
            targetEpoch: slash.targetEpoch.toString(),
            round: slash.round.toString(),
            provenance: {
                observedAt,
                blockNumber: slash.blockNumber.toString(),
                blockHash: slash.blockHash,
                transactionHash: slash.transactionHash,
                canonical: true,
            },
            data: {
                round: slash.round.toString(),
                amount: slash.amount.toString(),
                actionIndex: slash.actionIndex,
            },
        };
        if (!slash.ejected) return [base];
        return [base, {
            ...base,
            id: `${base.id}:status:${slash.attesterStatus}`,
            kind: 'stake_status',
            data: {
                ejected: true,
                status: slash.attesterStatus === 2 ? 'zombie' : 'exiting',
                actualAmount: slash.amount.toString(),
                round: slash.round.toString(),
            },
        }];
    });
    return {
        protocol,
        cases: projectCases([...roundObservations, ...slashObservations], protocol),
    };
}

function slotAt(protocol: ProtocolSnapshot, slot: bigint): string {
    const seconds = BigInt(protocol.genesisTime) +
        slot * BigInt(protocol.slotDurationSeconds);
    return new Date(Number(seconds) * 1_000).toISOString();
}
