import {
    projectAddressStatus,
    type ProtocolSnapshot,
    type SlashingCase,
} from '../../shared/protocol/index.ts';
import { CaseTimeline } from './CaseTimeline';
import { CopyButton } from './CopyButton';

export function AddressStatus({
    address,
    cases,
    protocol,
    selectedCaseId,
    onSelectCase,
}: {
    address: string;
    cases: SlashingCase[];
    protocol: ProtocolSnapshot | null;
    selectedCaseId: string | null;
    onSelectCase: (id: string | null) => void;
}) {
    const status = projectAddressStatus(address, cases);
    return (
        <section className="border-6 border-chartreuse bg-malachite p-4 shadow-brutal-chartreuse sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <p className="text-xs font-black uppercase text-chartreuse">Your sequencer</p>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                        <code className="min-w-0 break-all text-sm font-black text-whisper-white sm:text-base">
                            {address}
                        </code>
                        <CopyButton value={address} />
                    </div>
                    <h2 className="mt-4 text-2xl font-black text-whisper-white">
                        {status.headline}
                    </h2>
                </div>
                <span className={`w-fit border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${
                    status.urgency === 'critical'
                        ? 'bg-vermillion'
                        : status.urgency === 'warning'
                            ? 'bg-orchid'
                            : 'bg-aqua'
                }`}>
                    {status.activeCase ? `${status.cases.length} case${status.cases.length === 1 ? '' : 's'}` : 'Clear'}
                </span>
            </div>

            {status.cases.length === 0 ? (
                <p className="mt-4 border-3 border-aqua bg-lapis p-4 text-sm font-bold text-whisper-white/80">
                    No slashing evidence available to this view is currently linked to this address.
                </p>
            ) : (
                <div className="mt-6 grid gap-6">
                    {status.cases.map((item) => (
                        <div key={item.id}>
                            <button
                                type="button"
                                className="brutal-button brutal-button--sm mb-3"
                                onClick={() => onSelectCase(
                                    selectedCaseId === item.id ? null : item.id,
                                )}
                            >
                                {selectedCaseId === item.id ? 'Clear case link' : 'Link this case'}
                            </button>
                            <CaseTimeline
                                item={item}
                                protocol={protocol}
                                selected={selectedCaseId === item.id}
                            />
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
