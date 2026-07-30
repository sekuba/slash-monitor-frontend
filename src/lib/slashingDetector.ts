import type { Address } from 'viem';
import {
    decodeVoteTargets,
    matchVoteActions,
    type VoteTarget,
} from '../../shared/protocol/index.ts';
import type {
    DetectedSlashing,
    MonitorIssue,
    ResolvedMonitorConfig,
    RoundInfo,
    RoundStatus,
    SlashAction,
    SlashingTargetDetail,
} from '@/types/slashing';
import { L1Monitor } from './l1Monitor';
import {
    buildRoundsToCheck,
    calculateExecutableSlot,
    calculateExpirySlot,
    calculateRoundStatus,
    countUniqueValidators,
    getTargetEpochs,
} from './slashingLifecycle';

interface DetailedRound {
    committees: Address[][];
    slashActions: SlashAction[];
    targetDetails: SlashingTargetDetail[];
    payloadAddress: Address;
    isVetoed: boolean;
}

interface RoundCandidate {
    round: bigint;
    roundInfo: RoundInfo;
    base: DetectedSlashing;
}

export class SlashingDetector {
    private readonly config: ResolvedMonitorConfig;
    private readonly l1Monitor: L1Monitor;

    constructor(config: ResolvedMonitorConfig, l1Monitor: L1Monitor) {
        this.config = config;
        this.l1Monitor = l1Monitor;
    }

    calculateRoundStatus(round: bigint, currentRound: bigint, currentSlot: bigint, isExecuted: boolean, hasSlashActions: boolean): RoundStatus {
        return calculateRoundStatus(round, currentRound, currentSlot, isExecuted, hasSlashActions, this.config);
    }

    calculateExecutableSlot(round: bigint): bigint {
        return calculateExecutableSlot(round, this.config);
    }

    calculateExpirySlot(round: bigint): bigint {
        return calculateExpirySlot(round, this.config);
    }

    getTargetEpochs(votingRound: bigint): bigint[] {
        return getTargetEpochs(votingRound, this.config);
    }

    async detectExecutableRounds(currentRound: bigint, currentSlot: bigint): Promise<{
        detectedSlashings: DetectedSlashing[];
        issues: MonitorIssue[];
    }> {
        const roundsToCheck = this.buildRoundsToCheck(currentRound);
        const issues: MonitorIssue[] = [];
        const simpleRounds: DetectedSlashing[] = [];
        const detailedRounds = new Map<bigint, DetectedSlashing>();
        const roundsNeedingDetails: RoundCandidate[] = [];
        const roundInfoResults = await this.l1Monitor.getRounds(roundsToCheck);

        for (const round of roundsToCheck) {
            const roundInfoResult = roundInfoResults.get(round);
            if (!roundInfoResult) {
                issues.push(this.createIssue('rounds', `Round ${round} was not returned by the RPC batch`, round));
                continue;
            }

            if (!roundInfoResult.success) {
                issues.push(this.createIssue('rounds', roundInfoResult.error.message, round));
                continue;
            }

            const base = this.createBaseDetection(roundInfoResult.data, currentRound, currentSlot);
            if (!this.shouldLoadDetails(base)) {
                if (round === currentRound || roundInfoResult.data.ballotCount > 0n) {
                    simpleRounds.push(base);
                }
                continue;
            }

            roundsNeedingDetails.push({
                round,
                roundInfo: roundInfoResult.data,
                base,
            });
        }

        if (roundsNeedingDetails.length > 0) {
            await this.loadRoundDetails(roundsNeedingDetails, currentRound, currentSlot, detailedRounds, simpleRounds, issues);
        }

        return {
            detectedSlashings: [...simpleRounds, ...detailedRounds.values()].sort((a, b) => Number(b.round - a.round)),
            issues,
        };
    }

