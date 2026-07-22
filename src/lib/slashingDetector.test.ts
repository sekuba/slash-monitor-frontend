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
        const result = await new SlashingDetector(config, fake.monitor).detectExecutableRounds(100n, 12_800n);
        const current = result.detectedSlashings.find((round) => round.round === 100n);

        expect(current).toMatchObject({ status: 'below-quorum', ballotCount: 65n });
        expect(current?.slashActions).toBeUndefined();
        expect(fake.calls.committees).toBe(1);
        expect(fake.calls.tallies).toBe(1);
        expect(fake.calls.payloads).toBe(0);
    });

    it('uses nonempty tally output as the evidence that a target reached quorum', async () => {
        const actions: SlashAction[] = [{ validator, slashAmount: 2_000n }];
        const fake = createFakeMonitor({ ballotCount: 65n, actions });
        const result = await new SlashingDetector(config, fake.monitor).detectExecutableRounds(100n, 12_800n);
        const current = result.detectedSlashings.find((round) => round.round === 100n);

        expect(current).toMatchObject({
            status: 'quorum-reached',
            verificationStatus: 'verified',
            affectedValidatorCount: 1,
            totalSlashAmount: 2_000n,
            payloadAddress: payload,
        });
        expect(fake.calls.payloads).toBe(1);
    });

    it('skips expensive tally calls while fewer total ballots than quorum exist', async () => {
        const fake = createFakeMonitor({ ballotCount: 64n, actions: [] });
        const result = await new SlashingDetector(config, fake.monitor).detectExecutableRounds(100n, 12_800n);
        const current = result.detectedSlashings.find((round) => round.round === 100n);

        expect(current?.status).toBe('below-quorum');
        expect(fake.calls.committees).toBe(0);
        expect(fake.calls.tallies).toBe(0);
        expect(fake.calls.payloads).toBe(0);
    });

    it('marks tally failures partial without asserting quorum', async () => {
        const fake = createFakeMonitor({ ballotCount: 65n, tallyFailure: true });
        const result = await new SlashingDetector(config, fake.monitor).detectExecutableRounds(100n, 12_800n);
        const current = result.detectedSlashings.find((round) => round.round === 100n);

        expect(current).toMatchObject({
            status: 'below-quorum',
            verificationStatus: 'partial',
        });
        expect(result.issues).toHaveLength(1);
        expect(fake.calls.payloads).toBe(0);
    });

    it('counts validator addresses uniquely while summing all actions', async () => {
        const actions: SlashAction[] = [
            { validator, slashAmount: 2_000n },
            { validator: validator.toUpperCase() as Address, slashAmount: 5_000n },
        ];
        const fake = createFakeMonitor({ ballotCount: 65n, actions });
        const result = await new SlashingDetector(config, fake.monitor).detectExecutableRounds(100n, 12_800n);
        const current = result.detectedSlashings.find((round) => round.round === 100n);

        expect(current?.affectedValidatorCount).toBe(1);
        expect(current?.totalSlashAmount).toBe(7_000n);
    });
});

const config: ResolvedMonitorConfig = {
    l1RpcUrl: 'http://localhost:8545',
    chainId: 1,
    registryAddress: zeroAddress,
    deploymentBlockNumber: 1n,
    deploymentTimestamp: 1n,
    rollupAddress: zeroAddress,
    slasherAddress: zeroAddress,
    slashingProposerAddress: zeroAddress,
    rollupVersion: 5n,
    pendingSlasherAddress: zeroAddress,
    pendingSlashingProposerAddress: zeroAddress,
    pendingSlasherReadyAt: 0n,
    legacySlasherAddress: zeroAddress,
    legacySlashingProposerAddress: zeroAddress,
    legacySlasherAuthorizedUntil: 0n,
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
    tallyFailure?: boolean;
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
            return rounds.map(() => ({ success: true, data: [[validator], [validator], [validator], [validator]] }));
        },
        batchGetTally: async (rounds: Array<{ round: bigint }>) => {
            calls.tallies += 1;
            return rounds.map(() => options.tallyFailure
                ? { success: false, error: new Error('tally unavailable') }
                : { success: true, data: options.actions ?? [] });
        },
        batchGetPayloadAddressesAndVetoStatus: async (rounds: Array<{ round: bigint }>) => {
            calls.payloads += 1;
            return rounds.map(() => ({ success: true, data: { payloadAddress: payload, isVetoed: false } }));
        },
    } as unknown as L1Monitor;

    return { monitor, calls };
}
