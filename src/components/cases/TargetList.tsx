import { formatAztec } from '@/lib/formatToken';
import type { SlashingNetwork, ValidatorTarget } from '@/domain/slashingCase';

interface TargetListProps {
    network: SlashingNetwork;
    targets: readonly ValidatorTarget[];
}

export function TargetList({ network, targets }: TargetListProps) {
    if (targets.length === 0) {
        return (
            <p className="border-3 border-whisper-white/30 bg-brand-black p-4 text-sm font-bold text-whisper-white/75">
                This source did not provide a validator target.
            </p>
        );
    }

    return (
        <ul className="space-y-3" aria-label="Targeted validators">
            {targets.map((target) => (
                <li
                    key={target.validator.toLowerCase()}
                    className="border-3 border-whisper-white/30 bg-brand-black p-4"
                >
                    <a
                        href={`${etherscanOrigin(network)}/address/${target.validator}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all font-mono text-sm font-black text-whisper-white underline decoration-aqua decoration-2 underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-aqua"
                        aria-label={`Open validator ${target.validator} on Etherscan`}
                    >
                        {target.validator}
                    </a>
                    <dl className="mt-3">
                        <AmountFact
                            label="Proposed"
                            value={`${formatAztec(target.proposedAmount)} AZTEC`}
                            note={formatCount(target.proposedActionCount, 'tally action')}
                        />
                    </dl>
                </li>
            ))}
        </ul>
    );
}

function AmountFact({
    label,
    value,
    note,
}: {
    label: string;
    value: string;
    note: string;
}) {
    return (
        <div className="min-w-0 border-l-3 border-whisper-white/25 pl-3">
            <dt className="text-xs font-black uppercase text-chartreuse">{label}</dt>
            <dd className="mt-1 break-words text-base font-black text-whisper-white">{value}</dd>
            <dd className="mt-1 text-xs font-bold text-whisper-white/70">{note}</dd>
        </div>
    );
}

function etherscanOrigin(network: SlashingNetwork): string {
    return network === 'testnet' ? 'https://sepolia.etherscan.io' : 'https://etherscan.io';
}

function formatCount(value: number, noun: string): string {
    return `${value} ${noun}${value === 1 ? '' : 's'}`;
}
