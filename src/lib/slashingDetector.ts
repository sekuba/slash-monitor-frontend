import type { Address } from 'viem';
import { L1Monitor } from './l1Monitor';
import { ImmutableAwareCache } from './immutableCache';
import type { DetectedSlashing, RoundStatus, SlashingMonitorConfig, SlashAction, RoundInfo, } from '@/types/slashing';
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
        this.detailsCache = new ImmutableAwareCache<bigint, DetailedRoundCache>((round) => round.toString(), (details) => details.isExecuted, { maxMutableSize: 50 });
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
    calculateRoundStatus(round: bigint, currentRound: bigint, currentSlot: bigint, isExecuted: boolean, hasQuorum: boolean): RoundStatus {
        if (isExecuted) {
            return 'executed';
        }
        const roundsSinceEnd = currentRound - round;
        const executionDelay = BigInt(this.config.executionDelayInRounds);
        const lifetime = BigInt(this.config.lifetimeInRounds);
        const roundSize = BigInt(this.config.slashingRoundSize);
        const roundEndSlot = (round + 1n) * roundSize - 1n;
        const executableSlot = this.calculateExecutableSlot(round);
        if (roundsSinceEnd > lifetime) {
            return 'expired';
        }
        if (roundsSinceEnd > executionDelay && roundsSinceEnd <= lifetime) {
            if (currentSlot >= executableSlot) {
                return 'executable';
            }
            return hasQuorum ? 'quorum-reached' : 'voting';
        }
        if (roundsSinceEnd === executionDelay) {
            if (currentSlot >= executableSlot) {
                return 'in-veto-window';
            }
            return hasQuorum ? 'quorum-reached' : 'voting';
        }
        if (roundsSinceEnd < executionDelay) {
            if (currentSlot <= roundEndSlot) {
                return hasQuorum ? 'quorum-reached' : 'voting';
            }
            return hasQuorum ? 'quorum-reached' : 'voting';
        }
        return 'voting';
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
    getTargetEpochs(round: bigint): bigint[] {
        const roundSizeInEpochs = BigInt(this.config.slashingRoundSizeInEpochs);
        const slashOffset = BigInt(this.config.slashOffsetInRounds);
        const targetRound = round - slashOffset;
        const startEpoch = targetRound * roundSizeInEpochs;
        const epochs: bigint[] = [];
        for (let i = 0n; i < roundSizeInEpochs; i++) {
            epochs.push(startEpoch + i);
        }
        return epochs;
    }
    async detectRound(round: bigint, currentRound: bigint, currentSlot: bigint): Promise<DetectedSlashing | null> {
        try {
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
        const slashingPeriodSize = executionDelay + lifetime + 1n;
        console.log(`[Detection] Scanning rounds: current=${currentRound}, period size=${slashingPeriodSize}`);
        const roundsToCheck: bigint[] = [];
        const earlyWarningStart = currentRound - executionDelay + 1n;
        const earlyWarningEnd = currentRound;
        for (let round = earlyWarningStart; round <= earlyWarningEnd; round++) {
            if (round >= 0n) {
                roundsToCheck.push(round);
            }
        }
        const executableStart = currentRound - lifetime;
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
                if (roundInfo.voteCount > 0n) {
                    const slashOffset = BigInt(this.config.slashOffsetInRounds);
                    const votingRoundForThisRound = round + slashOffset;
                    const isVotingWindowStillOpen = currentRound <= votingRoundForThisRound;
                    if (isVotingWindowStillOpen) {
                        simpleRounds.push(detected);
                    }
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
                    const payloadAndVetoResults = await this.l1Monitor.batchGetPayloadAddressesAndVetoStatusOptimized(roundsWithActions.map(item => ({
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
