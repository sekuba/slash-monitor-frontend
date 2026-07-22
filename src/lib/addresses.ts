import { getAddress, isAddress, type Address } from 'viem';

export interface ParsedAddressList {
    addresses: Address[];
    errors: string[];
}

export function parseAddressList(input: string, maximum = 100): ParsedAddressList {
    const rawAddresses = input
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean);
    const addresses: Address[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const rawAddress of rawAddresses) {
        if (!isAddress(rawAddress, { strict: false })) {
            errors.push(`${rawAddress} is not a 20-byte Ethereum address`);
            continue;
        }

        const address = getAddress(rawAddress.toLowerCase());
        const key = address.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            addresses.push(address);
        }
    }

    if (addresses.length > maximum) {
        errors.push(`Watch at most ${maximum} sequencer addresses per list`);
    }

    return {
        addresses: addresses.slice(0, maximum),
        errors,
    };
}

export function formatAddressList(addresses: readonly string[]): string {
    return addresses.join('\n');
}
