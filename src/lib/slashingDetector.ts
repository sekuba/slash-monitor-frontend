import type { Address } from 'viem';
import { L1Monitor } from './l1Monitor';
import { ImmutableAwareCache } from './immutableCache';
import type { DetectedSlashing, RoundStatus, SlashingMonitorConfig, SlashAction, RoundInfo, } from '@/types/slashing';

// Cache configuration constants
const MAX_DETAILS_CACHE_SIZE = 50; // Maximum number of mutable round details to cache

interface DetailedRoundCache {
    voteCount: bigint;
    committees: Address[][];
    slashActions: SlashAction[];
    payloadAddress: Address;
    isVetoed: boolean;
    isExecuted: boolean;
}
export class SlashingDetector {
    private config: SlashingMonitorConfig;
    private l1Monitor: L1Monitor;
    private detailsCache: ImmutableAwareCache<bigint, DetailedRoundCache>;
    private mutableTTL: number;
    constructor(config: SlashingMonitorConfig, l1Monitor: L1Monitor) {
        this.config = config;
        this.l1Monitor = l1Monitor;
        this.mutableTTL = config.detailsCacheTTL;
        this.detailsCache = new ImmutableAwareCache<bigint, DetailedRoundCache>((round) => round.toString(), (details) => details.isExecuted, { maxMutableSize: MAX_DETAILS_CACHE_SIZE });
    }
    private getCachedDetails(round: bigint, voteCount: bigint): DetailedRoundCache | null {
        const cached = this.detailsCache.get(round);
        if (!cached)
            return null;
        if (!cached.isExecuted && cached.voteCount !== voteCount) {
            this.detailsCache.delete(round);
            return null;
        }
        return cached;
    }
    getCacheStats() {
        return this.detailsCache.getStats();
    }
    logCacheStats() {
        console.log(`[SlashingDetector] ${this.detailsCache.getStatsString()}`);
    }
    /**
     * Determines if a voting round is currently active.
     * A voting round is active when it equals the current round.
     */
    private isBeingVotedOn(votingRound: bigint, currentRound: bigint): boolean {
        return currentRound === votingRound;
    }

    /**
     * Determines if a round has expired (past its lifetime).
     */
    private isRoundExpired(round: bigint, currentRound: bigint): boolean {
        const roundsSinceEnd = currentRound - round;
        const lifetime = BigInt(this.config.lifetimeInRounds);
        return roundsSinceEnd > lifetime;
    }

    /**
     * Determines if a round is in its veto window (newly executable).
     */
    private isInVetoWindow(round: bigint, currentRound: bigint, currentSlot: bigint): boolean {
        const roundsSinceEnd = currentRound - round;
        const executionDelay = BigInt(this.config.executionDelayInRounds);
        const executableSlot = this.calculateExecutableSlot(round);
        return roundsSinceEnd === executionDelay && currentSlot >= executableSlot;
    }

    /**
     * Determines if a round is executable (past veto window but not expired).
     */
    private isRoundExecutable(round: bigint, currentRound: bigint, currentSlot: bigint): boolean {
        const roundsSinceEnd = currentRound - round;
        const executionDelay = BigInt(this.config.executionDelayInRounds);
        const lifetime = BigInt(this.config.lifetimeInRounds);
        const executableSlot = this.calculateExecutableSlot(round);
        return roundsSinceEnd > executionDelay &&
               roundsSinceEnd <= lifetime &&
               currentSlot >= executableSlot;
    }

