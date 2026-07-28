import type { Address } from 'viem';
import type {
    DetectedL1Round,
    MonitorIssue,
    ResolvedMonitorConfig,
    RoundInfo,
    SlashAction,
} from '@/types/slashing';
import { L1Monitor } from './l1Monitor';
import {
    buildRoundsToCheck,
    calculateExecutableSlot,
    calculateExpirySlot,
    getTargetEpochs,
} from './slashingLifecycle';

interface DetailedRound {
    slashActions: SlashAction[];
    payloadAddress: Address;
    isVetoed: boolean;
}

interface RoundCandidate {
    round: bigint;
    base: DetectedL1Round;
}

export class SlashingDetector {
    private readonly config: ResolvedMonitorConfig;
    private readonly l1Monitor: L1Monitor;

    constructor(config: ResolvedMonitorConfig, l1Monitor: L1Monitor) {
        this.config = config;
        this.l1Monitor = l1Monitor;
    }

    async detectRounds(currentRound: bigint): Promise<{
        detectedRounds: DetectedL1Round[];
        issues: MonitorIssue[];
    }> {
        const roundsToCheck = this.buildRoundsToCheck(currentRound);
        const issues: MonitorIssue[] = [];
        const simpleRounds: DetectedL1Round[] = [];
        const detailedRounds = new Map<bigint, DetectedL1Round>();
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

            const base = this.createBaseDetection(roundInfoResult.data);
            if (!this.shouldLoadDetails(base)) {
                if (roundInfoResult.data.ballotCount > 0n) {
                    simpleRounds.push(base);
                }
                continue;
            }

            roundsNeedingDetails.push({
                round,
                base,
            });
        }

        if (roundsNeedingDetails.length > 0) {
            await this.loadRoundDetails(
                roundsNeedingDetails,
                detailedRounds,
                simpleRounds,
                issues,
            );
        }

        return {
            detectedRounds: [...simpleRounds, ...detailedRounds.values()]
                .sort((a, b) => Number(b.round - a.round)),
            issues,
        };
    }

    private async loadRoundDetails(
        rounds: RoundCandidate[],
        detailedRounds: Map<bigint, DetectedL1Round>,
        simpleRounds: DetectedL1Round[],
        issues: MonitorIssue[]
    ) {
        const committeeResults = await this.l1Monitor.batchGetSlashTargetCommittees(rounds.map(({ round }) => round));
        const tallyCandidates: Array<RoundCandidate & { committees: Address[][] }> = [];

        committeeResults.forEach((committeeResult, index) => {
            const candidate = rounds[index];
            if (!committeeResult.success) {
                const message = `Unable to load slash committees: ${committeeResult.error.message}`;
                issues.push(this.createIssue('round-details', message, candidate.round));
                return;
            }

            tallyCandidates.push({
                ...candidate,
                committees: committeeResult.data,
            });
        });

        if (tallyCandidates.length === 0) {
            return;
        }

        const tallyResults = await this.l1Monitor.batchGetTally(
            tallyCandidates.map(({ round, committees }) => ({ round, committees }))
        );
        const payloadCandidates: Array<RoundCandidate & { committees: Address[][]; slashActions: SlashAction[] }> = [];

        tallyResults.forEach((tallyResult, index) => {
            const candidate = tallyCandidates[index];
            if (!tallyResult.success) {
                const message = `Unable to load slash actions: ${tallyResult.error.message}`;
                issues.push(this.createIssue('round-details', message, candidate.round));
                return;
            }

            if (tallyResult.data.length === 0) {
                simpleRounds.push(candidate.base);
                return;
            }

            payloadCandidates.push({
                ...candidate,
                slashActions: tallyResult.data,
            });
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
                issues.push(this.createIssue('round-details', message, candidate.round));
                return;
            }

            const details: DetailedRound = {
                slashActions: candidate.slashActions,
                payloadAddress: payloadResult.data.payloadAddress,
                isVetoed: payloadResult.data.isVetoed,
            };

            detailedRounds.set(
                candidate.round,
                this.buildDetailedDetection(candidate.base, details),
            );
        });
    }

    private createBaseDetection(roundInfo: RoundInfo): DetectedL1Round {
        return {
            round: roundInfo.round,
            ballotCount: roundInfo.ballotCount,
            isExecuted: roundInfo.isExecuted,
            isVetoed: false,
            slashActions: [],
            slotWhenExecutable: calculateExecutableSlot(roundInfo.round, this.config),
            slotWhenExpires: calculateExpirySlot(roundInfo.round, this.config),
            targetEpochs: getTargetEpochs(roundInfo.round, this.config),
        };
    }

    private buildDetailedDetection(
        base: DetectedL1Round,
        details: DetailedRound,
    ): DetectedL1Round {
        return {
            ...base,
            slashActions: details.slashActions,
            payloadAddress: details.payloadAddress,
            isVetoed: details.isVetoed,
        };
    }

    private shouldLoadDetails(round: DetectedL1Round) {
        return round.isExecuted || round.ballotCount >= BigInt(this.config.quorum);
    }

    private buildRoundsToCheck(currentRound: bigint): bigint[] {
        return buildRoundsToCheck(currentRound, this.config);
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