    private async loadRoundDetails(
        rounds: RoundCandidate[],
        currentRound: bigint,
        currentSlot: bigint,
        detailedRounds: Map<bigint, DetectedSlashing>,
        simpleRounds: DetectedSlashing[],
        issues: MonitorIssue[]
    ) {
        const committeeResults = await this.l1Monitor.batchGetSlashTargetCommittees(rounds.map(({ round }) => round));
        const voteCandidates: Array<RoundCandidate & { committees: Address[][] }> = [];

        committeeResults.forEach((committeeResult, index) => {
            const candidate = rounds[index];
            if (!committeeResult.success) {
                const message = `Unable to load slash committees: ${committeeResult.error.message}`;
                simpleRounds.push(this.buildPartialDetection(candidate.base, currentRound, currentSlot, message));
                issues.push(this.createIssue('round-details', message, candidate.round));
                return;
            }

            voteCandidates.push({
                ...candidate,
                committees: committeeResult.data,
            });
        });

        if (voteCandidates.length === 0) {
            return;
        }

        const tallyCandidates: Array<RoundCandidate & {
            committees: Address[][];
            targets: VoteTarget[];
            escapeHatchEpochs: boolean[];
        }> = [];
        await Promise.all(voteCandidates.map(async (candidate) => {
            try {
                const targetEpochs = this.getTargetEpochs(candidate.round);
                const [votes, escapeHatchEpochs] = await Promise.all([
                    this.l1Monitor.getVotes(candidate.round, candidate.roundInfo.ballotCount),
                    this.l1Monitor.getEscapeHatchFlags(targetEpochs),
                ]);
                const targets = decodeVoteTargets(
                    votes,
                    candidate.committees,
                    this.config.committeeSize,
                );
                if (candidate.roundInfo.ballotCount < BigInt(this.config.quorum)) {
                    simpleRounds.push(this.buildTargetDetection(
                        candidate.base,
                        candidate.committees,
                        targets,
                        escapeHatchEpochs,
                        currentRound,
                        currentSlot,
                    ));
                }
                else {
                    tallyCandidates.push({ ...candidate, targets, escapeHatchEpochs });
                }
            }
            catch (error) {
                const message = `Unable to decode exact vote targets: ${toMessage(error)}`;
                simpleRounds.push(this.buildPartialDetection(
                    candidate.base,
                    currentRound,
                    currentSlot,
                    message,
                    candidate.committees,
                ));
                issues.push(this.createIssue('round-details', message, candidate.round));
            }
        }));

        if (tallyCandidates.length === 0) return;

        const tallyResults = await this.l1Monitor.batchGetTally(
            tallyCandidates.map(({ round, committees }) => ({ round, committees }))
        );
        const payloadCandidates: Array<RoundCandidate & {
            committees: Address[][];
            slashActions: SlashAction[];
            targetDetails: SlashingTargetDetail[];
        }> = [];

        tallyResults.forEach((tallyResult, index) => {
            const candidate = tallyCandidates[index];
            if (!tallyResult.success) {
                const message = `Unable to load slash actions: ${tallyResult.error.message}`;
                simpleRounds.push(this.buildPartialDetection(candidate.base, currentRound, currentSlot, message));
                issues.push(this.createIssue('round-details', message, candidate.round));
                return;
            }

            if (tallyResult.data.length === 0) {
                simpleRounds.push(this.buildTargetDetection(
                    candidate.base,
                    candidate.committees,
                    candidate.targets,
                    candidate.escapeHatchEpochs,
                    currentRound,
                    currentSlot,
                ));
                return;
            }

            try {
                const matched = matchVoteActions(
                    tallyResult.data.map((action) => ({
                        sequencer: action.validator.toLowerCase(),
                        amount: action.slashAmount.toString(),
                    })),
                    candidate.targets,
                    this.config.quorum,
                    candidate.escapeHatchEpochs,
                );
                const actionTargets = new Map(matched.map((target, actionIndex) => [
                    voteTargetKey(target),
                    { ...target, actionIndex },
                ]));
                payloadCandidates.push({
                    ...candidate,
                    slashActions: tallyResult.data,
                    targetDetails: candidate.targets.map((target) => ({
                        ...target,
                        ...actionTargets.get(voteTargetKey(target)),
                        sequencer: target.sequencer as Address,
                        targetEpoch: this.getTargetEpochs(candidate.round)[target.epochIndex],
                        amount: actionTargets.has(voteTargetKey(target))
                            ? BigInt(actionTargets.get(voteTargetKey(target))!.amount)
                            : undefined,
                        support: actionTargets.get(voteTargetKey(target))?.support ??
                            target.voteCount,
                        escaped: Boolean(candidate.escapeHatchEpochs[target.epochIndex]),
                    })),
                });
            }
            catch (error) {
                const message = `Unable to link tally actions to exact epochs: ${toMessage(error)}`;
                simpleRounds.push(this.buildPartialDetection(
                    candidate.base,
                    currentRound,
                    currentSlot,
                    message,
                    candidate.committees,
                    tallyResult.data,
                ));
                issues.push(this.createIssue('round-details', message, candidate.round));
            }
        });

        if (payloadCandidates.length === 0) {
            return;
        }

        const payloadResults = await this.l1Monitor.batchGetPayloadAddressesAndVetoStatus(
            payloadCandidates.map(({ round, slashActions }) => ({ round, actions: slashActions }))
        );

        payloadResults.forEach((payloadResult, index) => {
            const candidate = payloadCandidates[index];
            if (!payloadResult.success) {
                const message = `Unable to load payload status: ${payloadResult.error.message}`;
                simpleRounds.push(this.buildPartialDetection(
                    candidate.base,
                    currentRound,
                    currentSlot,
                    message,
                    candidate.committees,
                    candidate.slashActions
                ));
                issues.push(this.createIssue('round-details', message, candidate.round));
                return;
            }

            const details: DetailedRound = {
                committees: candidate.committees,
                slashActions: candidate.slashActions,
                targetDetails: candidate.targetDetails,
                payloadAddress: payloadResult.data.payloadAddress,
                isVetoed: payloadResult.data.isVetoed,
            };

            detailedRounds.set(candidate.round, this.buildDetailedDetection(candidate.base, details, currentRound, currentSlot));
        });
    }

