import type {
    ProtocolSnapshot,
    SlashingCase,
} from '../../shared/protocol/index.ts';
import { CopyButton } from './CopyButton';

export function EvidenceDetails({
    item,
    protocol,
}: {
    item: SlashingCase;
    protocol: ProtocolSnapshot | null;
}) {
    return (
        <details className="mt-5 border-t-3 border-whisper-white/30 pt-4">
            <summary className="min-h-11 cursor-pointer font-black uppercase text-aqua">
                Evidence &amp; protocol details ({item.observations.length})
            </summary>
            <div className="mt-3 grid gap-3">
                {item.observations.map((observation) => (
                    <div
                        key={observation.id}
                        className="border-3 border-whisper-white/30 bg-malachite p-3"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-black uppercase text-chartreuse">
                                {sourceLabel(observation.source)} · {observation.kind.replace(/_/g, ' ')}
                            </span>
                            <time className="text-xs font-bold text-whisper-white/60">
                                {new Date(observation.provenance.observedAt).toLocaleString()}
                            </time>
                        </div>
                        <dl className="mt-2 grid gap-1 text-xs font-bold text-whisper-white/75 sm:grid-cols-2">
                            {observation.round && <Row label="Round" value={observation.round} />}
                            {observation.slot && <Row label="Slot" value={observation.slot} />}
                            {observation.provenance.blockNumber &&
                                <Row label="L1 block" value={observation.provenance.blockNumber} />}
                        </dl>
                        {observation.provenance.transactionHash && (
                            <div className="mt-2 flex min-w-0 items-center gap-2">
                                <a
                                    className="min-w-0 break-all font-mono text-xs font-black text-aqua underline"
                                    href={`${explorer(protocol?.chainId)}/tx/${observation.provenance.transactionHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    {observation.provenance.transactionHash}
                                </a>
                                <CopyButton value={observation.provenance.transactionHash} />
                            </div>
                        )}
                    </div>
                ))}
                <div className="break-all border-3 border-orchid bg-aubergine p-3 text-xs font-bold">
                    <span className="text-orchid">Case key:</span> {item.id}
                </div>
            </div>
        </details>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="inline text-whisper-white/50">{label}: </dt>
            <dd className="inline">{value}</dd>
        </div>
    );
}

function sourceLabel(source: string): string {
    return {
        aztec_sentinel: 'Sentinel',
        aztec_node: 'Aztec node',
        ethereum_l1: 'Ethereum L1',
    }[source] ?? source;
}

function explorer(chainId: number | undefined): string {
    return chainId === 11_155_111
        ? 'https://sepolia.etherscan.io'
        : 'https://etherscan.io';
}
