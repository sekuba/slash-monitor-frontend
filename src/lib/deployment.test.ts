import { describe, expect, it } from 'vitest';
import { zeroAddress, type Address, type PublicClient } from 'viem';
import type { DeploymentAddresses } from '@/types/slashing';
import { deploymentsMatch, resolveDeploymentWithClient } from './deployment';

const addresses = {
    registry: '0x0000000000000000000000000000000000000010' as Address,
    rollup: '0x0000000000000000000000000000000000000020' as Address,
    slasher: '0x0000000000000000000000000000000000000030' as Address,
    proposer: '0x0000000000000000000000000000000000000040' as Address,
    pendingSlasher: '0x0000000000000000000000000000000000000050' as Address,
    pendingProposer: '0x0000000000000000000000000000000000000060' as Address,
};

const deployment: DeploymentAddresses = {
    deploymentBlockNumber: 123n,
    deploymentTimestamp: 456n,
    rollupAddress: addresses.rollup,
    slasherAddress: addresses.slasher,
    slashingProposerAddress: addresses.proposer,
    rollupVersion: 5n,
    pendingSlasherAddress: zeroAddress,
    pendingSlashingProposerAddress: zeroAddress,
    pendingSlasherReadyAt: 0n,
    legacySlasherAddress: zeroAddress,
    legacySlashingProposerAddress: zeroAddress,
    legacySlasherAuthorizedUntil: 0n,
};

describe('deployment discovery', () => {
    it('detects a change to every topology and rotation field', () => {
        expect(deploymentsMatch(deployment, { ...deployment })).toBe(true);
        expect(deploymentsMatch(deployment, {
            ...deployment,
            deploymentBlockNumber: 999n,
            deploymentTimestamp: 999n,
        })).toBe(true);

        const changes: Partial<DeploymentAddresses>[] = [
            { rollupAddress: addresses.registry },
            { slasherAddress: addresses.registry },
            { slashingProposerAddress: addresses.registry },
            { rollupVersion: 6n },
            { pendingSlasherAddress: addresses.registry },
            { pendingSlashingProposerAddress: addresses.registry },
            { pendingSlasherReadyAt: 1n },
            { legacySlasherAddress: addresses.registry },
            { legacySlashingProposerAddress: addresses.registry },
            { legacySlasherAuthorizedUntil: 1n },
        ];

        for (const change of changes) {
            expect(deploymentsMatch(deployment, { ...deployment, ...change })).toBe(false);
        }
    });

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

    it('validates a queued v5 slasher stack before it can become active', async () => {
        const valid = await resolveDeploymentWithClient(
            createClient({ pendingSlasher: true }),
            addresses.registry,
            1
        );
        expect(valid).toMatchObject({
            pendingSlasherAddress: addresses.pendingSlasher,
            pendingSlashingProposerAddress: addresses.pendingProposer,
            pendingSlasherReadyAt: 999n,
        });

        await expect(resolveDeploymentWithClient(
            createClient({ pendingSlasher: true, invalidPendingBackreference: true }),
            addresses.registry,
            1
        )).rejects.toThrow('pending proposer SLASHER');
    });
});

function createClient(options: {
    proposerRollup?: Address;
    missingCodeAt?: Address;
    timestamp?: bigint;
    pendingSlasher?: boolean;
    invalidPendingBackreference?: boolean;
} = {}): PublicClient {
    return {
        getChainId: async () => 1,
        getBlock: async () => ({
            number: 123n,
            timestamp: options.timestamp ?? BigInt(Math.floor(Date.now() / 1000)),
        }),
        readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
            switch (functionName) {
                case 'getCanonicalRollup': return addresses.rollup;
                case 'getSlasher': return addresses.slasher;
                case 'getVersion': return 5n;
                case 'getPendingSlasher': return options.pendingSlasher
                    ? [addresses.pendingSlasher, 999n] as const
                    : [zeroAddress, 0n] as const;
                case 'getLegacySlasher': return [zeroAddress, 0n] as const;
                case 'PROPOSER': return address === addresses.pendingSlasher
                    ? addresses.pendingProposer
                    : addresses.proposer;
                case 'INSTANCE': return options.proposerRollup ?? addresses.rollup;
                case 'SLASHER': return address === addresses.pendingProposer && !options.invalidPendingBackreference
                    ? addresses.pendingSlasher
                    : addresses.slasher;
                default: throw new Error(`Unexpected function ${functionName}`);
            }
        },
        getBytecode: async ({ address }: { address: Address }) =>
            address === options.missingCodeAt ? undefined : '0x01',
    } as unknown as PublicClient;
}
