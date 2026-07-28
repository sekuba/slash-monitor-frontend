import { describe, expect, it } from 'vitest';
import { zeroAddress, type Address, type PublicClient } from 'viem';
import {
    assertFreshL1Head,
    MAX_L1_FUTURE_SKEW_SECONDS,
    resolveDeploymentWithClient,
} from './deployment';

const addresses = {
    registry: '0x0000000000000000000000000000000000000010' as Address,
    rollup: '0x0000000000000000000000000000000000000020' as Address,
    slasher: '0x0000000000000000000000000000000000000030' as Address,
    proposer: '0x0000000000000000000000000000000000000040' as Address,
    legacySlasher: '0x0000000000000000000000000000000000000050' as Address,
    legacyProposer: '0x0000000000000000000000000000000000000060' as Address,
};

describe('deployment discovery', () => {
    it('rejects an RPC connected to the wrong chain', async () => {
        const client = { getChainId: async () => 11155111 } as unknown as PublicClient;
        await expect(resolveDeploymentWithClient(client, addresses.registry, 1)).rejects.toThrow(
            'RPC is connected to chain 11155111, expected chain 1'
        );
    });

    it('rejects a frozen RPC head before trusting its Registry state', async () => {
        const client = createClient({ timestamp: 1n });
        await expect(resolveDeploymentWithClient(client, addresses.registry, 1)).rejects.toThrow('L1 RPC head is stale');
    });

    it('rejects an L1 head beyond the future-skew bound', () => {
        const now = 1_000_000n;
        expect(() => assertFreshL1Head(
            now + MAX_L1_FUTURE_SKEW_SECONDS,
            now,
        )).not.toThrow();
        expect(() => assertFreshL1Head(
            now + MAX_L1_FUTURE_SKEW_SECONDS + 1n,
            now,
        )).toThrow('in the future');
    });

    it('rejects broken proposer backreferences and missing bytecode', async () => {
        const brokenBackreference = createClient({ proposerRollup: addresses.registry });
        await expect(resolveDeploymentWithClient(brokenBackreference, addresses.registry, 1)).rejects.toThrow(
            'proposer INSTANCE'
        );

        const missingCode = createClient({ missingCodeAt: addresses.slasher });
        await expect(resolveDeploymentWithClient(missingCode, addresses.registry, 1)).rejects.toThrow(
            `no contract code at ${addresses.slasher}`
        );
    });

    it('validates a currently authorized legacy stack', async () => {
        const valid = await resolveDeploymentWithClient(
            createClient({ legacySlasher: true }),
            addresses.registry,
            1
        );
        expect(valid).toMatchObject({
            deploymentBlockNumber: 121n,
            legacySlasherAddress: addresses.legacySlasher,
            legacySlashingProposerAddress: addresses.legacyProposer,
            legacySlasherAuthorizedUntil: 9999999999n,
        });

        await expect(resolveDeploymentWithClient(
            createClient({ legacySlasher: true, invalidLegacyBackreference: true }),
            addresses.registry,
            1
        )).rejects.toThrow('legacy proposer SLASHER');
    });

    it('excludes an expired legacy stack from the executable topology', async () => {
        const resolved = await resolveDeploymentWithClient(
            createClient({ legacySlasher: true, legacyAuthorizedUntil: 1n }),
            addresses.registry,
            1,
        );
        expect(resolved).toMatchObject({
            legacySlasherAddress: zeroAddress,
            legacySlashingProposerAddress: zeroAddress,
            legacySlasherAuthorizedUntil: 0n,
        });
    });
});

function createClient(options: {
    proposerRollup?: Address;
    missingCodeAt?: Address;
    timestamp?: bigint;
    legacySlasher?: boolean;
    legacyAuthorizedUntil?: bigint;
    invalidLegacyBackreference?: boolean;
} = {}): PublicClient {
    return {
        getChainId: async () => 1,
        getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
            const number = blockNumber ?? 123n;
            return {
                number,
                hash: `0x${number.toString(16).padStart(64, '0')}`,
                timestamp: options.timestamp ?? BigInt(Math.floor(Date.now() / 1000)),
            };
        },
        readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
            switch (functionName) {
                case 'getCanonicalRollup': return addresses.rollup;
                case 'getSlasher': return addresses.slasher;
                case 'getVersion': return 5n;
                case 'getLegacySlasher': return options.legacySlasher
                    ? [addresses.legacySlasher, options.legacyAuthorizedUntil ?? 9999999999n] as const
                    : [zeroAddress, 0n] as const;
                case 'PROPOSER': return address === addresses.legacySlasher
                    ? addresses.legacyProposer
                    : addresses.proposer;
                case 'INSTANCE': return options.proposerRollup ?? addresses.rollup;
                case 'SLASHER': return address === addresses.legacyProposer && !options.invalidLegacyBackreference
                    ? addresses.legacySlasher
                    : addresses.slasher;
                default: throw new Error(`Unexpected function ${functionName}`);
            }
        },
        getBytecode: async ({ address }: { address: Address }) =>
            address === options.missingCodeAt ? undefined : '0x01',
    } as unknown as PublicClient;
}
