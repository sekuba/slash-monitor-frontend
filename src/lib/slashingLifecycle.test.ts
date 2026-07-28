import { describe, expect, it } from 'vitest';
import {
    buildRoundsToCheck,
    calculateExecutableSlot,
    calculateExpirySlot,
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