    private createBaseDetection(roundInfo: RoundInfo, currentRound: bigint, currentSlot: bigint): DetectedSlashing {
        return {
            round: roundInfo.round,
            status: this.calculateRoundStatus(roundInfo.round, currentRound, currentSlot, roundInfo.isExecuted, false),
            ballotCount: roundInfo.ballotCount,
            isExecuted: roundInfo.isExecuted,
            isVetoed: false,
            verificationStatus: 'verified',
        };
    }

    private buildDetailedDetection(
        base: DetectedSlashing,
        details: DetailedRound,
        currentRound: bigint,
        currentSlot: bigint
    ): DetectedSlashing {
        const totalSlashAmount = details.slashActions.reduce((sum, action) => sum + action.slashAmount, 0n);
        const affectedValidatorCount = countUniqueValidators(details.slashActions);

        return {
            ...base,
            status: this.calculateRoundStatus(base.round, currentRound, currentSlot, base.isExecuted, true),
            verificationStatus: 'verified',
            committees: details.committees,
            slashActions: details.slashActions,
            targetDetails: details.targetDetails,
            payloadAddress: details.payloadAddress,
            isVetoed: details.isVetoed,
            slotWhenExecutable: this.calculateExecutableSlot(base.round),
            slotWhenExpires: this.calculateExpirySlot(base.round),
            secondsUntilExecutable: this.calculateSecondsUntilSlot(this.calculateExecutableSlot(base.round), currentSlot),
            secondsUntilExpires: this.calculateSecondsUntilSlot(this.calculateExpirySlot(base.round), currentSlot),
            lastUpdatedTimestamp: Date.now(),
            targetEpochs: this.getTargetEpochs(base.round),
            totalSlashAmount,
            affectedValidatorCount,
        };
    }

