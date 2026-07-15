import { describe, expect, it } from 'vitest';
import {
    buildRoundsToCheck,
    calculateExecutableSlot,
    calculateExpirySlot,
    calculateRoundStatus,
    getTargetEpochs,
    type SlashingLifecycleConfig,
} from './slashingLifecycle';

const config: SlashingLifecycleConfig = {
    slashingRoundSize: 128,
    slashingRoundSizeInEpochs: 4,
    executionDelayInRounds: 28,
    lifetimeInRounds: 34,
    slashOffsetInRounds: 2,
};

describe('slashing lifecycle', () => {
    it('matches the v5 execution and expiry boundaries', () => {
        expect(calculateExecutableSlot(100n, config)).toBe(16_512n);
        expect(calculateExpirySlot(100n, config)).toBe(17_280n);

        expect(calculateRoundStatus(100n, 128n, 16_383n, false, true, config)).toBe('quorum-reached');
        expect(calculateRoundStatus(100n, 129n, 16_511n, false, true, config)).toBe('quorum-reached');
        expect(calculateRoundStatus(100n, 129n, 16_512n, false, true, config)).toBe('newly-executable');
        expect(calculateRoundStatus(100n, 130n, 16_640n, false, true, config)).toBe('executable');
        expect(calculateRoundStatus(100n, 134n, 17_152n, false, true, config)).toBe('executable');
        expect(calculateRoundStatus(100n, 135n, 17_280n, false, true, config)).toBe('expired');
        expect(calculateRoundStatus(100n, 135n, 17_280n, true, true, config)).toBe('executed');
    });

    it('keeps a live round without slash actions below quorum, not expired', () => {
        expect(calculateRoundStatus(100n, 100n, 12_800n, false, false, config)).toBe('below-quorum');
        expect(calculateRoundStatus(100n, 134n, 17_152n, false, false, config)).toBe('below-quorum');
        expect(calculateRoundStatus(100n, 135n, 17_280n, false, false, config)).toBe('expired');
    });

    it('checks exactly the active roundabout window', () => {
        expect(buildRoundsToCheck(140n, config)).toEqual(
            Array.from({ length: 35 }, (_, index) => 106n + BigInt(index))
        );
        expect(buildRoundsToCheck(3n, config)).toEqual([0n, 1n, 2n, 3n]);
    });

    it('derives target epochs without producing negative early-network epochs', () => {
        expect(getTargetEpochs(100n, config)).toEqual([392n, 393n, 394n, 395n]);
        expect(getTargetEpochs(1n, config)).toEqual([]);
    });
});
