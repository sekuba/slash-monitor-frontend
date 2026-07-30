import type {
    Observation,
    ProtocolSnapshot,
    SlashingCase,
} from '../../shared/protocol/index.ts';
import { formatAztec } from '../../shared/protocol/format.ts';
import { CopyButton } from './CopyButton';

export function EvidenceDetails({
    item,
    protocol,
}: {
    item: SlashingCase;
    protocol: ProtocolSnapshot | null;
}) {
    const evidence = combineHistoricalExecutions(item.observations);

    return (
        <details className="mt-5 border-t-3 border-whisper-white/30 pt-4">
            <summary className="min-h-11 cursor-pointer font-black uppercase text-aqua">
                Evidence &amp; protocol details ({evidence.length})
            </summary>
            <div className="mt-3 grid gap-3">
                {evidence.map(({ observation, slash }) => {
                    const provenance = slash?.provenance ?? observation.provenance;
                    const support = dataString(observation, 'support');
                    const quorum = dataString(observation, 'quorum');
                    const requested = dataString(observation, 'amount');
                    const actual = slash && dataString(slash, 'amount');
                    const payload = dataString(observation, 'payloadAddress');
                    return (
                        <div
                            key={slash ? `${observation.id}:${slash.id}` : observation.id}
                            className="border-3 border-whisper-white/30 bg-malachite p-3"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-black uppercase text-chartreuse">
                                    {sourceLabel(observation.source)} · {
                                        slash
                                            ? 'executed slash'
                                            : observation.kind.replace(/_/g, ' ')
                                    }
                                </span>
                                <time className="text-xs font-bold text-whisper-white/60">
                                    {new Date(provenance.observedAt).toLocaleString()}
                                </time>
                            </div>
                            <dl className="mt-2 grid gap-1 text-xs font-bold text-whisper-white/75 sm:grid-cols-2">
                                {observation.round &&
                                    <Row label="Round" value={observation.round} />}
                                {observation.slot &&
                                    <Row label="Slot" value={observation.slot} />}
                                {provenance.blockNumber &&
                                    <Row label="L1 block" value={provenance.blockNumber} />}
                                {slash &&
                                    <Row label="Target epoch" value={observation.targetEpoch} />}
                                {slash && support && quorum &&
                                    <Row label="L1 support" value={`${support} / ${quorum}`} />}
                                {slash && requested &&
                                    <Row label="Requested" value={`${formatAztec(requested)} AZTEC`} />}
                                {actual &&
                                    <Row label="Actual" value={`${formatAztec(actual)} AZTEC`} />}
                                {slash && payload &&
                                    <Row label="Payload" value={payload} />}
                            </dl>
                            {provenance.transactionHash && (
                                <div className="mt-2 flex min-w-0 items-center gap-2">
                                    <a
                                        className="min-w-0 break-all font-mono text-xs font-black text-aqua underline"
                                        href={`${explorer(protocol?.chainId)}/tx/${provenance.transactionHash}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {provenance.transactionHash}
                                    </a>
                                    <CopyButton value={provenance.transactionHash} />
                                </div>
                            )}
                        </div>
                    );
                })}
                <div className="break-all border-3 border-orchid bg-aubergine p-3 text-xs font-bold">
                    <span className="text-orchid">Case key:</span> {item.id}
                </div>
            </div>
        </details>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className="inline text-whisper-white/50">{label}: </dt>
            <dd className="inline break-all">{value}</dd>
        </div>
    );
}

interface EvidenceItem {
    observation: Observation;
    slash?: Observation;
}

function combineHistoricalExecutions(
    observations: readonly Observation[],
): EvidenceItem[] {
    const slashByRoundId = new Map<string, Observation>();
    const pairedSlashIds = new Set<string>();
    for (const round of observations) {
        if (
            round.kind !== 'l1_round' ||
            round.data.historicalExecution !== true
        ) {
            continue;
        }
        const slash = observations.find((candidate) =>
            !pairedSlashIds.has(candidate.id) &&
            isSameExecution(round, candidate));
        if (!slash) continue;
        slashByRoundId.set(round.id, slash);
        pairedSlashIds.add(slash.id);
    }
    return observations.flatMap((observation) => {
        if (pairedSlashIds.has(observation.id)) return [];
        return [{
            observation,
            slash: slashByRoundId.get(observation.id),
        }];
    });
}

function isSameExecution(round: Observation, slash: Observation): boolean {
    const transactionHash = round.provenance.transactionHash;
    const actionIndex = dataString(round, 'actionIndex');
    return (
        slash.kind === 'l1_slash' &&
        transactionHash !== undefined &&
        actionIndex !== null &&
        sameHex(transactionHash, slash.provenance.transactionHash) &&
        sameHex(round.provenance.blockHash, slash.provenance.blockHash) &&
        round.provenance.blockNumber === slash.provenance.blockNumber &&
        round.provenance.canonical === slash.provenance.canonical &&
        sameHex(round.lineageId, slash.lineageId) &&
        sameHex(round.sequencer, slash.sequencer) &&
        round.targetEpoch === slash.targetEpoch &&
        round.round !== undefined &&
        round.round === slash.round &&
        actionIndex === dataString(slash, 'actionIndex')
    );
}

function dataString(
    observation: Observation,
    key: string,
): string | null {
    const value = observation.data[key];
    return typeof value === 'string' || typeof value === 'number' ||
        typeof value === 'bigint'
        ? String(value)
        : null;
}

function sameHex(
    left: string | undefined,
    right: string | undefined,
): boolean {
    return left !== undefined &&
        right !== undefined &&
        left.toLowerCase() === right.toLowerCase();
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