    private buildPartialDetection(
        base: DetectedSlashing,
        currentRound: bigint,
        currentSlot: bigint,
        issue: string,
        committees?: Address[][],
        slashActions?: SlashAction[]
    ): DetectedSlashing {
        const totalSlashAmount = slashActions?.reduce((sum, action) => sum + action.slashAmount, 0n);
        const affectedValidatorCount = slashActions ? countUniqueValidators(slashActions) : undefined;

        return {
            ...base,
            status: slashActions && slashActions.length > 0
                ? this.calculateRoundStatus(base.round, currentRound, currentSlot, base.isExecuted, true)
                : base.status,
            verificationStatus: 'partial',
            issues: [issue],
            committees,
            slashActions,
            slotWhenExecutable: this.calculateExecutableSlot(base.round),
            slotWhenExpires: this.calculateExpirySlot(base.round),
            secondsUntilExecutable: this.calculateSecondsUntilSlot(this.calculateExecutableSlot(base.round), currentSlot),
            secondsUntilExpires: this.calculateSecondsUntilSlot(this.calculateExpirySlot(base.round), currentSlot),
            lastUpdatedTimestamp: Date.now(),
            targetEpochs: this.getTargetEpochs(base.round),
            totalSlashAmount,
            affectedValidatorCount,
        };
    }

    private buildTargetDetection(
        base: DetectedSlashing,
        committees: Address[][],
        targets: VoteTarget[],
        escapeHatchEpochs: boolean[],
        currentRound: bigint,
        currentSlot: bigint,
    ): DetectedSlashing {
        const targetEpochs = this.getTargetEpochs(base.round);
        return {
            ...base,
            committees,
            targetEpochs,
            targetDetails: targets.map((target) => ({
                ...target,
                sequencer: target.sequencer as Address,
                targetEpoch: targetEpochs[target.epochIndex],
                support: target.voteCount,
                escaped: Boolean(escapeHatchEpochs[target.epochIndex]),
            })),
            slotWhenExecutable: this.calculateExecutableSlot(base.round),
            slotWhenExpires: this.calculateExpirySlot(base.round),
            secondsUntilExecutable: this.calculateSecondsUntilSlot(
                this.calculateExecutableSlot(base.round),
                currentSlot,
            ),
            secondsUntilExpires: this.calculateSecondsUntilSlot(
                this.calculateExpirySlot(base.round),
                currentSlot,
            ),
            lastUpdatedTimestamp: Date.now(),
            status: this.calculateRoundStatus(
                base.round,
                currentRound,
                currentSlot,
                base.isExecuted,
                false,
            ),
            issues: escapeHatchEpochs.some(Boolean)
                ? ['Targets in an open escape-hatch epoch are excluded from the contract tally.']
                : undefined,
        };
    }

    private shouldLoadDetails(slashing: DetectedSlashing) {
        return slashing.isExecuted || slashing.ballotCount > 0n;
    }

    private buildRoundsToCheck(currentRound: bigint): bigint[] {
        return buildRoundsToCheck(currentRound, this.config);
    }

    private calculateSecondsUntilSlot(targetSlot: bigint, currentSlot: bigint): number {
        if (targetSlot <= currentSlot) {
            return 0;
        }

        return Number(targetSlot - currentSlot) * this.config.slotDuration;
    }

    private createIssue(scope: MonitorIssue['scope'], message: string, round?: bigint): MonitorIssue {
        return {
            source: 'l1-rpc',
            scope,
            message,
            round,
        };
    }
}

function toMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
}

function voteTargetKey(target: Pick<
    VoteTarget,
    'epochIndex' | 'committeeIndex' | 'sequencer'
>): string {
    return `${target.epochIndex}:${target.committeeIndex}:${target.sequencer.toLowerCase()}`;
}
