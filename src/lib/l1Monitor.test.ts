import { describe, expect, it } from 'vitest';
import {
    encodeAbiParameters,
    encodeEventTopics,
    type Address,
} from 'viem';
import { decodeExactReceiptSlashes } from './l1Monitor';
import { rollupAbi } from './contracts/rollupAbi';
import type { DetectedSlashing } from '@/types/slashing';

const rollup = '0x1111111111111111111111111111111111111111' as Address;
const sequencer = '0x2222222222222222222222222222222222222222' as Address;

describe('browser receipt slash correlation', () => {
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
