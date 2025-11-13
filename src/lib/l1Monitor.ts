import { createPublicClient, http, fallback, type Address, type PublicClient, } from 'viem';
import { tallySlashingProposerAbi } from './contracts/tallySlashingProposerAbi';
import { slasherAbi } from './contracts/slasherAbi';
import { rollupAbi } from './contracts/rollupAbi';
import { multicall, createCall } from './multicall';
import { ImmutableAwareCache } from './immutableCache';
import type { SlashAction, RoundInfo, SlashingMonitorConfig, } from '@/types/slashing';
export class L1Monitor {
    private publicClient: PublicClient;
    private config: SlashingMonitorConfig;
    private roundCache: ImmutableAwareCache<bigint, RoundInfo>;
    private mutableTTL: number;
    constructor(config: SlashingMonitorConfig) {
        this.config = config;
        this.mutableTTL = config.l1RoundCacheTTL;
        this.roundCache = new ImmutableAwareCache<bigint, RoundInfo>((round) => round.toString(), (roundInfo) => roundInfo.isExecuted, { maxMutableSize: 100 });
        const transport = Array.isArray(config.l1RpcUrl)
            ? fallback(config.l1RpcUrl.map(url => http(url)))
            : http(config.l1RpcUrl);
        this.publicClient = createPublicClient({
            transport,
        });
    }
    clearCache(round?: bigint) {
        if (round !== undefined) {
            this.roundCache.delete(round);
        }
        else {
            this.roundCache.clear();
        }
    }
    getCacheStats() {
        return this.roundCache.getStats();
    }
    logCacheStats() {
        console.log(`[L1Monitor] ${this.roundCache.getStatsString()}`);
    }
    async getCurrentRound(): Promise<bigint> {
        const round = await this.publicClient.readContract({
            address: this.config.tallySlashingProposerAddress,
            abi: tallySlashingProposerAbi,
            functionName: 'getCurrentRound',
        });
        return round as bigint;
    }
    async getCurrentSlot(): Promise<bigint> {
        const slot = await this.publicClient.readContract({
            address: this.config.rollupAddress,
            abi: rollupAbi,
            functionName: 'getCurrentSlot',
        });
        return slot as bigint;
    }
    async getCurrentEpoch(): Promise<bigint> {
        const epoch = await this.publicClient.readContract({
            address: this.config.rollupAddress,
            abi: rollupAbi,
            functionName: 'getCurrentEpoch',
        });
        return epoch as bigint;
    }
    async getCurrentState(): Promise<{
        currentRound: bigint;
        currentSlot: bigint;
        currentEpoch: bigint;
        isSlashingEnabled: boolean;
        slashingDisabledUntil: bigint;
        slashingDisableDuration: bigint;
        activeAttesterCount: bigint;
        entryQueueLength: bigint;
    }> {
        const calls = [
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getCurrentRound'),
            createCall(this.config.rollupAddress, rollupAbi, 'getCurrentSlot'),
            createCall(this.config.rollupAddress, rollupAbi, 'getCurrentEpoch'),
            createCall(this.config.slasherAddress, slasherAbi, 'isSlashingEnabled'),
            createCall(this.config.slasherAddress, slasherAbi, 'slashingDisabledUntil'),
            createCall(this.config.slasherAddress, slasherAbi, 'SLASHING_DISABLE_DURATION'),
            createCall(this.config.rollupAddress, rollupAbi, 'getActiveAttesterCount'),
            createCall(this.config.rollupAddress, rollupAbi, 'getEntryQueueLength'),
        ];
        const results = await multicall(this.publicClient, calls);
        return {
            currentRound: results[0].data as bigint,
            currentSlot: results[1].data as bigint,
            currentEpoch: results[2].data as bigint,
            isSlashingEnabled: results[3].data as boolean,
            slashingDisabledUntil: results[4].data as bigint,
            slashingDisableDuration: results[5].data as bigint,
            activeAttesterCount: results[6].data as bigint,
            entryQueueLength: results[7].data as bigint,
        };
    }
    async getRound(round: bigint, skipCache = false): Promise<RoundInfo> {
        if (!skipCache) {
            const cached = this.roundCache.get(round);
            if (cached) {
                return cached;
            }
        }
        const result = await this.publicClient.readContract({
            address: this.config.tallySlashingProposerAddress,
            abi: tallySlashingProposerAbi,
            functionName: 'getRound',
            args: [round],
        });
        const [isExecuted, , voteCount] = result as [
            boolean,
            boolean,
            bigint
        ];
        const roundInfo = {
            round,
            isExecuted: isExecuted as boolean,
            voteCount: voteCount as bigint,
        };
        this.roundCache.set(round, roundInfo, this.mutableTTL);
        return roundInfo;
    }
    async getRounds(rounds: bigint[]): Promise<Map<bigint, RoundInfo>> {
        const roundsToFetch: bigint[] = [];
        const cachedRounds = new Map<bigint, RoundInfo>();
        for (const round of rounds) {
            const cached = this.roundCache.get(round);
            if (cached) {
                cachedRounds.set(round, cached);
            }
            else {
                roundsToFetch.push(round);
            }
        }
        if (roundsToFetch.length === 0) {
            return cachedRounds;
        }
        const calls = roundsToFetch.map((round) => createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getRound', [round]));
        const results = await multicall(this.publicClient, calls);
        const allRounds = new Map(cachedRounds);
        results.forEach((result, i) => {
            if (result.success && result.data) {
                const round = roundsToFetch[i];
                const [isExecuted, , voteCount] = result.data as [
                    boolean,
                    boolean,
                    bigint
                ];
                const roundInfo: RoundInfo = {
                    round,
                    isExecuted,
                    voteCount,
                };
                this.roundCache.set(round, roundInfo, this.mutableTTL);
                allRounds.set(round, roundInfo);
            }
        });
        return allRounds;
    }
    async isRoundReadyToExecute(round: bigint, slot?: bigint): Promise<boolean> {
        const currentSlot = slot ?? (await this.getCurrentSlot());
        const ready = await this.publicClient.readContract({
            address: this.config.tallySlashingProposerAddress,
            abi: tallySlashingProposerAbi,
            functionName: 'isRoundReadyToExecute',
            args: [round, currentSlot],
        });
        return ready as boolean;
    }
    async getSlashTargetCommittees(round: bigint): Promise<Address[][]> {
        const committees = await this.publicClient.readContract({
            address: this.config.tallySlashingProposerAddress,
            abi: tallySlashingProposerAbi,
            functionName: 'getSlashTargetCommittees',
            args: [round],
        });
        return committees as Address[][];
    }
    async batchGetSlashTargetCommittees(rounds: bigint[]): Promise<Address[][][]> {
        if (rounds.length === 0)
            return [];
        const calls = rounds.map((round) => createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getSlashTargetCommittees', [round]));
        const results = await multicall(this.publicClient, calls);
        return results.map((result) => {
            if (result.success && result.data) {
                return result.data as Address[][];
            }
            return [];
        });
    }
    async getTally(round: bigint, committees: Address[][]): Promise<SlashAction[]> {
        const actions = await this.publicClient.readContract({
            address: this.config.tallySlashingProposerAddress,
            abi: tallySlashingProposerAbi,
            functionName: 'getTally',
            args: [round, committees],
        });
        return (actions as any[]).map((action) => ({
            validator: action.validator as Address,
            slashAmount: action.slashAmount as bigint,
        }));
    }
    async batchGetTally(roundsWithCommittees: Array<{
        round: bigint;
        committees: Address[][];
    }>): Promise<SlashAction[][]> {
        if (roundsWithCommittees.length === 0)
            return [];
        const calls = roundsWithCommittees.map(({ round, committees }) => createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getTally', [round, committees]));
        const results = await multicall(this.publicClient, calls);
        return results.map((result) => {
            if (result.success && result.data) {
                return (result.data as any[]).map((action) => ({
                    validator: action.validator as Address,
                    slashAmount: action.slashAmount as bigint,
                }));
            }
            return [];
        });
    }
    async getPayloadAddress(round: bigint, actions: SlashAction[]): Promise<Address> {
        if (actions.length === 0) {
            return '0x0000000000000000000000000000000000000000';
        }
        const address = await this.publicClient.readContract({
            address: this.config.tallySlashingProposerAddress,
            abi: tallySlashingProposerAbi,
            functionName: 'getPayloadAddress',
            args: [round, actions as readonly {
                    validator: Address;
                    slashAmount: bigint;
                }[]],
        });
        return address as Address;
    }
    async batchGetPayloadAddress(roundsWithActions: Array<{
        round: bigint;
        actions: SlashAction[];
    }>): Promise<Address[]> {
        if (roundsWithActions.length === 0)
            return [];
        const calls = roundsWithActions.map(({ round, actions }) => {
            if (actions.length === 0) {
                return null;
            }
            return createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getPayloadAddress', [round, actions as readonly {
                    validator: Address;
                    slashAmount: bigint;
                }[]]);
        });
        const validCalls: ReturnType<typeof createCall>[] = [];
        const validIndices: number[] = [];
        calls.forEach((call, i) => {
            if (call) {
                validCalls.push(call);
                validIndices.push(i);
            }
        });
        const results = validCalls.length > 0 ? await multicall(this.publicClient, validCalls) : [];
        const addresses: Address[] = new Array(roundsWithActions.length).fill('0x0000000000000000000000000000000000000000');
        results.forEach((result, i) => {
            const originalIndex = validIndices[i];
            if (result.success && result.data) {
                addresses[originalIndex] = result.data as Address;
            }
        });
        return addresses;
    }
    async isPayloadVetoed(payloadAddress: Address): Promise<boolean> {
        const vetoed = await this.publicClient.readContract({
            address: this.config.slasherAddress,
            abi: slasherAbi,
            functionName: 'vetoedPayloads',
            args: [payloadAddress],
        });
        return vetoed as boolean;
    }
    async batchIsPayloadVetoed(payloadAddresses: Address[]): Promise<boolean[]> {
        if (payloadAddresses.length === 0)
            return [];
        const calls = payloadAddresses.map((address) => createCall(this.config.slasherAddress, slasherAbi, 'vetoedPayloads', [address]));
        const results = await multicall(this.publicClient, calls);
        return results.map((result) => {
            if (result.success && result.data !== undefined) {
                return result.data as boolean;
            }
            return false;
        });
    }
    async batchGetPayloadAddressesAndVetoStatus(roundsWithActions: Array<{
        round: bigint;
        actions: SlashAction[];
    }>): Promise<Array<{
        payloadAddress: Address;
        isVetoed: boolean;
    }>> {
        if (roundsWithActions.length === 0)
            return [];
        const calls: ReturnType<typeof createCall>[] = [];
        const payloadIndices: number[] = [];
        roundsWithActions.forEach((item, i) => {
            if (item.actions.length === 0) {
                calls.push(null as any);
            }
            else {
                payloadIndices.push(i);
                calls.push(createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getPayloadAddress', [item.round, item.actions as readonly {
                        validator: Address;
                        slashAmount: bigint;
                    }[]]));
            }
        });
        const validPayloadCalls = calls.filter(call => call !== null);
        const payloadResults = validPayloadCalls.length > 0
            ? await multicall(this.publicClient, validPayloadCalls)
            : [];
        const payloadAddresses: Address[] = new Array(roundsWithActions.length).fill('0x0000000000000000000000000000000000000000');
        payloadResults.forEach((result, i) => {
            const originalIndex = payloadIndices[i];
            if (result.success && result.data) {
                payloadAddresses[originalIndex] = result.data as Address;
            }
        });
        const vetoStatusCalls = payloadAddresses.map((address) => createCall(this.config.slasherAddress, slasherAbi, 'vetoedPayloads', [address]));
        const vetoResults = await multicall(this.publicClient, vetoStatusCalls);
        return roundsWithActions.map((_, i) => ({
            payloadAddress: payloadAddresses[i],
            isVetoed: vetoResults[i].success && vetoResults[i].data !== undefined
                ? (vetoResults[i].data as boolean)
                : false
        }));
    }
    async batchGetPayloadAddressesAndVetoStatusOptimized(roundsWithActions: Array<{
        round: bigint;
        actions: SlashAction[];
    }>): Promise<Array<{
        payloadAddress: Address;
        isVetoed: boolean;
    }>> {
        if (roundsWithActions.length === 0)
            return [];
        const allCalls: ReturnType<typeof createCall>[] = [];
        const payloadCallIndices: number[] = [];
        roundsWithActions.forEach((item, i) => {
            if (item.actions.length > 0) {
                payloadCallIndices.push(i);
                allCalls.push(createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getPayloadAddress', [item.round, item.actions as readonly {
                        validator: Address;
                        slashAmount: bigint;
                    }[]]));
            }
        });
        if (allCalls.length === 0) {
            return roundsWithActions.map(() => ({
                payloadAddress: '0x0000000000000000000000000000000000000000' as Address,
                isVetoed: false
            }));
        }
        const payloadResults = await multicall(this.publicClient, allCalls);
        const payloadAddresses: Address[] = new Array(roundsWithActions.length).fill('0x0000000000000000000000000000000000000000');
        payloadResults.forEach((result, i) => {
            const originalIndex = payloadCallIndices[i];
            if (result.success && result.data) {
                payloadAddresses[originalIndex] = result.data as Address;
            }
        });
        const vetoStatusCalls = payloadAddresses.map((address) => createCall(this.config.slasherAddress, slasherAbi, 'vetoedPayloads', [address]));
        const vetoResults = await multicall(this.publicClient, vetoStatusCalls);
        return roundsWithActions.map((_, i) => ({
            payloadAddress: payloadAddresses[i],
            isVetoed: vetoResults[i].success && vetoResults[i].data !== undefined
                ? (vetoResults[i].data as boolean)
                : false
        }));
    }
    async isSlashingEnabled(): Promise<boolean> {
        const enabled = await this.publicClient.readContract({
            address: this.config.slasherAddress,
            abi: slasherAbi,
            functionName: 'isSlashingEnabled',
        });
        return enabled as boolean;
    }
    async loadContractParameters(): Promise<Partial<SlashingMonitorConfig>> {
        const calls = [
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'QUORUM'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'ROUND_SIZE'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'ROUND_SIZE_IN_EPOCHS'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'EXECUTION_DELAY_IN_ROUNDS'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'LIFETIME_IN_ROUNDS'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'SLASH_OFFSET_IN_ROUNDS'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'COMMITTEE_SIZE'),
            createCall(this.config.rollupAddress, rollupAbi, 'getSlotDuration'),
            createCall(this.config.rollupAddress, rollupAbi, 'getEpochDuration'),
        ];
        const results = await multicall(this.publicClient, calls);
        return {
            quorum: Number(results[0].data),
            slashingRoundSize: Number(results[1].data),
            slashingRoundSizeInEpochs: Number(results[2].data),
            executionDelayInRounds: Number(results[3].data),
            lifetimeInRounds: Number(results[4].data),
            slashOffsetInRounds: Number(results[5].data),
            committeeSize: Number(results[6].data),
            slotDuration: Number(results[7].data),
            epochDuration: Number(results[8].data),
        };
    }
}
