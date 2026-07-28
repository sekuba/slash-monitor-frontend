import {
    createPublicClient,
    getAddress,
    zeroAddress,
    type Address,
    type PublicClient,
} from 'viem';
import type { DeploymentAddresses, MonitorConfigInput } from '@/types/slashing';
import { registryAbi } from './contracts/registryAbi';
import { rollupAbi } from './contracts/rollupAbi';
import { slasherAbi } from './contracts/slasherAbi';
import { slashingProposerAbi } from './contracts/slashingProposerAbi';
import { createPublicRpcTransport } from './rpc';

export const MAX_L1_HEAD_AGE_SECONDS = 15n * 60n;
export const MAX_L1_FUTURE_SKEW_SECONDS = 2n * 60n;
export const INDEPENDENT_L1_CONFIRMATIONS = 2n;

export async function resolveDeployment(config: MonitorConfigInput): Promise<DeploymentAddresses> {
    const client = createPublicClient({
        transport: createPublicRpcTransport(config.l1RpcUrl),
    });

    return resolveDeploymentWithClient(client, config.registryAddress, config.chainId);
}

export async function resolveDeploymentWithClient(
    client: PublicClient,
    registryAddressInput: Address,
    expectedChainId: number
): Promise<DeploymentAddresses> {
    const chainId = await client.getChainId();
    if (chainId !== expectedChainId) {
        throw new Error(`RPC is connected to chain ${chainId}, expected chain ${expectedChainId}`);
    }

    const head = await client.getBlock({ blockTag: 'latest' });
    assertFreshL1Head(head.timestamp);
    if (head.number < INDEPENDENT_L1_CONFIRMATIONS) {
        throw new Error(
            `L1 RPC head ${head.number} is below the ${INDEPENDENT_L1_CONFIRMATIONS}-block confirmation depth`,
        );
    }
    const blockNumber = head.number - INDEPENDENT_L1_CONFIRMATIONS;
    const block = await client.getBlock({ blockNumber });
    if (!block.hash) {
        throw new Error(`Confirmed L1 block ${blockNumber} has no hash`);
    }
    assertFreshL1Head(block.timestamp);

    const registryAddress = getAddress(registryAddressInput);
    const rollupAddress = getAddress(await client.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: 'getCanonicalRollup',
        blockNumber,
    }));

    const [slasherResult, rollupVersion, legacySlasher] = await Promise.all([
        client.readContract({
            address: rollupAddress,
            abi: rollupAbi,
            functionName: 'getSlasher',
            blockNumber,
        }),
        client.readContract({
            address: rollupAddress,
            abi: rollupAbi,
            functionName: 'getVersion',
            blockNumber,
        }),
        client.readContract({
            address: rollupAddress,
            abi: rollupAbi,
            functionName: 'getLegacySlasher',
            blockNumber,
        }),
    ]);
    const slasherAddress = getAddress(slasherResult);
    requireNonZeroAddress('Registry', registryAddress);
    requireNonZeroAddress('canonical Rollup', rollupAddress);
    requireNonZeroAddress('Slasher', slasherAddress);

    const discoveredLegacySlasherAddress = getAddress(legacySlasher[0]);
    const legacySlasherIsAuthorized =
        discoveredLegacySlasherAddress !== zeroAddress &&
        legacySlasher[1] >= block.timestamp;
    const legacySlasherAddress = legacySlasherIsAuthorized
        ? discoveredLegacySlasherAddress
        : zeroAddress;
    const [
        slashingProposerAddress,
        legacySlashingProposerAddress,
    ] = await Promise.all([
        resolveAndValidateProposer(client, slasherAddress, rollupAddress, blockNumber, 'active'),
        !legacySlasherIsAuthorized
            ? zeroAddress
            : resolveAndValidateProposer(client, legacySlasherAddress, rollupAddress, blockNumber, 'legacy'),
    ]);

    const deployedAddresses = [registryAddress, rollupAddress];
    const bytecodes = await Promise.all(
        deployedAddresses.map((address) => client.getBytecode({ address, blockNumber }))
    );
    bytecodes.forEach((bytecode, index) => {
        if (!bytecode || bytecode === '0x') {
            throw new Error(`Invalid Aztec deployment: no contract code at ${deployedAddresses[index]}`);
        }
    });
    const verifiedBlock = await client.getBlock({ blockNumber });
    if (!verifiedBlock.hash || verifiedBlock.hash.toLowerCase() !== block.hash.toLowerCase()) {
        throw new Error(`Confirmed L1 block ${blockNumber} changed during deployment discovery`);
    }

    return {
        deploymentBlockNumber: blockNumber,
        deploymentBlockHash: block.hash,
        deploymentTimestamp: block.timestamp,
        rollupAddress,
        slasherAddress,
        slashingProposerAddress,
        rollupVersion,
        legacySlasherAddress,
        legacySlashingProposerAddress,
        legacySlasherAuthorizedUntil: legacySlasherIsAuthorized
            ? legacySlasher[1]
            : 0n,
    };
}

