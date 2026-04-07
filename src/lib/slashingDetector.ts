import type { Address } from 'viem';
import type { DetectedSlashing, MonitorIssue, ResolvedMonitorConfig, RoundInfo, RoundStatus, SlashAction } from '@/types/slashing';
import { ImmutableAwareCache } from './immutableCache';
import { L1Monitor } from './l1Monitor';

const MAX_DETAILS_CACHE_SIZE = 50;

interface DetailedRoundCache {
    voteCount: bigint;
    committees: Address[][];
    slashActions: SlashAction[];
    payloadAddress: Address;
    isVetoed: boolean;
    isExecuted: boolean;
}

interface RoundCandidate {
    round: bigint;
    roundInfo: RoundInfo;
    base: DetectedSlashing;
}

export class SlashingDetector {
    private readonly config: ResolvedMonitorConfig;
    private readonly l1Monitor: L1Monitor;
    private readonly detailsCache: ImmutableAwareCache<bigint, DetailedRoundCache>;
    private readonly mutableTTL: number;

    constructor(config: ResolvedMonitorConfig, l1Monitor: L1Monitor) {
        this.config = config;
        this.l1Monitor = l1Monitor;
        this.mutableTTL = config.detailsCacheTTL;
        this.detailsCache = new ImmutableAwareCache(
            (round) => round.toString(),
            (details) => details.isExecuted,
            { maxMutableSize: MAX_DETAILS_CACHE_SIZE }
        );
    }

    getCacheStats() {
        return this.detailsCache.getStats();
    }

    logCacheStats() {
        console.log(`[SlashingDetector] ${this.detailsCache.getStatsString()}`);
    }

    calculateRoundStatus(round: bigint, currentRound: bigint, currentSlot: bigint, isExecuted: boolean, hasQuorum: boolean): RoundStatus {
        if (isExecuted) {
            return 'executed';
        }

        if (this.isRoundExpired(round, currentRound)) {
            return 'expired';
        }

        if (hasQuorum && this.isRoundExecutable(round, currentRound, currentSlot)) {
            return 'executable';
        }

        if (hasQuorum && this.isInVetoWindow(round, currentRound, currentSlot)) {
            return 'in-veto-window';
        }

        return hasQuorum ? 'quorum-reached' : 'expired';
    }

    calculateExecutableSlot(round: bigint): bigint {
        const roundSize = BigInt(this.config.slashingRoundSize);
        const executionDelay = BigInt(this.config.executionDelayInRounds);
        return (round + 1n + executionDelay) * roundSize;
    }

    calculateExpirySlot(round: bigint): bigint {
        const roundSize = BigInt(this.config.slashingRoundSize);
        const lifetime = BigInt(this.config.lifetimeInRounds);
        return (round + 1n + lifetime) * roundSize;
    }

    getTargetEpochs(votingRound: bigint): bigint[] {
        const roundSizeInEpochs = BigInt(this.config.slashingRoundSizeInEpochs);
        const slashOffset = BigInt(this.config.slashOffsetInRounds);
        const targetRound = votingRound - slashOffset;
        const startEpoch = targetRound * roundSizeInEpochs;
        const epochs: bigint[] = [];

        for (let offset = 0n; offset < roundSizeInEpochs; offset++) {
            epochs.push(startEpoch + offset);
        }

        return epochs;
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
                if (round === currentRound || roundInfoResult.data.voteCount > 0n) {
                    simpleRounds.push(base);
                }
                continue;
            }

            const cachedDetails = this.getCachedDetails(round, roundInfoResult.data.voteCount);
            if (cachedDetails) {
                detailedRounds.set(round, this.buildDetailedDetection(base, cachedDetails, currentSlot));
                continue;
            }

