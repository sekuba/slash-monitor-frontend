import { describe, expect, it } from 'vitest';
import {
    encodeAbiParameters,
    encodeEventTopics,
    type Address,
    type PublicClient,
} from 'viem';
import {
    decodeExactReceiptSlashes,
    executionScanFromBlock,
    L1Monitor,
} from './l1Monitor';
import { rollupAbi } from './contracts/rollupAbi';
import type {
    DetectedSlashing,
    RuntimeMonitorConfig,
} from '@/types/slashing';

const rollup = '0x1111111111111111111111111111111111111111' as Address;
const sequencer = '0x2222222222222222222222222222222222222222' as Address;

describe('browser receipt slash correlation', () => {
    it('scans history before the block where the page resolved the deployment', () => {
        expect(executionScanFromBlock(25_639_222n, 9_608n)).toBe(25_629_614n);
    });

    it('does not scan below block zero', () => {
        expect(executionScanFromBlock(5_000n, 9_608n)).toBe(0n);
    });

    it('does not request history when no targeted round has executed', async () => {
        let calls = 0;
        const monitor = new L1Monitor(config(), {
            getLogs: async () => {
                calls += 1;
                return [];
            },
        } as unknown as PublicClient);

        const result = await monitor.scanExecutionHistory([], 3_000n);

        expect(result.scan.status).toBe('idle');
        expect(result.rpcCalls).toBe(0);
        expect(calls).toBe(0);
    });

    it('scans newest history first and grows successful RPC chunks', async () => {
        const ranges: Array<[bigint, bigint]> = [];
        const monitor = new L1Monitor(config(), {
            getLogs: async ({ fromBlock, toBlock }: {
                fromBlock: bigint;
                toBlock: bigint;
            }) => {
                ranges.push([fromBlock, toBlock]);
                return [];
            },
        } as unknown as PublicClient);

        const first = await monitor.scanExecutionHistory([round()], 3_000n);
        const second = await monitor.scanExecutionHistory([round()], 3_000n);

        expect(first.scan).toMatchObject({
            status: 'scanning',
            scannedBlocks: 1_024n,
            totalBlocks: 3_001n,
            chunkSize: 2_048n,
        });
        expect(second.scan).toMatchObject({
            status: 'complete',
            scannedBlocks: 3_001n,
        });
        expect(ranges).toEqual([
            [8_977n, 10_000n],
            [7_000n, 8_976n],
        ]);
    });

    it('checks new blocks with a reorg overlap before resuming older history', async () => {
        const ranges: Array<[bigint, bigint]> = [];
        const monitor = new L1Monitor(config(), {
            getLogs: async ({ fromBlock, toBlock }: {
                fromBlock: bigint;
                toBlock: bigint;
            }) => {
                ranges.push([fromBlock, toBlock]);
                return [];
            },
        } as unknown as PublicClient);

        await monitor.scanExecutionHistory([round()], 3_000n);
        (monitor as unknown as { snapshotBlockNumber: bigint })
            .snapshotBlockNumber = 10_010n;
        const result = await monitor.scanExecutionHistory([round()], 3_000n);

        expect(result.scan).toMatchObject({
            status: 'scanning',
            headBlock: 10_010n,
            oldestScannedBlock: 8_977n,
            scannedBlocks: 1_034n,
        });
        expect(ranges).toEqual([
            [8_977n, 10_000n],
            [9_988n, 10_010n],
        ]);
    });

    it('shrinks a rejected range and remembers the RPC capacity', async () => {
        const ranges: Array<[bigint, bigint]> = [];
        const monitor = new L1Monitor(config(), {
            getLogs: async ({ fromBlock, toBlock }: {
                fromBlock: bigint;
                toBlock: bigint;
            }) => {
                ranges.push([fromBlock, toBlock]);
                if (toBlock - fromBlock + 1n > 512n) {
                    throw new Error('request timeout');
                }
                return [];
            },
        } as unknown as PublicClient);

        const result = await monitor.scanExecutionHistory([round()], 3_000n);

        expect(result.rpcCalls).toBe(2);
        expect(result.scan).toMatchObject({
            status: 'scanning',
            scannedBlocks: 512n,
            chunkSize: 512n,
        });
        expect(ranges).toEqual([
            [8_977n, 10_000n],
            [9_489n, 10_000n],
        ]);
    });

    it('pauses immediately when the RPC rate limits history', async () => {
        const monitor = new L1Monitor(config(), {
            getLogs: async () => {
                throw new Error('HTTP 429: rate limit exceeded');
            },
        } as unknown as PublicClient);

        const result = await monitor.scanExecutionHistory([round()], 3_000n);

        expect(result).toMatchObject({
            canContinue: false,
            rpcCalls: 1,
            scan: {
                status: 'paused',
                scannedBlocks: 0n,
            },
        });
    });

    it('retries from the newest head when no history range succeeded', async () => {
        const ranges: Array<[bigint, bigint]> = [];
        let fail = true;
        const monitor = new L1Monitor(config(), {
            getLogs: async ({ fromBlock, toBlock }: {
                fromBlock: bigint;
                toBlock: bigint;
            }) => {
                ranges.push([fromBlock, toBlock]);
                if (fail) {
                    fail = false;
                    throw new Error('HTTP 429: rate limit exceeded');
                }
                return [];
            },
        } as unknown as PublicClient);

        await monitor.scanExecutionHistory([round()], 3_000n);
        (monitor as unknown as { snapshotBlockNumber: bigint })
            .snapshotBlockNumber = 10_020n;
        const result = await monitor.scanExecutionHistory([round()], 3_000n);

        expect(result.scan).toMatchObject({
            headBlock: 10_020n,
            targetFromBlock: 7_020n,
            oldestScannedBlock: 8_997n,
            scannedBlocks: 1_024n,
        });
        expect(ranges).toEqual([
            [8_977n, 10_000n],
            [8_997n, 10_020n],
        ]);
    });

    it('retains an inspected execution transaction even without a Slashed log', async () => {
        const transactionHash = `0x${'55'.repeat(32)}` as const;
        const blockHash = `0x${'66'.repeat(32)}` as const;
        const monitor = new L1Monitor(config(), {
            getLogs: async () => [{
                args: { round: 14n, slashCount: 1n },
                transactionHash,
                blockNumber: 9_900n,
                blockHash,
            }],
            getTransactionReceipt: async () => ({ logs: [] }),
        } as unknown as PublicClient);

        const result = await monitor.scanExecutionHistory([round()], 3_000n);

        expect(result.confirmedExecutions).toEqual([{
            round: 14n,
            slashCount: 1n,
            transactionHash,
            blockNumber: 9_900n,
            blockHash,
        }]);
        expect(result.confirmedSlashes).toEqual([]);
        expect(result.rpcCalls).toBe(2);
    });

    it('uses action order when one address appears in several target epochs', () => {
        const logs = [slashLog(100n), slashLog(250n)];
        const decoded = decodeExactReceiptSlashes(round(), logs, rollup);

        expect(decoded).toEqual([
            expect.objectContaining({ actionIndex: 0, targetEpoch: 18n, amount: 100n }),
            expect.objectContaining({ actionIndex: 1, targetEpoch: 19n, amount: 250n }),
        ]);
    });

    it('rejects a receipt whose action address disagrees with the tally', () => {
        const other = '0x3333333333333333333333333333333333333333' as Address;
        expect(() => decodeExactReceiptSlashes(
            round(),
            [slashLog(100n, other)],
            rollup,
        )).toThrow(/exact action order/);
    });
});

