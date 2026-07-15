import { describe, expect, it } from 'vitest';
import { calculateProtectedRoundRange, isRoundProtectedByPause } from './pauseProtection';
import type { SlashingLifecycleConfig } from './slashingLifecycle';

const config: SlashingLifecycleConfig = {
    slashingRoundSize: 10,
    slashingRoundSizeInEpochs: 2,
    executionDelayInRounds: 2,
    lifetimeInRounds: 5,
    slashOffsetInRounds: 2,
};

describe('global pause protection', () => {
    it('uses a strict start and inclusive end boundary', () => {
        const range = calculateProtectedRoundRange(config, 100n, 150n);
        expect(range).toMatchObject({
            hasProtectedRounds: true,
            firstProtectedRound: 5n,
            lastProtectedRound: 9n,
            firstProtectedEpoch: 6n,
            lastProtectedEpoch: 15n,
        });

        expect(isRoundProtectedByPause(4n, config, false, 100n, 150n)).toBe(false);
        expect(isRoundProtectedByPause(5n, config, false, 100n, 150n)).toBe(true);
        expect(isRoundProtectedByPause(9n, config, false, 100n, 150n)).toBe(true);
        expect(isRoundProtectedByPause(10n, config, false, 100n, 150n)).toBe(false);
    });

    it('handles mid-round pause boundaries', () => {
        expect(calculateProtectedRoundRange(config, 105n, 149n)).toMatchObject({
            hasProtectedRounds: true,
            firstProtectedRound: 5n,
            lastProtectedRound: 8n,
        });
    });

    it('represents a pause too short to protect a round as empty', () => {
        expect(calculateProtectedRoundRange(config, 101n, 109n).hasProtectedRounds).toBe(false);
    });

    it('does not protect rounds while enabled or without exact slot boundaries', () => {
        expect(isRoundProtectedByPause(5n, config, true, 100n, 150n)).toBe(false);
        expect(isRoundProtectedByPause(5n, config, false, null, 150n)).toBe(false);
        expect(isRoundProtectedByPause(5n, config, false, 100n, null)).toBe(false);
    });
});