            roundsNeedingDetails.push({
                round,
                roundInfo: roundInfoResult.data,
                base,
            });
        }

        if (roundsNeedingDetails.length > 0) {
            await this.loadRoundDetails(roundsNeedingDetails, currentSlot, detailedRounds, simpleRounds, issues);
        }

        return {
            detectedSlashings: [...simpleRounds, ...detailedRounds.values()].sort((a, b) => Number(b.round - a.round)),
            issues,
        };
    }

    private async loadRoundDetails(
        rounds: RoundCandidate[],
        currentSlot: bigint,
        detailedRounds: Map<bigint, DetectedSlashing>,
        simpleRounds: DetectedSlashing[],
        issues: MonitorIssue[]
    ) {
        const committeeResults = await this.l1Monitor.batchGetSlashTargetCommittees(rounds.map(({ round }) => round));
        const tallyCandidates: Array<RoundCandidate & { committees: Address[][] }> = [];

        committeeResults.forEach((committeeResult, index) => {
            const candidate = rounds[index];
            if (!committeeResult.success) {
                const message = `Unable to load slash committees: ${committeeResult.error.message}`;
                simpleRounds.push(this.buildPartialDetection(candidate.base, currentSlot, message));
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
                simpleRounds.push(this.buildPartialDetection(candidate.base, currentSlot, message));
                issues.push(this.createIssue('round-details', message, candidate.round));
                return;
            }

            if (tallyResult.data.length === 0) {
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
                simpleRounds.push(this.buildPartialDetection(
                    candidate.base,
                    currentSlot,
                    message,
                    candidate.committees,
                    candidate.slashActions
                ));
                issues.push(this.createIssue('round-details', message, candidate.round));
                return;
            }

            const details: DetailedRoundCache = {
                voteCount: candidate.roundInfo.voteCount,
                committees: candidate.committees,
                slashActions: candidate.slashActions,
                payloadAddress: payloadResult.data.payloadAddress,
                isVetoed: payloadResult.data.isVetoed,
                isExecuted: candidate.roundInfo.isExecuted,
            };

            this.detailsCache.set(candidate.round, details, this.mutableTTL);
            detailedRounds.set(candidate.round, this.buildDetailedDetection(candidate.base, details, currentSlot));
        });
    }

    private getCachedDetails(round: bigint, voteCount: bigint): DetailedRoundCache | null {
        const cached = this.detailsCache.get(round);
        if (!cached) {
            return null;
        }

        if (!cached.isExecuted && cached.voteCount !== voteCount) {
            this.detailsCache.delete(round);
            return null;
        }

        return cached;
    }

    private createBaseDetection(roundInfo: RoundInfo, currentRound: bigint, currentSlot: bigint): DetectedSlashing {
        const hasQuorum = roundInfo.voteCount >= this.config.quorum;
        return {
            round: roundInfo.round,
            status: this.calculateRoundStatus(roundInfo.round, currentRound, currentSlot, roundInfo.isExecuted, hasQuorum),
            voteCount: roundInfo.voteCount,
            isExecuted: roundInfo.isExecuted,
            isVetoed: false,
            verificationStatus: 'verified',
        };
    }

    private buildDetailedDetection(base: DetectedSlashing, details: DetailedRoundCache, currentSlot: bigint): DetectedSlashing {
        const totalSlashAmount = details.slashActions.reduce((sum, action) => sum + action.slashAmount, 0n);

        return {
            ...base,
            verificationStatus: 'verified',
            committees: details.committees,
            slashActions: details.slashActions,
            payloadAddress: details.payloadAddress,
            isVetoed: details.isVetoed,
            slotWhenExecutable: this.calculateExecutableSlot(base.round),
            slotWhenExpires: this.calculateExpirySlot(base.round),
            secondsUntilExecutable: this.calculateSecondsUntilSlot(this.calculateExecutableSlot(base.round), currentSlot),
            secondsUntilExpires: this.calculateSecondsUntilSlot(this.calculateExpirySlot(base.round), currentSlot),
            lastUpdatedTimestamp: Date.now(),
            targetEpochs: this.getTargetEpochs(base.round),
            totalSlashAmount,
            affectedValidatorCount: details.slashActions.length,
        };
    }

    private buildPartialDetection(
        base: DetectedSlashing,
        currentSlot: bigint,
        issue: string,
        committees?: Address[][],
        slashActions?: SlashAction[]
    ): DetectedSlashing {
        const totalSlashAmount = slashActions?.reduce((sum, action) => sum + action.slashAmount, 0n);

        return {
            ...base,
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
            affectedValidatorCount: slashActions?.length,
        };
    }

    private shouldLoadDetails(slashing: DetectedSlashing) {
        return slashing.isExecuted || slashing.voteCount >= BigInt(this.config.quorum);
    }

    private buildRoundsToCheck(currentRound: bigint): bigint[] {
        const rounds = new Set<bigint>();
        const executionDelay = BigInt(this.config.executionDelayInRounds);
        const lifetime = BigInt(this.config.lifetimeInRounds);
        const earlyWarningStart = currentRound - executionDelay + 1n;
        // getRound() only supports the contract's active lifetime window.
        const executableStart = currentRound - lifetime;
        const executableEnd = currentRound - executionDelay;

        for (let round = earlyWarningStart; round <= currentRound; round++) {
            if (round >= 0n) {
                rounds.add(round);
            }
        }

        for (let round = executableStart; round <= executableEnd; round++) {
            if (round >= 0n) {
                rounds.add(round);
            }
        }

        return Array.from(rounds).sort((a, b) => Number(a - b));
    }

    private calculateSecondsUntilSlot(targetSlot: bigint, currentSlot: bigint): number {
        if (targetSlot <= currentSlot) {
            return 0;
        }

        return Number(targetSlot - currentSlot) * this.config.slotDuration;
    }

    private isRoundExpired(round: bigint, currentRound: bigint): boolean {
        return currentRound - round > BigInt(this.config.lifetimeInRounds);
    }

    private isInVetoWindow(round: bigint, currentRound: bigint, currentSlot: bigint): boolean {
        return currentRound - round === BigInt(this.config.executionDelayInRounds) &&
            currentSlot >= this.calculateExecutableSlot(round);
    }

    private isRoundExecutable(round: bigint, currentRound: bigint, currentSlot: bigint): boolean {
        const roundsSinceEnd = currentRound - round;
        return roundsSinceEnd > BigInt(this.config.executionDelayInRounds) &&
            roundsSinceEnd <= BigInt(this.config.lifetimeInRounds) &&
            currentSlot >= this.calculateExecutableSlot(round);
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
