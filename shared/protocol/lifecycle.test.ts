import { describe, expect, it } from 'vitest';
import {
    executableSlot,
    expirySlot,
    isRoundProtectedByPause,
    roundStatus,
    targetEpochs,
} from './lifecycle.ts';

const TIMING = {
    roundSizeSlots: 128n,
    executionDelayRounds: 28n,
    lifetimeRounds: 34n,
};

describe('round lifecycle', () => {
    it('derives the executable and expiry slots from the round boundaries', () => {
        expect(executableSlot(100n, TIMING)).toBe(16_512n);
        expect(expirySlot(100n, TIMING)).toBe(17_280n);
        expect(executableSlot(100n, {
            roundSizeSlots: 128,
            executionDelayRounds: 28,
            lifetimeRounds: 34,
        })).toBe(16_512n);
    });

    it('preserves execution, expiry, quorum, and executable boundaries', () => {
        const common = {
            round: 100n,
            currentRound: 100n,
            currentSlot: 12_800n,
            isExecuted: false,
            hasActions: true,
        };

        expect(roundStatus({ ...common, isExecuted: true }, TIMING)).toBe('executed');
        expect(roundStatus({ ...common, currentRound: 135n }, TIMING)).toBe('expired');
        expect(roundStatus({ ...common, hasActions: false }, TIMING)).toBe('below-quorum');
        expect(roundStatus({ ...common, currentRound: 129n, currentSlot: 16_511n }, TIMING))
            .toBe('quorum-reached');
        expect(roundStatus({ ...common, currentRound: 129n, currentSlot: 16_512n }, TIMING))
            .toBe('newly-executable');
        expect(roundStatus({ ...common, currentRound: 130n, currentSlot: 16_640n }, TIMING))
            .toBe('executable');
    });

    it('only protects rounds whose lifetime ends inside the scheduled pause', () => {
        const timingFor = (lifetimeRounds: bigint) => ({
            roundSizeSlots: 1n,
            executionDelayRounds: 0n,
            lifetimeRounds,
        });
        const common = {
            round: 5n,
            slashOffsetRounds: 2n,
            isSlashingEnabled: false,
            pauseStartedAtSlot: 100n,
            pauseEndsAtSlot: 150n,
        };

        // Round 5 expires at (5 + 1 + lifetime) slots.
        expect(isRoundProtectedByPause(common, timingFor(124n))).toBe(true);
        expect(isRoundProtectedByPause(common, timingFor(144n))).toBe(true);
        expect(isRoundProtectedByPause(common, timingFor(145n))).toBe(false);
        expect(isRoundProtectedByPause({ ...common, round: 1n }, timingFor(124n))).toBe(false);
        expect(isRoundProtectedByPause(
            { ...common, isSlashingEnabled: true },
            timingFor(124n),
        )).toBe(false);
        expect(isRoundProtectedByPause(
            { ...common, pauseEndsAtSlot: null },
            timingFor(124n),
        )).toBe(false);
    });

    it('maps a voting round to its offset target epochs', () => {
        expect(targetEpochs(2n, { slashOffsetRounds: 2n, roundSizeEpochs: 4n }))
            .toEqual([0n, 1n, 2n, 3n]);
        expect(targetEpochs(3n, { slashOffsetRounds: 2, roundSizeEpochs: 4 }))
            .toEqual([4n, 5n, 6n, 7n]);
        expect(targetEpochs(1n, { slashOffsetRounds: 2n, roundSizeEpochs: 4n })).toEqual([]);
    });
});
