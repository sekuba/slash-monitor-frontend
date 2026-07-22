import type { Address } from 'viem';
import { formatAddress } from '@/lib/utils';

interface SequencerAddressLinkProps {
    address: Address;
    chars?: number;
    full?: boolean;
    className?: string;
}

export function SequencerAddressLink({ address, chars = 9, full = false, className = '' }: SequencerAddressLinkProps) {
    return (
        <a
            href={`https://dashtec.xyz/sequencers/${address}`}
            target="_blank"
            rel="noreferrer"
            className={`block max-w-full ${full ? 'break-all' : 'truncate'} underline underline-offset-4 transition-colors hover:text-chartreuse ${className}`}
            title={`Open ${address} on Dashtec`}
        >
            {full ? address : formatAddress(address, chars)}
        </a>
    );
}
