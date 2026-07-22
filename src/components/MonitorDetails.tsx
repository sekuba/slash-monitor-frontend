import { useState, type ReactNode } from 'react';
import { getRpcOverride } from '@/lib/rpcOverride';
import { useSlashingStore } from '@/store/slashingStore';
import type { MonitorConfigInput } from '@/types/slashing';

interface MonitorDetailsProps {
    configInput: MonitorConfigInput;
    onResetRpc: () => void;
    onUpdateRpc: (url: string) => void;
}

export function MonitorDetails({ configInput, onResetRpc, onUpdateRpc }: MonitorDetailsProps) {
    const [rpcUrl, setRpcUrl] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    const {
        config,
        isInitialized,
        l1BlockNumber,
        l1Timestamp,
        currentRound,
        currentSlot,
        currentEpoch,
        isSlashingEnabled,
        slashingDisabledUntil,
    } = useSlashingStore();
    const override = getRpcOverride(configInput.chainId);
    const unavailable = 'Not initialized';

    const updateRpc = () => {
        try {
            onUpdateRpc(rpcUrl);
            setRpcUrl('');
            setNotice('RPC changed. Monitor restarted from canonical deployment data.');
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : 'Unable to save RPC URL');
        }
    };

    const resetRpc = () => {
        try {
            onResetRpc();
            setRpcUrl('');
            setNotice('RPC reset to the configured default.');
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : 'Unable to clear RPC URL');
        }
    };

    return (
        <details className="group mb-8 border-5 border-orchid bg-aubergine shadow-brutal-orchid">
            <summary className="cursor-pointer list-none px-5 py-4 text-lg font-black uppercase text-orchid focus:outline-hidden focus-visible:ring-4 focus-visible:ring-aqua">
                <span className="flex items-center justify-between gap-4">
                    <span>On-chain details &amp; RPC</span>
                    <span className="text-sm group-open:hidden" aria-hidden="true">OPEN +</span>
                    <span className="hidden text-sm group-open:inline" aria-hidden="true">CLOSE −</span>
                </span>
            </summary>

            <div className="space-y-6 border-t-5 border-orchid p-5">
                <section aria-labelledby="monitor-rpc-heading">
                    <h2 id="monitor-rpc-heading" className="mb-3 text-xl font-black uppercase text-orchid">
                        Monitor RPC
                    </h2>
                    <p className="mb-4 break-all font-mono text-xs text-whisper-white">
                        {formatRpcUrls(configInput.l1RpcUrl)}
                        {override && (
                            <span className="ml-2 bg-chartreuse px-2 py-1 font-sans font-black text-brand-black">CUSTOM</span>
                        )}
                    </p>
                    <div className="flex flex-col gap-3 lg:flex-row">
                        <label className="flex-1">
                            <span className="mb-2 block text-xs font-black uppercase text-orchid">New RPC URL</span>
                            <input
                                type="url"
                                value={rpcUrl}
                                onChange={(event) => setRpcUrl(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') updateRpc();
                                }}
                                placeholder="https://rpc.example"
                                className="w-full border-3 border-whisper-white/30 bg-brand-black px-4 py-3 font-mono text-sm text-whisper-white focus:border-orchid focus:outline-hidden"
                            />
                        </label>
                        <div className="flex flex-wrap items-end gap-3">
                            <button type="button" onClick={updateRpc} className="brutal-button brutal-button--orchid brutal-button--lg">
                                Use RPC
                            </button>
                            {override && (
                                <button type="button" onClick={resetRpc} className="brutal-button brutal-button--orchid brutal-button--lg">
                                    Reset
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="mt-3 text-xs font-bold text-whisper-white/70">
                        Stored only in this browser for {configInput.chainId === 1 ? 'mainnet' : 'testnet'}. Use a public, browser-accessible URL allowed by this site&apos;s CSP.
                    </p>
                    {notice && <p className="mt-3 text-sm font-bold text-aqua" role="status">{notice}</p>}
                </section>

                <MetadataSection title="Deployment">
                    <Metadata label="Chain ID" value={configInput.chainId.toString()} />
                    <Metadata label="Registry" value={configInput.registryAddress} />
                    <Metadata label="Resolved at block" value={config?.deploymentBlockNumber.toString() ?? unavailable} />
                    <Metadata label="Resolved at time" value={formatTimestamp(config?.deploymentTimestamp, unavailable)} />
                    <Metadata label="Rollup" value={config?.rollupAddress ?? unavailable} />
                    <Metadata label="Rollup version" value={config?.rollupVersion.toString() ?? unavailable} />
                    <Metadata label="Active Slasher" value={config?.slasherAddress ?? unavailable} />
                    <Metadata label="Active proposer" value={config?.slashingProposerAddress ?? unavailable} />
                    <Metadata label="Pending Slasher" value={config?.pendingSlasherAddress ?? unavailable} />
                    <Metadata label="Pending proposer" value={config?.pendingSlashingProposerAddress ?? unavailable} />
                    <Metadata label="Pending ready at" value={formatTimestamp(config?.pendingSlasherReadyAt, unavailable, 'None')} />
                    <Metadata label="Legacy Slasher" value={config?.legacySlasherAddress ?? unavailable} />
                    <Metadata label="Legacy proposer" value={config?.legacySlashingProposerAddress ?? unavailable} />
                    <Metadata label="Legacy authorized until" value={formatTimestamp(config?.legacySlasherAuthorizedUntil, unavailable, 'None')} />
                </MetadataSection>

                <MetadataSection title="Current state & parameters">
                    <Metadata label="Snapshot block" value={isInitialized ? l1BlockNumber.toString() : unavailable} />
                    <Metadata label="Snapshot time" value={isInitialized ? formatTimestamp(l1Timestamp, unavailable) : unavailable} />
                    <Metadata label="Current slot" value={isInitialized ? currentSlot.toString() : unavailable} />
                    <Metadata label="Current epoch" value={isInitialized ? currentEpoch.toString() : unavailable} />
                    <Metadata label="Current round" value={isInitialized ? currentRound.toString() : unavailable} />
                    <Metadata label="Slashing enabled" value={isInitialized ? (isSlashingEnabled ? 'Yes' : 'No') : unavailable} />
                    <Metadata label="Disabled until" value={isInitialized ? formatTimestamp(slashingDisabledUntil, unavailable, 'Not disabled') : unavailable} />
                    <Metadata label="Quorum" value={config?.quorum.toString() ?? unavailable} />
                    <Metadata label="Committee size" value={config?.committeeSize.toString() ?? unavailable} />
                    <Metadata label="Round size" value={config ? `${config.slashingRoundSize} slots` : unavailable} />
                    <Metadata label="Round size in epochs" value={config?.slashingRoundSizeInEpochs.toString() ?? unavailable} />
                    <Metadata label="Execution delay" value={config ? `${config.executionDelayInRounds} rounds` : unavailable} />
                    <Metadata label="Lifetime" value={config ? `${config.lifetimeInRounds} rounds` : unavailable} />
                    <Metadata label="Slash offset" value={config ? `${config.slashOffsetInRounds} rounds` : unavailable} />
                    <Metadata label="Slot duration" value={config ? `${config.slotDuration}s` : unavailable} />
                    <Metadata label="Epoch duration" value={config ? `${config.epochDuration} slots` : unavailable} />
                </MetadataSection>
            </div>
        </details>
    );
}

function MetadataSection({ title, children }: { title: string; children: ReactNode }) {
    const headingId = `monitor-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    return (
        <section aria-labelledby={headingId}>
            <h2 id={headingId} className="mb-3 text-xl font-black uppercase text-aqua">{title}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
        </section>
    );
}

function Metadata({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-3 border-whisper-white/20 bg-brand-black p-3">
            <div className="mb-2 text-xs font-black uppercase text-whisper-white/60">{label}</div>
            <div className="break-all font-mono text-sm font-bold text-whisper-white">{value}</div>
        </div>
    );
}

function formatRpcUrls(value: string | string[]): string {
    const urls = Array.isArray(value) ? value : [value];
    return urls.filter(Boolean).join(', ') || 'Not configured';
}

function formatTimestamp(value: bigint | undefined, unavailable: string, zeroLabel?: string): string {
    if (value === undefined) return unavailable;
    if (value === 0n && zeroLabel) return zeroLabel;
    return new Date(Number(value) * 1_000).toLocaleString();
}
