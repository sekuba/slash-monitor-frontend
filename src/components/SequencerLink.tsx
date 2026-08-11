import type { Network } from '@shared/protocol/index.ts';

export function SequencerLink({
    address,
    network,
    className = '',
}: {
    address: string;
    network: Network;
    className?: string;
}) {
    const origin = network === 'testnet'
        ? 'https://testnet.dashtec.xyz'
        : 'https://dashtec.xyz';
    return (
        <a
            href={`${origin}/sequencers/${address.toLowerCase()}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`View sequencer ${address} on Dashtec`}
            className={`min-w-0 break-all font-mono font-black underline decoration-2 underline-offset-4 hover:text-aqua ${className}`}
        >
            {address}
            <span className="ml-1" aria-hidden="true">↗</span>
        </a>
    );
}
