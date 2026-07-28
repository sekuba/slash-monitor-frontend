import { describe, expect, it } from 'vitest';
import {
    groupL1SlashReceipts,
    scanL1SlashReceiptRange,
    type L1SlashReceiptLog,
} from './l1SlashReceipts';

const ROLLUP = '0x1111111111111111111111111111111111111111';
const VALIDATOR_A = '0x2222222222222222222222222222222222222222';
const VALIDATOR_B = '0x3333333333333333333333333333333333333333';
const BLOCK_HASH_A = `0x${'aa'.repeat(32)}` as const;
const TRANSACTION_A = `0x${'bb'.repeat(32)}` as const;
const TRANSACTION_B = `0x${'cc'.repeat(32)}` as const;
const TWO_THOUSAND_AZTEC = 2_000_000_000_000_000_000_000n;

describe('L1 slash receipt grouping', () => {
    it('sums same-validator logs in one transaction without merging other transactions or validators', () => {
        const receipts = groupL1SlashReceipts([
            slashLog({ logIndex: 10 }),
            slashLog({ logIndex: 11 }),
            slashLog({
                transactionHash: TRANSACTION_B,
                logIndex: 12,
            }),
            slashLog({
                validator: VALIDATOR_B,
                logIndex: 13,
            }),
        ]);

        expect(receipts).toHaveLength(3);
        expect(receipts.find((receipt) =>
            receipt.validator === VALIDATOR_A
            && receipt.transactionHash === TRANSACTION_A
        )).toMatchObject({
            actualAmount: 4_000_000_000_000_000_000_000n,
            logCount: 2,
            logIndexes: [10, 11],
        });
        expect(receipts.find((receipt) =>
            receipt.validator === VALIDATOR_A
            && receipt.transactionHash === TRANSACTION_B
        )).toMatchObject({
            actualAmount: TWO_THOUSAND_AZTEC,
            logCount: 1,
        });
        expect(receipts.find((receipt) =>
            receipt.validator === VALIDATOR_B
            && receipt.transactionHash === TRANSACTION_A
        )).toMatchObject({
            actualAmount: TWO_THOUSAND_AZTEC,
            logCount: 1,
        });
    });

    it('deduplicates an exact log identity defensively', () => {
        const original = slashLog({ logIndex: 20 });

        expect(groupL1SlashReceipts([original, { ...original }])).toEqual([{
            chainId: 1,
            validator: VALIDATOR_A,
            actualAmount: TWO_THOUSAND_AZTEC,
            logCount: 1,
            blockNumber: 100n,
            blockHash: BLOCK_HASH_A,
            transactionHash: TRANSACTION_A,
            logIndexes: [20],
        }]);
    });

    it('returns groups newest first', () => {
        const receipts = groupL1SlashReceipts([
            slashLog({
                blockNumber: 99n,
                blockHash: `0x${'dd'.repeat(32)}`,
                transactionHash: TRANSACTION_B,
            }),
            slashLog(),
        ]);

        expect(receipts.map((receipt) => receipt.blockNumber)).toEqual([100n, 99n]);
    });
});

describe('bounded L1 slash receipt scanning', () => {
    it('chunks the pinned horizon and reports failed chunks as partial coverage', async () => {
        const requestedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
        const result = await scanL1SlashReceiptRange({
            chainId: 1,
            rollupAddress: ROLLUP,
            toBlock: 9n,
            horizonBlocks: 10n,
            chunkSize: 4n,
        }, async (range) => {
            requestedRanges.push(range);
            if (range.fromBlock === 4n) {
                throw new Error('public RPC range limit');
            }
            return range.fromBlock === 8n
                ? [slashLog({ blockNumber: 9n })]
                : [];
        });

        expect(requestedRanges).toEqual([
            { fromBlock: 0n, toBlock: 3n },
            { fromBlock: 4n, toBlock: 7n },
            { fromBlock: 8n, toBlock: 9n },
        ]);
        expect(result.receipts).toHaveLength(1);
        expect(result.coverage).toEqual({
            status: 'partial',
            scannedRanges: [
                { fromBlock: 0n, toBlock: 3n },
                { fromBlock: 8n, toBlock: 9n },
            ],
            issues: [{
                fromBlock: 4n,
                toBlock: 7n,
                code: 'rpc_chunk_failed',
                message: 'public RPC range limit',
            }],
        });
    });
});

function slashLog(
    overrides: Partial<L1SlashReceiptLog> = {}
): L1SlashReceiptLog {
    return {
        chainId: 1,
        validator: VALIDATOR_A,
        actualAmount: TWO_THOUSAND_AZTEC,
        blockNumber: 100n,
        blockHash: BLOCK_HASH_A,
        transactionHash: TRANSACTION_A,
        logIndex: 0,
        ...overrides,
    };
}