async function resolveAndValidateProposer(
    client: PublicClient,
    slasherAddress: Address,
    rollupAddress: Address,
    blockNumber: bigint,
    label: 'active' | 'legacy'
): Promise<Address> {
    const slashingProposerAddress = getAddress(await client.readContract({
        address: slasherAddress,
        abi: slasherAbi,
        functionName: 'PROPOSER',
        blockNumber,
    }));
    requireNonZeroAddress(`${label} SlashingProposer`, slashingProposerAddress);

    const [slasherCode, proposerCode, proposerRollupResult, proposerSlasherResult] = await Promise.all([
        client.getBytecode({ address: slasherAddress, blockNumber }),
        client.getBytecode({ address: slashingProposerAddress, blockNumber }),
        client.readContract({
            address: slashingProposerAddress,
            abi: slashingProposerAbi,
            functionName: 'INSTANCE',
            blockNumber,
        }),
        client.readContract({
            address: slashingProposerAddress,
            abi: slashingProposerAbi,
            functionName: 'SLASHER',
            blockNumber,
        }),
    ]);

    if (!slasherCode || slasherCode === '0x') {
        throw new Error(`Invalid Aztec deployment: no contract code at ${slasherAddress} (${label} Slasher)`);
    }
    if (!proposerCode || proposerCode === '0x') {
        throw new Error(`Invalid Aztec deployment: no contract code at ${slashingProposerAddress} (${label} SlashingProposer)`);
    }

    const proposerRollupAddress = getAddress(proposerRollupResult);
    const proposerSlasherAddress = getAddress(proposerSlasherResult);
    if (proposerRollupAddress !== rollupAddress) {
        throw new Error(
            `Invalid Aztec deployment: ${label} proposer INSTANCE is ${proposerRollupAddress}, expected ${rollupAddress}`
        );
    }
    if (proposerSlasherAddress !== slasherAddress) {
        throw new Error(
            `Invalid Aztec deployment: ${label} proposer SLASHER is ${proposerSlasherAddress}, expected ${slasherAddress}`
        );
    }

    return slashingProposerAddress;
}

export function assertFreshL1Head(
    timestamp: bigint,
    now = BigInt(Math.floor(Date.now() / 1000))
): void {
    if (timestamp > now + MAX_L1_FUTURE_SKEW_SECONDS) {
        throw new Error(
            `L1 RPC head timestamp is ${timestamp - now} seconds in the future ` +
            `(maximum ${MAX_L1_FUTURE_SKEW_SECONDS})`
        );
    }
    if (timestamp + MAX_L1_HEAD_AGE_SECONDS < now) {
        throw new Error(
            `L1 RPC head is stale: latest block is ${now - timestamp} seconds old (maximum ${MAX_L1_HEAD_AGE_SECONDS})`
        );
    }
}

function requireNonZeroAddress(label: string, address: Address): void {
    if (address === zeroAddress) {
        throw new Error(`Invalid Aztec deployment: ${label} address is zero`);
    }
}
