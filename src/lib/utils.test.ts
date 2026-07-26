import { describe, expect, it } from 'vitest';
import type { DetectedSlashing, ResolvedMonitorConfig } from '@/types/slashing';
import { deriveRoundPresentation } from './utils';
import { getRoundVisual } from './presentation';

const config = {
    slashingRoundSize: 10,
    slashingRoundSizeInEpochs: 2,
    executionDelayInRounds: 2,
    lifetimeInRounds: 5,
    slashOffsetInRounds: 2,
} as ResolvedMonitorConfig;

const livePayload: DetectedSlashing = {
    round: 5n,
    status: 'executable',
    ballotCount: 7n,
    isExecuted: false,
    isVetoed: false,
    verificationStatus: 'verified',
    slashActions: [{
        validator: '0x0000000000000000000000000000000000000001',
        slashAmount: 1n,
    }],
};

describe('deriveRoundPresentation', () => {
    it('only marks a live concrete slash payload as pause-protected', () => {
        const options = {
            config,
            isSlashingEnabled: false,
            pauseStartedAtSlot: 100n,
            pauseEndsAtSlot: 150n,
        };

        expect(deriveRoundPresentation(livePayload, options)).toMatchObject({
            isProtected: true,
            isActionable: false,
        });
        expect(deriveRoundPresentation({ ...livePayload, slashActions: undefined, status: 'below-quorum' }, options).isProtected).toBe(false);
        expect(deriveRoundPresentation({ ...livePayload, isVetoed: true }, options).isProtected).toBe(false);
        expect(deriveRoundPresentation({ ...livePayload, isExecuted: true, status: 'executed' }, options).isProtected).toBe(false);
        expect(deriveRoundPresentation({ ...livePayload, status: 'expired' }, options).isProtected).toBe(false);
    });

    it('keeps completed round states visibly distinct from the page background', () => {
        expect(getRoundVisual('executed').badgeClass).toContain('bg-vermillion');
        expect(getRoundVisual('expired').badgeClass).toContain('bg-aqua');
    });
});
