import { describe, expect, it } from 'vitest';
import { decodeVoteTargets, matchVoteActions } from './votes.ts';

describe('vote evidence', () => {
    it('keeps repeat committee addresses separated by target epoch position', () => {
        const sequencer = '0x1111111111111111111111111111111111111111';
        const targets = decodeVoteTargets(
            ['0x05'],
            [[sequencer], [sequencer]],
            1,
        );
        expect(targets).toHaveLength(2);
        expect(targets.map((item) => item.epochIndex)).toEqual([0, 1]);
        expect(matchVoteActions([
            { sequencer, amount: '100' },
            { sequencer, amount: '100' },
        ], targets, 1)).toHaveLength(2);
    });
});
