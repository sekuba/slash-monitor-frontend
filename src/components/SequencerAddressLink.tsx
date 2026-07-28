import type { Address } from 'viem';
import { formatAddress } from '@/lib/utils';
import type { MonitorNetwork } from '@/types/backendApi';

interface SequencerAddressLinkProps {
    address: Address;
    chars?: number;
    full?: boolean;
    className?: string;
    network?: MonitorNetwork;
}

export function SequencerAddressLink({
    address,
    chars = 9,
    full = false,
    className = '',
    network = 'mainnet',
}: SequencerAddressLinkProps) {
    const dashtecOrigin = network === 'testnet'
        ? 'https://testnet.dashtec.xyz'
        : 'https://dashtec.xyz';
    return (
        <a
            href={`${dashtecOrigin}/sequencers/${address}`}
            target="_blank"
            rel="noreferrer"
            className={`block max-w-full ${full ? 'break-all' : 'truncate'} underline underline-offset-4 transition-colors hover:text-chartreuse ${className}`}
            title={`Open ${address} on Dashtec`}
        >
            {full ? address : formatAddress(address, chars)}
        </a>
    );
}
