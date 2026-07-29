import {
    createPublicClient,
    decodeEventLog,
    parseAbiItem,
    zeroAddress,
    type Address,
    type PublicClient,
} from 'viem';
import type {
    ConfirmedSlash,
    CurrentChainState,
    DetectedSlashing,
    RoundInfo,
    RuntimeMonitorConfig,
    SlashAction,
    SlashingContractParameters,
} from '@/types/slashing';
import { slashingProposerAbi } from './contracts/slashingProposerAbi';
import { rollupAbi } from './contracts/rollupAbi';
import { slasherAbi } from './contracts/slasherAbi';
import { escapeHatchAbi } from './contracts/escapeHatchAbi';
import { assertFreshL1Head, deploymentsMatch, resolveDeploymentWithClient } from './deployment';
import { createCall, multicall, type MulticallResult } from './multicall';
import { createPublicRpcTransport } from './rpc';

const roundExecutedEvent = parseAbiItem(
    'event RoundExecuted(uint256 indexed round, uint256 slashCount)',
);

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

    async hasDeploymentChanged(): Promise<boolean> {
        this.snapshotBlockNumber = undefined;
        this.snapshotTimestamp = undefined;
        const currentDeployment = await resolveDeploymentWithClient(
            this.publicClient,
            this.config.registryAddress,
            this.config.chainId
        );
        this.snapshotBlockNumber = currentDeployment.deploymentBlockNumber;
        this.snapshotTimestamp = currentDeployment.deploymentTimestamp;
        return !deploymentsMatch(this.config, currentDeployment);
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
        const pinnedBlock = await this.publicClient.getBlock({ blockNumber });
        if (!pinnedBlock.hash) throw new Error(`L1 block ${blockNumber} has no hash`);
        timestamp = pinnedBlock.timestamp;
        this.snapshotTimestamp = timestamp;
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

        return {
            l1BlockNumber: blockNumber,
            l1BlockHash: pinnedBlock.hash,
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

    async getVotes(round: bigint, ballotCount: bigint): Promise<string[]> {
        if (ballotCount > 1_024n) {
            throw new Error(`Round ${round} has an implausible ballot count`);
        }
        const calls = Array.from({ length: Number(ballotCount) }, (_, index) =>
            createCall(
                this.config.slashingProposerAddress,
                slashingProposerAbi,
                'getVotes',
                [round, BigInt(index)],
            ));
        const results = await multicall(this.publicClient, calls, this.snapshotBlockNumber);
        return results.map((result, index) =>
            requireResult<string>(result, `getVotes(${round}, ${index})`));
    }

    async getEscapeHatchFlags(targetEpochs: bigint[]): Promise<boolean[]> {
        const hatchResults = await multicall(
            this.publicClient,
            targetEpochs.map((epoch) =>
                createCall(
                    this.config.rollupAddress,
                    rollupAbi,
                    'getEscapeHatchForEpoch',
                    [epoch],
                )),
            this.snapshotBlockNumber,
        );
        const hatches = hatchResults.map((result, index) =>
            requireResult<Address>(result, `getEscapeHatchForEpoch(${targetEpochs[index]})`));
        const openCalls = hatches.flatMap((hatch, index) =>
            hatch === zeroAddress
                ? []
                : [{
                    index,
                    call: createCall(hatch, escapeHatchAbi, 'isHatchOpen', [targetEpochs[index]]),
                }]);
        const openResults = await multicall(
            this.publicClient,
            openCalls.map((item) => item.call),
            this.snapshotBlockNumber,
        );
        const flags = hatches.map(() => false);
        openResults.forEach((result, resultIndex) => {
            const [isOpen] = requireResult<readonly [boolean, Address]>(
                result,
                `isHatchOpen(${targetEpochs[openCalls[resultIndex].index]})`,
            );
            flags[openCalls[resultIndex].index] = isOpen;
        });
        return flags;
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

    async getConfirmedSlashes(
        detected: readonly DetectedSlashing[],
        lookbackBlocks: bigint,
    ): Promise<ConfirmedSlash[]> {
        const executed = detected.filter((item) =>
            item.isExecuted && (item.targetDetails?.length ?? 0) > 0);
        if (executed.length === 0 || this.snapshotBlockNumber === undefined) return [];
        const toBlock = this.snapshotBlockNumber;
        const fromBlock = toBlock > lookbackBlocks
            ? maxBigInt(this.config.deploymentBlockNumber, toBlock - lookbackBlocks)
            : this.config.deploymentBlockNumber;
        const confirmed: ConfirmedSlash[] = [];

        for (const item of executed) {
            const executionLogs = await this.getRoundExecutionLogs(
                item.round,
                fromBlock,
                toBlock,
            );
            const seenTransactions = new Set<string>();
            for (const executionLog of executionLogs) {
                const transactionHash = executionLog.transactionHash;
                if (
                    !transactionHash ||
                    executionLog.blockNumber === null ||
                    executionLog.blockHash === null ||
                    seenTransactions.has(transactionHash)
                ) continue;
                seenTransactions.add(transactionHash);
                const receipt = await this.publicClient.getTransactionReceipt({
                    hash: transactionHash,
                });
                const slashLogs = decodeExactReceiptSlashes(
                    item,
                    receipt.logs,
                    this.config.rollupAddress,
                );
                slashLogs.forEach((slash) => {
                    confirmed.push({
                        sequencer: slash.sequencer,
                        targetEpoch: slash.targetEpoch,
                        round: item.round,
                        amount: slash.amount,
                        actionIndex: slash.actionIndex,
                        transactionHash,
                        blockNumber: executionLog.blockNumber,
                        blockHash: executionLog.blockHash,
                        ejected: false,
                        attesterStatus: 0,
                    });
                });
            }
        }

        const statusResults = await multicall(
            this.publicClient,
            confirmed.map((slash) =>
                createCall(
                    this.config.rollupAddress,
                    rollupAbi,
                    'getStatus',
                    [slash.sequencer],
                )),
            toBlock,
        );
        return confirmed.map((slash, index) => {
            const status = Number(requireResult(statusResults[index], 'getStatus'));
            return {
                ...slash,
                attesterStatus: status,
                ejected: status === 2 || status === 3,
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
            quorum: Number(requireResult(results[0], 'QUORUM')),
            slashingRoundSize: Number(requireResult(results[1], 'ROUND_SIZE')),
            slashingRoundSizeInEpochs: Number(requireResult(results[2], 'ROUND_SIZE_IN_EPOCHS')),
            executionDelayInRounds: Number(requireResult(results[3], 'EXECUTION_DELAY_IN_ROUNDS')),
            lifetimeInRounds: Number(requireResult(results[4], 'LIFETIME_IN_ROUNDS')),
            slashOffsetInRounds: Number(requireResult(results[5], 'SLASH_OFFSET_IN_ROUNDS')),
            committeeSize: Number(requireResult(results[6], 'COMMITTEE_SIZE')),
            slotDuration: Number(requireResult(results[7], 'getSlotDuration')),
            epochDuration: Number(requireResult(results[8], 'getEpochDuration')),
            l1GenesisTime: requireResult(results[9], 'getGenesisTime'),
        };
    }

    private async getRoundExecutionLogs(
        round: bigint,
        fromBlock: bigint,
        toBlock: bigint,
    ) {
        const result = [];
        const chunkSize = 5_000n;
        for (let start = fromBlock; start <= toBlock; start += chunkSize) {
            const end = start + chunkSize - 1n > toBlock
                ? toBlock
                : start + chunkSize - 1n;
            result.push(...await this.publicClient.getLogs({
                address: this.config.slashingProposerAddress,
                event: roundExecutedEvent,
                args: { round },
                fromBlock: start,
                toBlock: end,
            }));
        }
        return result;
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

function maxBigInt(left: bigint, right: bigint): bigint {
    return left > right ? left : right;
}

export function decodeExactReceiptSlashes(
    item: DetectedSlashing,
    logs: readonly {
        address: Address;
        data: `0x${string}`;
        topics: [] | [`0x${string}`, ...`0x${string}`[]];
    }[],
    rollupAddress: Address,
): Array<{
    sequencer: Address;
    amount: bigint;
    actionIndex: number;
    targetEpoch: bigint;
}> {
    const slashLogs = logs.flatMap((log) => {
        if (log.address.toLowerCase() !== rollupAddress.toLowerCase()) return [];
        try {
            const decoded = decodeEventLog({
                abi: rollupAbi,
                eventName: 'Slashed',
                data: log.data,
                topics: log.topics,
                strict: true,
            });
            return [{
                sequencer: decoded.args.attester,
                amount: decoded.args.amount,
            }];
        }
        catch {
            return [];
        }
    });
    return slashLogs.map((slash, actionIndex) => {
        const target = item.targetDetails?.find(
            (detail) => detail.actionIndex === actionIndex,
        ) ?? item.targetDetails?.[actionIndex];
        if (
            !target ||
            target.sequencer.toLowerCase() !== slash.sequencer.toLowerCase()
        ) {
            throw new Error(
                `Round ${item.round} receipt does not match its exact action order`,
            );
        }
        return {
            ...slash,
            actionIndex,
            targetEpoch: target.targetEpoch,
        };
    });
}
