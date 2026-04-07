import { createPublicClient, type Address, type PublicClient } from 'viem';
import type { CurrentChainState, MonitorConfigInput, RoundInfo, SlashAction, SlashingContractParameters } from '@/types/slashing';
import { tallySlashingProposerAbi } from './contracts/tallySlashingProposerAbi';
import { rollupAbi } from './contracts/rollupAbi';
import { slasherAbi } from './contracts/slasherAbi';
import { ImmutableAwareCache } from './immutableCache';
import { createCall, multicall, type MulticallResult } from './multicall';
import { createPublicRpcTransport } from './rpc';

const MAX_ROUND_CACHE_SIZE = 100;

export class L1Monitor {
    private readonly publicClient: PublicClient;
    private readonly config: MonitorConfigInput;
    private readonly roundCache: ImmutableAwareCache<bigint, RoundInfo>;
    private readonly mutableTTL: number;

    constructor(config: MonitorConfigInput) {
        this.config = config;
        this.mutableTTL = config.l1RoundCacheTTL;
        this.roundCache = new ImmutableAwareCache(
            (round) => round.toString(),
            (roundInfo) => roundInfo.isExecuted,
            { maxMutableSize: MAX_ROUND_CACHE_SIZE }
        );
        this.publicClient = createPublicClient({
            transport: createPublicRpcTransport(config.l1RpcUrl),
        });
    }

    getCacheStats() {
        return this.roundCache.getStats();
    }

    logCacheStats() {
        console.log(`[L1Monitor] ${this.roundCache.getStatsString()}`);
    }

    async getCurrentState(): Promise<CurrentChainState> {
        const results = await multicall(this.publicClient, [
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getCurrentRound'),
            createCall(this.config.rollupAddress, rollupAbi, 'getCurrentSlot'),
            createCall(this.config.rollupAddress, rollupAbi, 'getCurrentEpoch'),
            createCall(this.config.slasherAddress, slasherAbi, 'isSlashingEnabled'),
            createCall(this.config.slasherAddress, slasherAbi, 'slashingDisabledUntil'),
            createCall(this.config.slasherAddress, slasherAbi, 'SLASHING_DISABLE_DURATION'),
            createCall(this.config.rollupAddress, rollupAbi, 'getActiveAttesterCount'),
            createCall(this.config.rollupAddress, rollupAbi, 'getEntryQueueLength'),
        ]);

        return {
            currentRound: requireResult(results[0], 'getCurrentRound'),
            currentSlot: requireResult(results[1], 'getCurrentSlot'),
            currentEpoch: requireResult(results[2], 'getCurrentEpoch'),
            isSlashingEnabled: requireResult(results[3], 'isSlashingEnabled'),
            slashingDisabledUntil: requireResult(results[4], 'slashingDisabledUntil'),
            slashingDisableDuration: requireResult(results[5], 'SLASHING_DISABLE_DURATION'),
            activeAttesterCount: requireResult(results[6], 'getActiveAttesterCount'),
            entryQueueLength: requireResult(results[7], 'getEntryQueueLength'),
        };
    }

    async getRounds(rounds: bigint[]): Promise<Map<bigint, MulticallResult<RoundInfo>>> {
        const results = new Map<bigint, MulticallResult<RoundInfo>>();
        const roundsToFetch: bigint[] = [];

        for (const round of rounds) {
            const cached = this.roundCache.get(round);
            if (cached) {
                results.set(round, { success: true, data: cached });
                continue;
            }

            roundsToFetch.push(round);
        }

        if (roundsToFetch.length === 0) {
            return results;
        }

        const fetchedResults = await multicall(
            this.publicClient,
            roundsToFetch.map((round) =>
                createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getRound', [round])
            )
        );

        fetchedResults.forEach((result, index) => {
            const round = roundsToFetch[index];

            if (!result.success) {
                results.set(round, result);
                return;
            }

            const [isExecuted, voteCount] = result.data as [boolean, bigint];
            const roundInfo: RoundInfo = {
                round,
                isExecuted,
                voteCount,
            };

            this.roundCache.set(round, roundInfo, this.mutableTTL);
            results.set(round, { success: true, data: roundInfo });
        });

        return results;
    }

