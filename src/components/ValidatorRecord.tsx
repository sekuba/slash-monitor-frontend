import type { Address } from 'viem';
import { apiCasesToDomain } from '@/domain';
import { useHostedValidator } from '@/hooks/useHostedMonitor';
import { formatHostedSlashCoverage } from '@/lib/hostedCoverage';
import type {
    MonitorNetwork,
    ProtocolSnapshot,
    SlashDatasetCoverage,
} from '@/types/api';
import { CaseList } from './cases';
import { ConfirmedSlashes } from './ConfirmedSlashes';
import { NodeObservations } from './NodeObservations';

interface ValidatorRecordProps {
    address: Address;
    network: MonitorNetwork;
    protocol: ProtocolSnapshot | null;
    slashCoverage: SlashDatasetCoverage;
}

export function ValidatorRecord({
    address,
    network,
    protocol,
    slashCoverage,
}: ValidatorRecordProps) {
    const monitor = useHostedValidator(address);
    const record = monitor.record;

    if (monitor.isLoading && !record) {
        return (
            <section className="border-5 border-aqua bg-lapis p-5 shadow-brutal-aqua" aria-live="polite">
                <h2 className="text-xl font-black text-aqua">Loading validator facts…</h2>
                <p className="mt-2 break-all font-mono text-xs font-bold text-whisper-white/70">{address}</p>
            </section>
        );
    }

    if (monitor.error && !record) {
        return (
            <section className="border-5 border-vermillion bg-oxblood p-5 shadow-brutal-vermillion" role="alert">
                <h2 className="text-xl font-black text-vermillion">Validator record unavailable</h2>
                <p className="mt-2 text-sm font-bold text-whisper-white">{monitor.error}</p>
                <button type="button" onClick={() => void monitor.refresh()} className="brutal-button brutal-button--danger mt-4">
                    Retry
                </button>
            </section>
        );
    }

    if (!record) return null;

    const cases = apiCasesToDomain(record.cases, protocol, network);
    const canonicalSlashes = record.slashes.confirmed;
    const reorgedSlashes = record.slashes.removed;

    return (
        <div className="space-y-8">
            <section className="border-5 border-chartreuse bg-malachite p-5 shadow-brutal-chartreuse">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-chartreuse">Validator record</div>
                <h2 className="mt-2 break-all font-mono text-lg font-black text-whisper-white sm:text-xl">
                    {record.address}
                </h2>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs font-bold text-whisper-white/70">
                    <span>{record.cases.length} L1 case{record.cases.length === 1 ? '' : 's'} shown</span>
                    <span>{record.nodeOffenses.length} node observation{record.nodeOffenses.length === 1 ? '' : 's'} shown</span>
                    <span>{canonicalSlashes.length} confirmed slash outcome{canonicalSlashes.length === 1 ? '' : 's'} shown</span>
                    <span>{record.observedAt ? `Updated ${new Date(record.observedAt).toLocaleString()}` : 'No retained facts'}</span>
                </div>
            </section>

            {monitor.error && (
                <p className="border-3 border-vermillion bg-brand-black p-3 text-sm font-bold text-vermillion" role="status">
                    Refresh failed; the last validator record remains visible. {monitor.error}
                </p>
            )}

            {protocol ? (
                <CaseList cases={cases} title="L1 cases for this validator" />
            ) : (
                <p className="border-5 border-vermillion bg-oxblood p-5 text-sm font-bold text-whisper-white shadow-brutal-vermillion">
                    The hosted Ethereum protocol snapshot is unavailable, so case lifecycle states are not displayed.
                </p>
            )}

            <NodeObservations offenses={record.nodeOffenses} />

            <ConfirmedSlashes
                network={network}
                selectedValidator={address}
                slashes={canonicalSlashes.map((slash) => ({
                    id: slash.id,
                    validator: slash.address,
                    actualAmount: BigInt(slash.actualAmount),
                    logCount: slash.logCount,
                    blockNumber: BigInt(slash.blockNumber),
                    transactionHash: slash.transactionHash,
                }))}
                coverage={formatHostedSlashCoverage(slashCoverage)}
                coverageIsPartial={!slashCoverage.complete}
                emptyMessage="No canonical Slashed outcome for this validator is present in the retained hosted result."
            />

            {reorgedSlashes.length > 0 && (
                <section className="border-5 border-orchid bg-aubergine p-5 shadow-brutal-orchid">
                    <h2 className="text-xl font-black text-orchid">Removed confirmations</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white/75">
                        {reorgedSlashes.length} previously observed slash outcome{reorgedSlashes.length === 1 ? ' is' : 's are'} no longer canonical after an Ethereum reorganization.
                        They are not counted as confirmed token loss.
                    </p>
                </section>
            )}
        </div>
    );
}
