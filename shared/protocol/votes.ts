export interface VoteTarget {
    sequencer: string;
    epochIndex: number;
    committeeIndex: number;
    voteCount: number;
    maxSlashUnits: number;
    unitVoteCounts: [number, number, number];
}

export interface VoteAction {
    sequencer: string;
    amount: string;
}

export interface ActionTarget extends VoteTarget {
    support: number;
    slashUnits: number;
    amount: string;
}

export function decodeVoteTargets(
    encodedVotes: readonly string[],
    committees: readonly (readonly string[])[],
    committeeSize: number,
): VoteTarget[] {
    if (!Number.isSafeInteger(committeeSize) || committeeSize < 1) return [];
    const tallies = new Map<string, VoteTarget>();
    for (const encoded of encodedVotes) {
        if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(encoded)) continue;
        const bytes = hexBytes(encoded);
        const validatorCount = committees.length * committeeSize;
        for (let index = 0; index < validatorCount; index += 1) {
            const byte = bytes[Math.floor(index / 4)] ?? 0;
            const units = (byte >> ((index % 4) * 2)) & 0b11;
            if (units === 0) continue;
            const epochIndex = Math.floor(index / committeeSize);
            const committeeIndex = index % committeeSize;
            const sequencer = committees[epochIndex]?.[committeeIndex]?.toLowerCase();
            if (!sequencer) continue;
            const key = `${epochIndex}:${committeeIndex}:${sequencer}`;
            const target = tallies.get(key) ?? {
                sequencer,
                epochIndex,
                committeeIndex,
                voteCount: 0,
                maxSlashUnits: 0,
                unitVoteCounts: [0, 0, 0],
            };
            target.voteCount += 1;
            target.maxSlashUnits = Math.max(target.maxSlashUnits, units);
            target.unitVoteCounts[units - 1] += 1;
            tallies.set(key, target);
        }
    }
    return [...tallies.values()].sort((left, right) =>
        left.epochIndex - right.epochIndex ||
        left.committeeIndex - right.committeeIndex ||
        left.sequencer.localeCompare(right.sequencer));
}

export function matchVoteActions(
    actions: readonly VoteAction[],
    targets: readonly VoteTarget[],
    quorum: number,
    escapeHatchEpochs: readonly boolean[] = [],
): ActionTarget[] {
    const qualified = targets.flatMap((target) => {
        if (escapeHatchEpochs[target.epochIndex]) return [];
        let cumulative = 0;
        let slashUnits = 0;
        for (let index = 2; index >= 0; index -= 1) {
            cumulative += target.unitVoteCounts[index] ?? 0;
            if (cumulative >= quorum) {
                slashUnits = index + 1;
                break;
            }
        }
        return slashUnits === 0 ? [] : [{ ...target, support: cumulative, slashUnits }];
    });
    if (qualified.length !== actions.length) {
        throw new Error(
            `Decoded ${qualified.length} slash targets but the contract returned ${actions.length}`,
        );
    }
    return qualified.map((target, index) => {
        const action = actions[index];
        if (target.sequencer !== action.sequencer.toLowerCase()) {
            throw new Error('Decoded slash targets disagree with contract tally order');
        }
        return { ...target, amount: action.amount };
    });
}

function hexBytes(value: string): number[] {
    const bytes = [];
    for (let offset = 2; offset < value.length; offset += 2) {
        bytes.push(Number.parseInt(value.slice(offset, offset + 2), 16));
    }
    return bytes;
}
