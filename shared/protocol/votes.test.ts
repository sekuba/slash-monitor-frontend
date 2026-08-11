import { describe, expect, it } from 'vitest';
import { decodeVoteTargets, matchVoteActions, mergeVoteTargets } from './votes.ts';

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

    it('exposes address-level targeting from the first two-bit vote', () => {
        const committees = [[
            '0x1111111111111111111111111111111111111111',
            '0x2222222222222222222222222222222222222222',
            '0x3333333333333333333333333333333333333333',
            '0x4444444444444444444444444444444444444444',
        ]];
        const targets = decodeVoteTargets(['0x39', '0x01'], committees, 4n);

        expect(targets).toEqual([
            {
                sequencer: committees[0][0],
                epochIndex: 0,
                committeeIndex: 0,
                voteCount: 2,
                maxSlashUnits: 1,
                unitVoteCounts: [2, 0, 0],
            },
            {
                sequencer: committees[0][1],
                epochIndex: 0,
                committeeIndex: 1,
                voteCount: 1,
                maxSlashUnits: 2,
                unitVoteCounts: [0, 1, 0],
            },
            {
                sequencer: committees[0][2],
                epochIndex: 0,
                committeeIndex: 2,
                voteCount: 1,
                maxSlashUnits: 3,
                unitVoteCounts: [0, 0, 1],
            },
        ]);
    });

    it('merges incremental decodes for one exact committee-position vote cursor', () => {
        const sequencer = '0x1111111111111111111111111111111111111111';
        expect(mergeVoteTargets([
            {
                sequencer,
                epochIndex: 0,
                committeeIndex: 0,
                voteCount: 2,
                maxSlashUnits: 1,
                unitVoteCounts: [2, 0, 0],
            },
        ], [
            {
                sequencer,
                epochIndex: 0,
                committeeIndex: 0,
                voteCount: 1,
                maxSlashUnits: 3,
                unitVoteCounts: [0, 0, 1],
            },
        ])).toEqual([
            {
                sequencer,
                epochIndex: 0,
                committeeIndex: 0,
                voteCount: 3,
                maxSlashUnits: 3,
                unitVoteCounts: [2, 0, 1],
            },
        ]);
    });

    it('preserves exact target epochs for repeated addresses in the action match', () => {
        const sequencer = '0x1111111111111111111111111111111111111111';
        expect(matchVoteActions([
            { sequencer, amount: '100' },
            { sequencer, amount: '300' },
        ], [
            {
                sequencer,
                epochIndex: 0,
                committeeIndex: 0,
                voteCount: 2,
                maxSlashUnits: 1,
                unitVoteCounts: [2, 0, 0],
            },
            {
                sequencer,
                epochIndex: 1,
                committeeIndex: 0,
                voteCount: 2,
                maxSlashUnits: 3,
                unitVoteCounts: [0, 0, 2],
            },
        ], 2)).toEqual([
            {
                sequencer,
                epochIndex: 0,
                committeeIndex: 0,
                voteCount: 2,
                maxSlashUnits: 1,
                unitVoteCounts: [2, 0, 0],
                support: 2,
                slashUnits: 1,
                amount: '100',
            },
            {
                sequencer,
                epochIndex: 1,
                committeeIndex: 0,
                voteCount: 2,
                maxSlashUnits: 3,
                unitVoteCounts: [0, 0, 2],
                support: 2,
                slashUnits: 3,
                amount: '300',
            },
        ]);
    });

    it('refuses to match when the local decode and contract tally disagree', () => {
        const sequencer = '0x1111111111111111111111111111111111111111';
        const targets = decodeVoteTargets(['0x03'], [[sequencer]], 1);
        expect(() => matchVoteActions([], targets, 1)).toThrow(/contract returned 0/);
        expect(matchVoteActions([{ sequencer, amount: '100' }], targets, 0)).toEqual([]);
    });

    it('excludes escape-hatch epochs from the qualified action set', () => {
        const sequencer = '0x1111111111111111111111111111111111111111';
        const targets = decodeVoteTargets(['0x0f'], [[sequencer], [sequencer]], 1);
        expect(matchVoteActions(
            [{ sequencer, amount: '100' }],
            targets,
            1,
            [false, true],
        )).toHaveLength(1);
    });
});
