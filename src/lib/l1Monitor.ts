import { createPublicClient, type Address, type PublicClient } from 'viem';
import type { CurrentChainState, RoundInfo, RuntimeMonitorConfig, SlashAction, SlashingContractParameters } from '@/types/slashing';
import { slashingProposerAbi } from './contracts/slashingProposerAbi';
import { rollupAbi } from './contracts/rollupAbi';
import { slasherAbi } from './contracts/slasherAbi';
import { assertFreshL1Head } from './deployment';
import { createCall, multicall, type MulticallResult } from './multicall';
import { createPublicRpcTransport } from './rpc';

export class L1Monitor {
    private readonly publicClient: PublicClient;
    private readonly config: RuntimeMonitorConfig;
    private snapshotBlockNumber?: bigint;
    private snapshotTimestamp?: bigint;

    constructor(config: RuntimeMonitorConfig) {
        this.config = config;
        this.publicClient = createPublicClient({
            transport: createPublicRpcTransport(config.l1RpcUrl),
        });
        this.snapshotBlockNumber = config.deploymentBlockNumber;
        this.snapshotTimestamp = config.deploymentTimestamp;
    }

    async getCurrentState(): Promise<CurrentChainState> {
        let blockNumber = this.snapshotBlockNumber;
        let timestamp = this.snapshotTimestamp;
        if (blockNumber === undefined || timestamp === undefined) {
            const block = await this.publicClient.getBlock({ blockTag: 'latest' });
            blockNumber = block.number;
            timestamp = block.timestamp;
            this.snapshotBlockNumber = blockNumber;
            this.snapshotTimestamp = timestamp;
        }
        assertFreshL1Head(timestamp);
        const results = await multicall(this.publicClient, [
                createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'getCurrentRound'),
                createCall(this.config.rollupAddress, rollupAbi, 'getCurrentSlot'),
                createCall(this.config.rollupAddress, rollupAbi, 'getCurrentEpoch'),
                createCall(this.config.slasherAddress, slasherAbi, 'isSlashingEnabled'),
                createCall(this.config.slasherAddress, slasherAbi, 'slashingDisabledUntil'),
                createCall(this.config.slasherAddress, slasherAbi, 'SLASHING_DISABLE_DURATION'),
            ], blockNumber);

        const isSlashingEnabled = requireResult<boolean>(results[3], 'isSlashingEnabled');
        const slashingDisabledUntil = requireResult<bigint>(results[4], 'slashingDisabledUntil');
        const slashingDisableDuration = requireResult<bigint>(results[5], 'SLASHING_DISABLE_DURATION');
        let pauseStartedAtSlot: bigint | null = null;
        let pauseEndsAtSlot: bigint | null = null;

        if (!isSlashingEnabled && slashingDisabledUntil > 0n) {
            const pauseStartedAt = slashingDisabledUntil - slashingDisableDuration;
            const pauseSlots = await multicall(this.publicClient, [
                createCall(this.config.rollupAddress, rollupAbi, 'getSlotAt', [pauseStartedAt]),
                createCall(this.config.rollupAddress, rollupAbi, 'getSlotAt', [slashingDisabledUntil]),
            ], blockNumber);
            pauseStartedAtSlot = requireResult(pauseSlots[0], 'getSlotAt(pause start)');
            pauseEndsAtSlot = requireResult(pauseSlots[1], 'getSlotAt(pause end)');
        }
        const verifiedBlock = await this.publicClient.getBlock({ blockNumber });
        if (
            !verifiedBlock.hash ||
            verifiedBlock.hash.toLowerCase() !== this.config.deploymentBlockHash.toLowerCase()
        ) {
            throw new Error(`Confirmed L1 block ${blockNumber} changed during stack scan`);
        }

        return {
            l1BlockNumber: blockNumber,
            l1Timestamp: timestamp,
            currentRound: requireResult(results[0], 'getCurrentRound'),
            currentSlot: requireResult(results[1], 'getCurrentSlot'),
            currentEpoch: requireResult(results[2], 'getCurrentEpoch'),
            isSlashingEnabled,
            slashingDisabledUntil,
            slashingDisableDuration,
            pauseStartedAtSlot,
            pauseEndsAtSlot,
        };
    }

    async getRounds(rounds: bigint[]): Promise<Map<bigint, MulticallResult<RoundInfo>>> {
        const results = new Map<bigint, MulticallResult<RoundInfo>>();
        if (rounds.length === 0) {
            return results;
        }

        const fetchedResults = await multicall(
            this.publicClient,
            rounds.map((round) =>
                createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'getRound', [round])
            ),
            this.snapshotBlockNumber
        );

        fetchedResults.forEach((result, index) => {
            const round = rounds[index];

            if (!result.success) {
                results.set(round, result);
                return;
            }

            const [isExecuted, ballotCount] = result.data as [boolean, bigint];
            const roundInfo: RoundInfo = {
                round,
                isExecuted,
                ballotCount,
            };

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
                createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'getSlashTargetCommittees', [round])
            ),
            this.snapshotBlockNumber
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
                createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'getTally', [round, committees])
            ),
            this.snapshotBlockNumber
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
                createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'getPayloadAddress', [round, actions])
            ),
            this.snapshotBlockNumber
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
                ),
                this.snapshotBlockNumber
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
            createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'QUORUM'),
            createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'ROUND_SIZE'),
            createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'ROUND_SIZE_IN_EPOCHS'),
            createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'EXECUTION_DELAY_IN_ROUNDS'),
            createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'LIFETIME_IN_ROUNDS'),
            createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'SLASH_OFFSET_IN_ROUNDS'),
            createCall(this.config.slashingProposerAddress, slashingProposerAbi, 'COMMITTEE_SIZE'),
            createCall(this.config.rollupAddress, rollupAbi, 'getSlotDuration'),
            createCall(this.config.rollupAddress, rollupAbi, 'getEpochDuration'),
            createCall(this.config.rollupAddress, rollupAbi, 'getGenesisTime'),
        ], this.snapshotBlockNumber);

        return {
            l1GenesisTime: requireResult(results[9], 'getGenesisTime'),
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
