import {
    createPublicClient,
    getAddress,
    type Address,
    type Hash,
} from 'viem';
import { createPublicRpcTransport } from './rpc';

const slashedEvent = {
    type: 'event',
    name: 'Slashed',
    inputs: [
        { name: 'attester', type: 'address', indexed: true },
        { name: 'amount', type: 'uint256', indexed: false },
    ],
} as const;

export const DEFAULT_L1_SLASH_LOG_CHUNK_SIZE = 2_000n;

export interface L1BlockRange {
    fromBlock: bigint;
    toBlock: bigint;
}

/**
 * One canonical Rollup `Slashed` log. `actualAmount` is the amount the
 * contract actually removed, which can be lower than the amount proposed.
 */
export interface L1SlashReceiptLog {
    chainId: number;
    validator: Address;
    actualAmount: bigint;
    blockNumber: bigint;
    blockHash: Hash;
    transactionHash: Hash;
    logIndex: number;
}

/**
 * Receipt evidence grouped only when it belongs to the same chain, block,
 * transaction, and validator.
 */
export interface GroupedL1SlashReceipt {
    chainId: number;
    validator: Address;
    actualAmount: bigint;
    logCount: number;
    blockNumber: bigint;
    blockHash: Hash;
    transactionHash: Hash;
    logIndexes: number[];
}

export interface L1SlashReceiptScanIssue extends L1BlockRange {
    code: 'rpc_chunk_failed';
    message: string;
}

export interface L1SlashReceiptScanResult extends L1BlockRange {
    chainId: number;
    rollupAddress: Address;
    receipts: GroupedL1SlashReceipt[];
    coverage: {
        status: 'complete' | 'partial';
        scannedRanges: L1BlockRange[];
        issues: L1SlashReceiptScanIssue[];
    };
}

export interface L1SlashReceiptRangeInput {
    chainId: number;
    rollupAddress: Address;
    /** Inclusive, caller-pinned upper bound. This scanner never substitutes `latest`. */
    toBlock: bigint;
    /** Number of blocks to include, counting `toBlock`. */
    horizonBlocks: bigint;
    chunkSize?: bigint;
}

export interface FetchRecentL1SlashReceiptsInput extends L1SlashReceiptRangeInput {
    rpcUrls: string | string[];
    /** Hash captured for `toBlock`; the scan is rejected if that block changes. */
    toBlockHash: Hash;
}

export type ReadL1SlashReceiptChunk = (
    range: L1BlockRange
) => Promise<readonly L1SlashReceiptLog[]>;

interface ReceiptAccumulator extends GroupedL1SlashReceipt {
    newestLogIndex: number;
}

/**
 * Deduplicates exact log identities, then groups receipt evidence by
 * chain/block hash/transaction hash/validator. It deliberately does not infer
 * a slashing round or proposed amount from a receipt.
 */
export function groupL1SlashReceipts(
    logs: readonly L1SlashReceiptLog[]
): GroupedL1SlashReceipt[] {
    const seenLogs = new Set<string>();
    const groups = new Map<string, ReceiptAccumulator>();

    for (const log of logs) {
        assertValidLog(log);

        const blockHashKey = log.blockHash.toLowerCase();
        const transactionHashKey = log.transactionHash.toLowerCase();
        const validator = getAddress(log.validator);
        const exactLogKey = [
            log.chainId,
            blockHashKey,
            transactionHashKey,
            log.logIndex,
        ].join(':');

        if (seenLogs.has(exactLogKey)) {
            continue;
        }
        seenLogs.add(exactLogKey);

        const groupKey = [
            log.chainId,
            blockHashKey,
            transactionHashKey,
            validator.toLowerCase(),
        ].join(':');
        const existing = groups.get(groupKey);

        if (existing) {
            existing.actualAmount += log.actualAmount;
            existing.logCount += 1;
            existing.logIndexes.push(log.logIndex);
            existing.newestLogIndex = Math.max(existing.newestLogIndex, log.logIndex);
            continue;
        }

        groups.set(groupKey, {
            chainId: log.chainId,
            validator,
            actualAmount: log.actualAmount,
            logCount: 1,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            transactionHash: log.transactionHash,
            logIndexes: [log.logIndex],
            newestLogIndex: log.logIndex,
        });
    }

    return [...groups.values()]
        .sort((left, right) => {
            if (left.blockNumber !== right.blockNumber) {
                return left.blockNumber > right.blockNumber ? -1 : 1;
            }
            if (left.newestLogIndex !== right.newestLogIndex) {
                return right.newestLogIndex - left.newestLogIndex;
            }
            return left.transactionHash.localeCompare(right.transactionHash);
        })
        .map(({ newestLogIndex: _newestLogIndex, ...receipt }) => ({
            ...receipt,
            logIndexes: receipt.logIndexes.sort((left, right) => left - right),
        }));
}

/**
 * Scans a caller-pinned range in public-RPC-sized chunks. Failed chunks are
 * retained as explicit coverage issues while successful chunks still produce
 * receipt evidence.
 */