function slashLog(amount: bigint, attester: Address = sequencer) {
    return {
        address: rollup,
        topics: encodeEventTopics({
            abi: rollupAbi,
            eventName: 'Slashed',
            args: { attester },
        }) as [`0x${string}`, ...`0x${string}`[]],
        data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
    };
}

function round(): DetectedSlashing {
    return {
        round: 14n,
        status: 'executed',
        ballotCount: 2n,
        isExecuted: true,
        isVetoed: false,
        verificationStatus: 'verified',
        targetDetails: [
            target(18n, 0),
            target(19n, 1),
        ],
    };
}

function config(): RuntimeMonitorConfig {
    return {
        l1RpcUrl: 'https://rpc.example',
        chainId: 1,
        registryAddress: rollup,
        resolvedAtBlockNumber: 10_000n,
        resolvedAtTimestamp: 1_700_000_000n,
        rollupAddress: rollup,
        slasherAddress: '0x3333333333333333333333333333333333333333',
        slashingProposerAddress: '0x4444444444444444444444444444444444444444',
        rollupVersion: 5n,
        pendingSlasherAddress: '0x0000000000000000000000000000000000000000',
        pendingSlashingProposerAddress: '0x0000000000000000000000000000000000000000',
        pendingSlasherReadyAt: 0n,
        legacySlasherAddress: '0x0000000000000000000000000000000000000000',
        legacySlashingProposerAddress: '0x0000000000000000000000000000000000000000',
        legacySlasherAuthorizedUntil: 0n,
    };
}

function target(targetEpoch: bigint, actionIndex: number) {
    return {
        sequencer,
        targetEpoch,
        actionIndex,
        epochIndex: actionIndex,
        committeeIndex: 0,
        voteCount: 2,
        support: 2,
        maxSlashUnits: 1,
        unitVoteCounts: [2, 0, 0] as [number, number, number],
    };
}