    async batchGetSlashTargetCommittees(rounds: bigint[]): Promise<MulticallResult<Address[][]>[]> {
        if (rounds.length === 0) {
            return [];
        }

        const results = await multicall(
            this.publicClient,
            rounds.map((round) =>
                createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getSlashTargetCommittees', [round])
            )
        );

        return results.map((result) => {
            if (!result.success) {
                return result;
            }

            return {
                success: true,
                data: result.data as Address[][],
            };
        });
    }

    async batchGetTally(roundsWithCommittees: Array<{ round: bigint; committees: Address[][] }>): Promise<MulticallResult<SlashAction[]>[]> {
        if (roundsWithCommittees.length === 0) {
            return [];
        }

        const results = await multicall(
            this.publicClient,
            roundsWithCommittees.map(({ round, committees }) =>
                createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getTally', [round, committees])
            )
        );

        return results.map((result) => {
            if (!result.success) {
                return result;
            }

            return {
                success: true,
                data: mapSlashActions(result.data as any[]),
            };
        });
    }

    async batchGetPayloadAddressesAndVetoStatus(roundsWithActions: Array<{ round: bigint; actions: SlashAction[] }>): Promise<MulticallResult<{
        payloadAddress: Address;
        isVetoed: boolean;
    }>[]> {
        if (roundsWithActions.length === 0) {
            return [];
        }

        const payloadResults = await multicall(
            this.publicClient,
            roundsWithActions.map(({ round, actions }) =>
                createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getPayloadAddress', [round, actions])
            )
        );

        const vetoInputs: Address[] = [];
        const vetoResultIndexByRound = new Map<number, number>();

        payloadResults.forEach((result, index) => {
            if (!result.success) {
                return;
            }

            vetoResultIndexByRound.set(index, vetoInputs.length);
            vetoInputs.push(result.data as Address);
        });

        const vetoResults = vetoInputs.length === 0
            ? []
            : await multicall(
                this.publicClient,
                vetoInputs.map((address) =>
                    createCall(this.config.slasherAddress, slasherAbi, 'vetoedPayloads', [address])
                )
            );

        return payloadResults.map((payloadResult, index) => {
            if (!payloadResult.success) {
                return payloadResult;
            }

            const vetoResult = vetoResults[vetoResultIndexByRound.get(index) ?? -1];
            if (!vetoResult || !vetoResult.success) {
                return {
                    success: false,
                    error: vetoResult?.error ?? new Error(`Missing veto status for round ${roundsWithActions[index].round}`),
                };
            }

            return {
                success: true,
                data: {
                    payloadAddress: payloadResult.data as Address,
                    isVetoed: vetoResult.data as boolean,
                },
            };
        });
    }

    async loadContractParameters(): Promise<SlashingContractParameters> {
        const results = await multicall(this.publicClient, [
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'QUORUM'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'ROUND_SIZE'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'ROUND_SIZE_IN_EPOCHS'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'EXECUTION_DELAY_IN_ROUNDS'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'LIFETIME_IN_ROUNDS'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'SLASH_OFFSET_IN_ROUNDS'),
            createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'COMMITTEE_SIZE'),
            createCall(this.config.rollupAddress, rollupAbi, 'getSlotDuration'),
            createCall(this.config.rollupAddress, rollupAbi, 'getEpochDuration'),
        ]);

        return {
            quorum: Number(requireResult(results[0], 'QUORUM')),
            slashingRoundSize: Number(requireResult(results[1], 'ROUND_SIZE')),
            slashingRoundSizeInEpochs: Number(requireResult(results[2], 'ROUND_SIZE_IN_EPOCHS')),
            executionDelayInRounds: Number(requireResult(results[3], 'EXECUTION_DELAY_IN_ROUNDS')),
            lifetimeInRounds: Number(requireResult(results[4], 'LIFETIME_IN_ROUNDS')),
            slashOffsetInRounds: Number(requireResult(results[5], 'SLASH_OFFSET_IN_ROUNDS')),
            committeeSize: Number(requireResult(results[6], 'COMMITTEE_SIZE')),
            slotDuration: Number(requireResult(results[7], 'getSlotDuration')),
            epochDuration: Number(requireResult(results[8], 'getEpochDuration')),
        };
    }
}

function requireResult<T>(result: MulticallResult<T>, label: string): T {
    if (!result.success) {
        throw new Error(`${label} failed: ${result.error.message}`);
    }

    return result.data;
}

function mapSlashActions(actions: any[]): SlashAction[] {
    return actions.map((action) => ({
        validator: action.validator as Address,
        slashAmount: action.slashAmount as bigint,
    }));
}
