import type { Address } from 'viem';
import { formatAddress } from '@/lib/utils';

interface SequencerAddressLinkProps {
    address: Address;
    chars?: number;
    className?: string;
}

export function SequencerAddressLink({ address, chars = 9, className = '' }: SequencerAddressLinkProps) {
    return (
        <a
            href={`https://dashtec.xyz/sequencers/${address}`}
            target="_blank"
            rel="noreferrer"
            className={`block max-w-full truncate underline underline-offset-4 transition-colors hover:text-chartreuse ${className}`}
            title={`Open ${address} on Dashtec`}
        >
            {formatAddress(address, chars)}
        </a>
    );
}
