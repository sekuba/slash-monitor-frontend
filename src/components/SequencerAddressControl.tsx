import type { Address } from 'viem';
import { CopyButton } from './CopyButton';
import { SequencerAddressLink } from './SequencerAddressLink';

interface SequencerAddressControlProps {
    address: Address;
    chars?: number;
    full?: boolean;
    showCopy?: boolean;
    onOpenRecord?: (address: Address) => void;
    className?: string;
    containerClassName?: string;
}

export function SequencerAddressControl({
    address,
    chars = 9,
    full = false,
    showCopy = false,
    onOpenRecord,
    className = '',
    containerClassName = '',
}: SequencerAddressControlProps) {
    return (
        <div className={`flex min-w-0 flex-wrap items-center gap-2 ${containerClassName}`}>
            <SequencerAddressLink
                address={address}
                chars={chars}
                full={full}
                className={className}
            />
            {showCopy && (
                <CopyButton value={address} ariaLabel="Copy sequencer address" />
            )}
            {onOpenRecord && (
                <button
                    type="button"
                    onClick={() => onOpenRecord(address)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center bg-transparent text-orchid transition-colors hover:bg-orchid hover:text-brand-black focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orchid"
                    title="Open sequencer record"
                    aria-label="Open sequencer record"
                >
                    <svg className="h-5 w-5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="square" strokeLinejoin="miter" d="M6 3h8l4 4v14H6zM14 3v4h4M9 11h6M9 15h6M9 19h4" />
                    </svg>
                </button>
            )}
        </div>
    );
}
