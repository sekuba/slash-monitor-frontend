import type { DetectedSlashing } from '@/types/slashing';
import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';
import { SequencerAddressControl } from './SequencerAddressControl';
import { formatAddress } from '@/lib/utils';
import { formatAztec } from '@/lib/formatToken';
import type { MonitorNetwork } from '@/types/backendApi';

interface RoundCardDetailsProps {
    slashing: DetectedSlashing;
    sequencerOccurrences?: Map<string, number>;
    quorum?: number;
    network: MonitorNetwork;
}

export function RoundCardDetails({
    slashing,
    sequencerOccurrences,
    quorum,
    network,
}: RoundCardDetailsProps) {
    return (
        <div className="space-y-4 border-t-5 border-brand-black bg-brand-black/30 p-4 sm:p-6">
            {slashing.payloadAddress && (
                <DetailSection label="Payload address">
                    <div className="flex items-center justify-between border-3 border-chartreuse bg-brand-black px-4 py-3 font-mono text-sm text-whisper-white">
                        <span>{formatAddress(slashing.payloadAddress, 9)}</span>
                        <CopyButton value={slashing.payloadAddress} ariaLabel="Copy payload address" />
                    </div>
                </DetailSection>
            )}

            {slashing.targetEpochs && slashing.targetEpochs.length > 0 && (
                <DetailSection label="Target epochs">
                    <div className="flex flex-wrap gap-2">
                        {slashing.targetEpochs.map((epoch) => (
                            <span key={epoch.toString()} className="border-3 border-aqua bg-lapis px-3 py-2 text-sm font-bold text-aqua">
                                {epoch.toString()}
                            </span>
                        ))}
                    </div>
                </DetailSection>
            )}

            {slashing.slashActions && slashing.slashActions.length > 0 && (
                <DetailSection label="Sequencers to slash">
                    <div className="max-h-64 space-y-3 overflow-y-auto">
                        {slashing.slashActions.map((action) => {
                            const occurrences = sequencerOccurrences?.get(action.validator.toLowerCase()) ?? 1;
                            return (
                                <div
                                    key={action.validator}
                                    className="flex flex-col items-stretch justify-between gap-3 border-3 border-whisper-white bg-brand-black px-4 py-3 sm:flex-row sm:items-center"
                                >
                                    <div className="flex min-w-0 flex-1 items-center gap-3">
                                        <SequencerAddressControl
                                            address={action.validator}
                                            network={network}
                                            chars={9}
                                            showCopy
                                            className="font-mono text-sm font-bold text-whisper-white"
                                        />
                                        {occurrences > 1 && (
                                            <span
                                                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-3 border-vermillion bg-oxblood px-2 py-1 text-xs font-black uppercase text-vermillion"
                                                title="This sequencer appears in multiple monitored rounds"
                                            >
                                                ×{occurrences}
                                            </span>
                                        )}
                                    </div>
                                    <span className="whitespace-nowrap text-lg font-black text-vermillion">
                                        {formatAztec(action.slashAmount)} AZTEC
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </DetailSection>
            )}

            <div className="grid grid-cols-1 gap-4 border-t-3 border-brand-black pt-4 text-sm sm:grid-cols-2">
                <div className="border-3 border-orchid bg-aubergine px-4 py-3">
                    <div className="mb-1 text-xs font-black uppercase text-orchid">Ballots cast</div>
                    <div className="text-xl font-black text-whisper-white">{slashing.ballotCount.toString()}</div>
                    {quorum !== undefined && (
                        <div className="mt-1 text-xs font-bold text-whisper-white/70">
                            {quorum} matching required per sequencer
                        </div>
                    )}
                </div>
                {slashing.slotWhenExecutable !== undefined && (
                    <div className="border-3 border-aqua bg-lapis px-4 py-3">
                        <div className="mb-1 text-xs font-black uppercase text-aqua">Executable slot</div>
                        <div className="text-xl font-black text-whisper-white">{slashing.slotWhenExecutable.toString()}</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function DetailSection({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <section>
            <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-whisper-white">{label}</h4>
            {children}
        </section>
    );
}
