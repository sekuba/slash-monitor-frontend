import { describe, expect, it } from 'vitest';
import { zeroAddress, type Address } from 'viem';
import type { ResolvedMonitorConfig, RoundInfo, SlashAction } from '@/types/slashing';
import type { L1Monitor } from './l1Monitor';
import type { MulticallResult } from './multicall';
import { SlashingDetector } from './slashingDetector';

const validator = '0x00000000000000000000000000000000000000aa' as Address;
const payload = '0x00000000000000000000000000000000000000bb' as Address;

describe('SlashingDetector quorum verification', () => {
    it('does not treat total ballot count as validator quorum', async () => {
        const fake = createFakeMonitor({ ballotCount: 65n, actions: [] });
        const result = await new SlashingDetector(config, fake.monitor).detectRounds(100n);
        const current = result.detectedRounds.find((round) => round.round === 100n);

        expect(current).toMatchObject({ ballotCount: 65n, slashActions: [] });
        expect(fake.calls.committees).toBe(1);
        expect(fake.calls.tallies).toBe(1);
        expect(fake.calls.payloads).toBe(0);
    });

    it('uses nonempty tally output as the evidence that a target reached quorum', async () => {
        const actions: SlashAction[] = [{ validator, slashAmount: 2_000n }];
        const fake = createFakeMonitor({ ballotCount: 65n, actions });
        const result = await new SlashingDetector(config, fake.monitor).detectRounds(100n);
        const current = result.detectedRounds.find((round) => round.round === 100n);

        expect(current).toMatchObject({
            slashActions: actions,
            payloadAddress: payload,
        });
        expect(fake.calls.payloads).toBe(1);
    });

    it('skips expensive tally calls while fewer total ballots than quorum exist', async () => {
        const fake = createFakeMonitor({ ballotCount: 64n, actions: [] });
        const result = await new SlashingDetector(config, fake.monitor).detectRounds(100n);
        const current = result.detectedRounds.find((round) => round.round === 100n);

        expect(current?.slashActions).toEqual([]);
        expect(fake.calls.committees).toBe(0);
        expect(fake.calls.tallies).toBe(0);
        expect(fake.calls.payloads).toBe(0);
    });

    it('withholds a case when the target tally cannot be verified', async () => {
        const fake = createFakeMonitor({ ballotCount: 65n, tallyFailure: true });
        const result = await new SlashingDetector(config, fake.monitor).detectRounds(100n);
        const current = result.detectedRounds.find((round) => round.round === 100n);

        expect(current).toBeUndefined();
        expect(result.issues).toHaveLength(1);
        expect(fake.calls.payloads).toBe(0);
    });

    it('withholds a case when committees or exact payload status cannot be verified', async () => {
        const committeeFailure = createFakeMonitor({
            ballotCount: 65n,
            committeeFailure: true,
        });
        const withoutCommittees = await new SlashingDetector(
            config,
            committeeFailure.monitor,
        ).detectRounds(100n);
        expect(withoutCommittees.detectedRounds).toEqual([]);
        expect(withoutCommittees.issues[0]?.message).toContain(
            'Unable to load slash committees',
        );

        const payloadFailure = createFakeMonitor({
            ballotCount: 65n,
            actions: [{ validator, slashAmount: 2_000n }],
            payloadFailure: true,
        });
        const withoutPayload = await new SlashingDetector(
            config,
            payloadFailure.monitor,
        ).detectRounds(100n);
        expect(withoutPayload.detectedRounds).toEqual([]);
        expect(withoutPayload.issues[0]?.message).toContain(
            'Unable to load payload status',
        );
    });

    it('preserves repeated tally actions for address-level aggregation', async () => {
        const actions: SlashAction[] = [
            { validator, slashAmount: 2_000n },
            { validator: validator.toUpperCase() as Address, slashAmount: 5_000n },
        ];
        const fake = createFakeMonitor({ ballotCount: 65n, actions });
        const result = await new SlashingDetector(config, fake.monitor).detectRounds(100n);
        const current = result.detectedRounds.find((round) => round.round === 100n);

        expect(current?.slashActions).toEqual(actions);
    });
});

const config: ResolvedMonitorConfig = {
    l1RpcUrl: 'http://localhost:8545',
    chainId: 1,
    registryAddress: zeroAddress,
    deploymentBlockNumber: 1n,
    deploymentBlockHash: `0x${'01'.repeat(32)}`,
    deploymentTimestamp: 1n,
    rollupAddress: zeroAddress,
    slasherAddress: zeroAddress,
    slashingProposerAddress: zeroAddress,
    rollupVersion: 5n,
    legacySlasherAddress: zeroAddress,
    legacySlashingProposerAddress: zeroAddress,
    legacySlasherAuthorizedUntil: 0n,
    l1GenesisTime: 1n,
    slashingRoundSize: 128,
    slashingRoundSizeInEpochs: 4,
    executionDelayInRounds: 28,
    lifetimeInRounds: 34,
    slashOffsetInRounds: 2,
    quorum: 65,
    committeeSize: 48,
    slotDuration: 72,
    epochDuration: 32,
};

function createFakeMonitor(options: {
    ballotCount: bigint;
    actions?: SlashAction[];
    committeeFailure?: boolean;
    tallyFailure?: boolean;
    payloadFailure?: boolean;
}) {
    const calls = { committees: 0, tallies: 0, payloads: 0 };
    const monitor = {
        getRounds: async (rounds: bigint[]) => new Map<bigint, MulticallResult<RoundInfo>>(
            rounds.map((round) => [round, {
                success: true,
                data: {
                    round,
                    isExecuted: false,
                    ballotCount: round === 100n ? options.ballotCount : 0n,
                },
            }])
        ),
        batchGetSlashTargetCommittees: async (rounds: bigint[]) => {
            calls.committees += 1;
            return rounds.map(() => options.committeeFailure
                ? { success: false, error: new Error('committees unavailable') }
                : { success: true, data: [[validator], [validator], [validator], [validator]] });
        },
        batchGetTally: async (rounds: Array<{ round: bigint }>) => {
            calls.tallies += 1;
            return rounds.map(() => options.tallyFailure
                ? { success: false, error: new Error('tally unavailable') }
                : { success: true, data: options.actions ?? [] });
        },
        batchGetPayloadAddressesAndVetoStatus: async (rounds: Array<{ round: bigint }>) => {
            calls.payloads += 1;
            return rounds.map(() => options.payloadFailure
                ? { success: false, error: new Error('payload unavailable') }
                : { success: true, data: { payloadAddress: payload, isVetoed: false } });
        },
    } as unknown as L1Monitor;

    return { monitor, calls };
}