    calculateRoundStatus(round: bigint, currentRound: bigint, currentSlot: bigint, isExecuted: boolean, hasQuorum: boolean): RoundStatus {
        // Early returns for definitive states
        if (isExecuted) {
            return 'executed';
        }

        if (this.isRoundExpired(round, currentRound)) {
            return 'expired';
        }

        // Only rounds with quorum can be executable or in veto window
        if (hasQuorum) {
            if (this.isRoundExecutable(round, currentRound, currentSlot)) {
                return 'executable';
            }

            if (this.isInVetoWindow(round, currentRound, currentSlot)) {
                return 'in-veto-window';
            }
        }

        // Check if we're currently in the voting window for this round
        if (this.isBeingVotedOn(round, currentRound)) {
            return 'quorum-reached'; // Current round always shows as quorum-reached (displayed in SlashingTimeline only)
        }

        // If voting has ended but round hasn't reached executable state yet
        // Show quorum-reached if quorum was met, otherwise treat as expired
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
    calculateSecondsUntilSlot(targetSlot: bigint, currentSlot: bigint): number {
        if (targetSlot <= currentSlot) {
            return 0;
        }
        const slotDifference = Number(targetSlot - currentSlot);
        return slotDifference * this.config.slotDuration;
    }
    /**
     * Gets the target epochs for a voting round.
     * Takes a voting round number and returns the epochs from its target round.
     * Example: voting round 61 with offset 2 → returns epochs from target round 59
     */
    getTargetEpochs(votingRound: bigint): bigint[] {
        const roundSizeInEpochs = BigInt(this.config.slashingRoundSizeInEpochs);
        const slashOffset = BigInt(this.config.slashOffsetInRounds);
        const targetRound = votingRound - slashOffset;
        const startEpoch = targetRound * roundSizeInEpochs;
        const epochs: bigint[] = [];
        for (let i = 0n; i < roundSizeInEpochs; i++) {
            epochs.push(startEpoch + i);
        }
        return epochs;
    }
    async detectRound(round: bigint, currentRound: bigint, currentSlot: bigint): Promise<DetectedSlashing | null> {
        try {
            // Note: 'round' is the voting round number
            // - Vote count comes from this voting round
            // - Payload/committees queried with this number return target round's data
            // - targetEpochs are calculated from the target round (round - slashOffset)
            const roundInfo = await this.l1Monitor.getRound(round);
            const hasQuorum = roundInfo.voteCount >= this.config.quorum;
            const status = this.calculateRoundStatus(round, currentRound, currentSlot, roundInfo.isExecuted, hasQuorum);
            const detected: DetectedSlashing = {
                round,
                status,
                voteCount: roundInfo.voteCount,
                isExecuted: roundInfo.isExecuted,
                isVetoed: false,
            };
            const shouldComputeDetails = (hasQuorum && (status === 'quorum-reached' || status === 'in-veto-window' || status === 'executable')) ||
                status === 'executed';
            if (shouldComputeDetails) {
                const cachedDetails = this.getCachedDetails(round, roundInfo.voteCount);
                let committees: Address[][];
                let slashActions: SlashAction[];
                let payloadAddress: Address;
                let isVetoed: boolean;
                if (cachedDetails) {
                    committees = cachedDetails.committees;
                    slashActions = cachedDetails.slashActions;
                    payloadAddress = cachedDetails.payloadAddress;
                    isVetoed = cachedDetails.isVetoed;
                }
                else {
                    committees = await this.l1Monitor.getSlashTargetCommittees(round);
                    slashActions = await this.l1Monitor.getTally(round, committees);
                    if (slashActions.length === 0) {
                        return null;
                    }
                    payloadAddress = await this.l1Monitor.getPayloadAddress(round, slashActions);
                    isVetoed = await this.l1Monitor.isPayloadVetoed(payloadAddress);
                    this.detailsCache.set(round, {
                        voteCount: roundInfo.voteCount,
                        committees,
                        slashActions,
                        payloadAddress,
                        isVetoed,
                        isExecuted: roundInfo.isExecuted,
                    }, this.mutableTTL);
                }
                const executableSlot = this.calculateExecutableSlot(round);
                const expirySlot = this.calculateExpirySlot(round);
                const secondsUntilExecutable = this.calculateSecondsUntilSlot(executableSlot, currentSlot);
                const secondsUntilExpires = this.calculateSecondsUntilSlot(expirySlot, currentSlot);
                const totalSlashAmount = slashActions.reduce((sum, action) => sum + action.slashAmount, 0n);
                const affectedValidatorCount = slashActions.length;
                const targetEpochs = this.getTargetEpochs(round);
                return {
                    ...detected,
                    committees,
                    slashActions,
                    payloadAddress,
                    isVetoed,
                    slotWhenExecutable: executableSlot,
                    slotWhenExpires: expirySlot,
                    secondsUntilExecutable,
                    secondsUntilExpires,
                    lastUpdatedTimestamp: Date.now(),
                    targetEpochs,
                    totalSlashAmount,
                    affectedValidatorCount,
                };
            }
            return detected;
        }
        catch (error) {
            console.error(`Error detecting round ${round}:`, error);
            return null;
        }
    }
    async detectExecutableRounds(currentRound: bigint, currentSlot: bigint): Promise<DetectedSlashing[]> {
        const executionDelay = BigInt(this.config.executionDelayInRounds);
        const lifetime = BigInt(this.config.lifetimeInRounds);
        const lookbackRounds = BigInt(this.config.lookbackRounds);
        const slashingPeriodSize = executionDelay + lifetime + 1n;
        console.log(`[Detection] Scanning rounds: current=${currentRound}, period size=${slashingPeriodSize}, lookback=${lookbackRounds}`);
        const roundsToCheck: bigint[] = [];
        const earlyWarningStart = currentRound - executionDelay + 1n;
        const earlyWarningEnd = currentRound;
        for (let round = earlyWarningStart; round <= earlyWarningEnd; round++) {
            if (round >= 0n) {
                roundsToCheck.push(round);
            }
        }
        // Determine the start of the executable/historical window
        // If lookbackRounds is set and greater than lifetime, use it to extend the scan window
        const defaultExecutableStart = currentRound - lifetime;
        const lookbackStart = lookbackRounds > 0n ? currentRound - lookbackRounds : defaultExecutableStart;
        const executableStart = lookbackStart < defaultExecutableStart ? lookbackStart : defaultExecutableStart;
        const executableEnd = currentRound - executionDelay;
        for (let round = executableStart; round <= executableEnd; round++) {
            if (round >= 0n && round < earlyWarningStart) {
                roundsToCheck.push(round);
            }
        }
        console.log(`[Detection] Fetching ${roundsToCheck.length} rounds via multicall`);
        const roundInfoMap = await this.l1Monitor.getRounds(roundsToCheck);
        interface RoundToProcess {
            round: bigint;
            roundInfo: RoundInfo;
            status: RoundStatus;
            hasQuorum: boolean;
        }
        const roundsNeedingDetails: RoundToProcess[] = [];
        const roundsWithDetails: Map<bigint, DetectedSlashing> = new Map();
        const simpleRounds: DetectedSlashing[] = [];
        for (const round of roundsToCheck) {
            const roundInfo = roundInfoMap.get(round);
            if (!roundInfo)
                continue;
            const hasQuorum = roundInfo.voteCount >= this.config.quorum;
            const status = this.calculateRoundStatus(round, currentRound, currentSlot, roundInfo.isExecuted, hasQuorum);
            const detected: DetectedSlashing = {
                round,
                status,
                voteCount: roundInfo.voteCount,
                isExecuted: roundInfo.isExecuted,
                isVetoed: false,
            };
            const shouldComputeDetails = (hasQuorum && (status === 'quorum-reached' || status === 'in-veto-window' || status === 'executable')) ||
                status === 'executed';
            if (!shouldComputeDetails) {
                // Always include the current voting round (needed by SlashingTimeline)
                const isCurrentVotingRound = round === currentRound;
                if (isCurrentVotingRound) {
                    simpleRounds.push(detected);
                    continue;
                }

                // For other rounds, only include if they have votes
                // This excludes future target rounds that haven't been voted on yet
                if (roundInfo.voteCount > 0n) {
                    simpleRounds.push(detected);
                }
                continue;
            }
            const cachedDetails = this.getCachedDetails(round, roundInfo.voteCount);
            if (cachedDetails) {
                const executableSlot = this.calculateExecutableSlot(round);
                const expirySlot = this.calculateExpirySlot(round);
                const secondsUntilExecutable = this.calculateSecondsUntilSlot(executableSlot, currentSlot);
                const secondsUntilExpires = this.calculateSecondsUntilSlot(expirySlot, currentSlot);
                const totalSlashAmount = cachedDetails.slashActions.reduce((sum, action) => sum + action.slashAmount, 0n);
                const targetEpochs = this.getTargetEpochs(round);
                roundsWithDetails.set(round, {
                    ...detected,
                    committees: cachedDetails.committees,
                    slashActions: cachedDetails.slashActions,
                    payloadAddress: cachedDetails.payloadAddress,
                    isVetoed: cachedDetails.isVetoed,
                    slotWhenExecutable: executableSlot,
                    slotWhenExpires: expirySlot,
                    secondsUntilExecutable,
                    secondsUntilExpires,
                    lastUpdatedTimestamp: Date.now(),
                    targetEpochs,
                    totalSlashAmount,
                    affectedValidatorCount: cachedDetails.slashActions.length,
                });
            }
            else {
                roundsNeedingDetails.push({ round, roundInfo, status, hasQuorum });
            }
        }
        if (roundsNeedingDetails.length > 0) {
            console.log(`[Detection] Batch fetching details for ${roundsNeedingDetails.length} rounds (uncached)`);
            try {
                const allCommittees = await this.l1Monitor.batchGetSlashTargetCommittees(roundsNeedingDetails.map(r => r.round));
                const roundsWithCommittees = roundsNeedingDetails.map((r, i) => ({
                    round: r.round,
                    committees: allCommittees[i],
                }));
                const allTallies = await this.l1Monitor.batchGetTally(roundsWithCommittees);
                const roundsWithActions = roundsNeedingDetails
                    .map((r, i) => ({
                    roundData: r,
                    committees: allCommittees[i],
                    slashActions: allTallies[i],
                    index: i,
                }))
                    .filter(item => item.slashActions.length > 0);
                if (roundsWithActions.length === 0) {
                    console.log('[Detection] No rounds with slash actions found');
                }
                else {
                    const payloadAndVetoResults = await this.l1Monitor.batchGetPayloadAddressesAndVetoStatus(roundsWithActions.map(item => ({
                        round: item.roundData.round,
                        actions: item.slashActions,
                    })));
                    roundsWithActions.forEach((item, resultIndex) => {
                        const { roundData, committees, slashActions } = item;
                        const { round, roundInfo, status } = roundData;
                        const { payloadAddress, isVetoed } = payloadAndVetoResults[resultIndex];
                        this.detailsCache.set(round, {
                            voteCount: roundInfo.voteCount,
                            committees,
                            slashActions,
                            payloadAddress,
                            isVetoed,
                            isExecuted: roundInfo.isExecuted,
                        }, this.mutableTTL);
                        const executableSlot = this.calculateExecutableSlot(round);
                        const expirySlot = this.calculateExpirySlot(round);
                        const secondsUntilExecutable = this.calculateSecondsUntilSlot(executableSlot, currentSlot);
                        const secondsUntilExpires = this.calculateSecondsUntilSlot(expirySlot, currentSlot);
                        const totalSlashAmount = slashActions.reduce((sum, action) => sum + action.slashAmount, 0n);
                        const targetEpochs = this.getTargetEpochs(round);
                        roundsWithDetails.set(round, {
                            round,
                            status,
                            voteCount: roundInfo.voteCount,
                            isExecuted: roundInfo.isExecuted,
                            isVetoed,
                            committees,
                            slashActions,
                            payloadAddress,
                            slotWhenExecutable: executableSlot,
                            slotWhenExpires: expirySlot,
                            secondsUntilExecutable,
                            secondsUntilExpires,
                            lastUpdatedTimestamp: Date.now(),
                            targetEpochs,
                            totalSlashAmount,
                            affectedValidatorCount: slashActions.length,
                        });
                    });
                    console.log(`[Detection] Successfully processed ${roundsWithActions.length} rounds with details`);
                }
            }
            catch (error) {
                console.error('Error batch fetching details:', error);
            }
        }
        const validDetections = [
            ...simpleRounds,
            ...Array.from(roundsWithDetails.values()),
        ];

        return validDetections.sort((a, b) => Number(b.round - a.round));
    }
}