export async function scanL1SlashReceiptRange(
    input: L1SlashReceiptRangeInput,
    readChunk: ReadL1SlashReceiptChunk
): Promise<L1SlashReceiptScanResult> {
    const range = resolveRange(input);
    const rollupAddress = getAddress(input.rollupAddress);
    const chunkSize = input.chunkSize ?? DEFAULT_L1_SLASH_LOG_CHUNK_SIZE;
    const scannedRanges: L1BlockRange[] = [];
    const issues: L1SlashReceiptScanIssue[] = [];
    const logs: L1SlashReceiptLog[] = [];

    for (
        let fromBlock = range.fromBlock;
        fromBlock <= range.toBlock;
        fromBlock += chunkSize
    ) {
        const toBlock = minBigInt(fromBlock + chunkSize - 1n, range.toBlock);
        const chunk = { fromBlock, toBlock };

        try {
            const chunkLogs = await readChunk(chunk);
            for (const log of chunkLogs) {
                assertValidLog(log);
                getAddress(log.validator);
                if (log.chainId !== input.chainId) {
                    throw new Error(
                        `RPC returned chain ${log.chainId}, expected chain ${input.chainId}`
                    );
                }
                if (log.blockNumber < fromBlock || log.blockNumber > toBlock) {
                    throw new Error(
                        `RPC returned log block ${log.blockNumber} outside requested chunk ${fromBlock}-${toBlock}`
                    );
                }
            }
            logs.push(...chunkLogs);
            scannedRanges.push(chunk);
        } catch (error) {
            issues.push({
                ...chunk,
                code: 'rpc_chunk_failed',
                message: errorMessage(error),
            });
        }
    }

    return {
        chainId: input.chainId,
        rollupAddress,
        ...range,
        receipts: groupL1SlashReceipts(logs),
        coverage: {
            status: issues.length === 0 ? 'complete' : 'partial',
            scannedRanges,
            issues,
        },
    };
}

/**
 * Fetches actual `Slashed` receipts from one explicit Rollup address and one
 * explicit, inclusive L1 block horizon.
 */
export async function fetchRecentL1SlashReceipts(
    input: FetchRecentL1SlashReceiptsInput
): Promise<L1SlashReceiptScanResult> {
    const client = createPublicClient({
        transport: createPublicRpcTransport(input.rpcUrls),
    });
    const rollupAddress = getAddress(input.rollupAddress);
    const rpcChainId = await client.getChainId();
    if (rpcChainId !== input.chainId) {
        throw new Error(`RPC is connected to chain ${rpcChainId}, expected chain ${input.chainId}`);
    }

    const result = await scanL1SlashReceiptRange(
        { ...input, rollupAddress },
        async ({ fromBlock, toBlock }) => {
            const logs = await client.getLogs({
                address: rollupAddress,
                event: slashedEvent,
                fromBlock,
                toBlock,
                strict: true,
            });

            return logs.map((log) => {
                if (
                    !log.args.attester
                    || log.args.amount === undefined
                    || log.blockNumber === null
                    || log.blockHash === null
                    || log.transactionHash === null
                    || log.logIndex === null
                ) {
                    throw new Error(
                        `RPC returned an incomplete Slashed log for blocks ${fromBlock}-${toBlock}`
                    );
                }

                return {
                    chainId: input.chainId,
                    validator: getAddress(log.args.attester),
                    actualAmount: log.args.amount,
                    blockNumber: log.blockNumber,
                    blockHash: log.blockHash,
                    transactionHash: log.transactionHash,
                    logIndex: log.logIndex,
                };
            });
        }
    );
    const verifiedBlock = await client.getBlock({ blockNumber: input.toBlock });
    if (
        !verifiedBlock.hash ||
        verifiedBlock.hash.toLowerCase() !== input.toBlockHash.toLowerCase()
    ) {
        throw new Error(`Confirmed L1 block ${input.toBlock} changed during Slashed log scan`);
    }
    return result;
}

function resolveRange(input: L1SlashReceiptRangeInput): L1BlockRange {
    if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
        throw new Error('chainId must be a positive safe integer');
    }
    if (input.toBlock < 0n) {
        throw new Error('toBlock must not be negative');
    }
    if (input.horizonBlocks <= 0n) {
        throw new Error('horizonBlocks must be positive');
    }

    const chunkSize = input.chunkSize ?? DEFAULT_L1_SLASH_LOG_CHUNK_SIZE;
    if (chunkSize <= 0n) {
        throw new Error('chunkSize must be positive');
    }

    const fromBlock = input.toBlock + 1n > input.horizonBlocks
        ? input.toBlock + 1n - input.horizonBlocks
        : 0n;

    return {
        fromBlock,
        toBlock: input.toBlock,
    };
}

function assertValidLog(log: L1SlashReceiptLog): void {
    if (!Number.isSafeInteger(log.chainId) || log.chainId <= 0) {
        throw new Error('Slash receipt chainId must be a positive safe integer');
    }
    if (log.actualAmount < 0n) {
        throw new Error('Slash receipt actualAmount must not be negative');
    }
    if (log.blockNumber < 0n) {
        throw new Error('Slash receipt blockNumber must not be negative');
    }
    if (!Number.isSafeInteger(log.logIndex) || log.logIndex < 0) {
        throw new Error('Slash receipt logIndex must be a non-negative safe integer');
    }
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === 'string' && error) {
        return error;
    }
    return 'RPC chunk request failed without an error message';
}

function minBigInt(left: bigint, right: bigint): bigint {
    return left < right ? left : right;
}
