import { useState, type ReactNode } from 'react';
import { zeroAddress } from 'viem';
import type { IndependentSnapshot } from '@/hooks/useIndependentMonitor';
import { getRpcOverride } from '@/lib/rpcOverride';
import type { MonitorConfigInput } from '@/types/slashing';

interface MonitorDetailsProps {
    configInput: MonitorConfigInput;
    network: 'mainnet' | 'testnet';
    snapshot?: IndependentSnapshot | null;
    onResetRpc: () => void;
    onToggleNetwork: () => void;
    onUpdateRpc: (url: string) => void;
}

export function MonitorDetails({
    configInput,
    network,
    snapshot,
    onResetRpc,
    onToggleNetwork,
    onUpdateRpc,
}: MonitorDetailsProps) {
    const [rpcUrl, setRpcUrl] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    const override = getRpcOverride(configInput.chainId);

    const updateRpc = () => {
        try {
            onUpdateRpc(rpcUrl);
            setRpcUrl('');
            setNotice('RPC saved in this browser. A fresh canonical snapshot is loading.');
        }
        catch (error) {
            setNotice(toErrorMessage(error));
        }
    };

    const resetRpc = () => {
        try {
            onResetRpc();
            setRpcUrl('');
            setNotice('RPC reset to the configured public providers.');
        }
        catch (error) {
            setNotice(toErrorMessage(error));
        }
    };

    return (
        <details className="group border-5 border-orchid bg-aubergine shadow-brutal-orchid">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-lg font-black text-orchid">
                <span>Contract details &amp; RPC</span>
                <span className="text-xs uppercase group-open:hidden" aria-hidden="true">Open +</span>
                <span className="hidden text-xs uppercase group-open:inline" aria-hidden="true">Close −</span>
            </summary>

            <div className="space-y-7 border-t-5 border-orchid p-5">
                <section aria-labelledby="independent-rpc-heading">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 id="independent-rpc-heading" className="text-xl font-black text-whisper-white">
                                Browser RPC
                            </h2>
                            <p className="mt-1 text-sm font-bold text-whisper-white/70">
                                Used only by this independent page.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onToggleNetwork}
                            className={`brutal-button brutal-button--lg w-full sm:w-auto ${network === 'mainnet' ? 'brutal-button--danger' : 'brutal-button--aqua'}`}
                        >
                            Switch to {network === 'mainnet' ? 'Sepolia' : 'Mainnet'}
                        </button>
                    </div>
                    <p className="mb-4 break-all border-3 border-whisper-white/20 bg-brand-black p-3 font-mono text-xs text-whisper-white">
                        {formatRpcUrls(configInput.l1RpcUrl)}
                        {override && (
                            <span className="ml-2 bg-chartreuse px-2 py-1 font-sans font-black text-brand-black">
                                Custom
                            </span>
                        )}
                    </p>
                    <div className="flex flex-col gap-3 lg:flex-row">
                        <label className="flex-1">
                            <span className="mb-2 block text-xs font-black uppercase text-orchid">
                                Public HTTPS RPC URL
                            </span>
                            <input
                                type="url"
                                value={rpcUrl}
                                onChange={(event) => setRpcUrl(event.target.value)}
                                placeholder="https://rpc.example"
                                className="min-h-12 w-full border-3 border-whisper-white/30 bg-brand-black px-4 font-mono text-sm text-whisper-white focus:border-orchid"
                            />
                        </label>
                        <div className="flex flex-wrap items-end gap-3">
                            <button type="button" onClick={updateRpc} className="brutal-button brutal-button--orchid brutal-button--lg">
                                Use RPC
                            </button>
                            {override && (
                                <button type="button" onClick={resetRpc} className="brutal-button brutal-button--neutral brutal-button--lg">
                                    Reset
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="mt-3 text-xs font-bold text-whisper-white/65">
                        The URL stays in this browser. It must allow browser requests from this site.
                    </p>
                    {notice && <p className="mt-3 text-sm font-bold text-aqua" role="status">{notice}</p>}
                </section>

                <MetadataSection title="Canonical deployment">
                    <Metadata label="Chain ID" value={configInput.chainId.toString()} />
                    <Metadata label="Registry" value={configInput.registryAddress} />
                    <Metadata label="Resolved block" value={formatBigint(snapshot?.deployment.deploymentBlockNumber)} />
                    <Metadata label="Rollup" value={snapshot?.deployment.rollupAddress ?? 'Loading…'} />
                    <Metadata label="Rollup version" value={formatBigint(snapshot?.deployment.rollupVersion)} />
                    <Metadata label="Active slasher" value={snapshot?.deployment.slasherAddress ?? 'Loading…'} />
                    <Metadata label="Active proposer" value={snapshot?.deployment.slashingProposerAddress ?? 'Loading…'} />
                    <Metadata
                        label="Authorized legacy slasher"
                        value={formatOptionalAddress(snapshot?.deployment.legacySlasherAddress)}
                    />
                    <Metadata
                        label="Legacy authorization ends"
                        value={formatUnixSeconds(snapshot?.deployment.legacySlasherAuthorizedUntil)}
                    />
                </MetadataSection>

                <MetadataSection title="Pinned protocol snapshot">
                    <Metadata label="Snapshot block" value={formatBigint(snapshot?.protocol.blockNumber)} />
                    <Metadata label="Snapshot time" value={snapshot ? formatDate(snapshot.observedAt) : 'Loading…'} />
                    <Metadata label="Current slot" value={formatBigint(snapshot?.protocol.currentSlot)} />
                    <Metadata label="Current epoch" value={formatBigint(snapshot?.protocol.currentEpoch)} />
                    <Metadata label="Current round" value={formatBigint(snapshot?.protocol.currentRound)} />
                    <Metadata
                        label="Quorum per committee position"
                        value={formatNumber(snapshot?.protocol.parameters.quorum)}
                    />
                    <Metadata label="Committee size" value={formatNumber(snapshot?.protocol.parameters.committeeSize)} />
                    <Metadata
                        label="Round"
                        value={snapshot
                            ? `${snapshot.protocol.parameters.slashingRoundSize} slots / ${snapshot.protocol.parameters.slashingRoundSizeInEpochs} epochs`
                            : 'Loading…'}
                    />
                    <Metadata
                        label="Execution delay"
                        value={snapshot
                            ? `${snapshot.protocol.parameters.executionDelayInRounds} rounds`
                            : 'Loading…'}
                    />
                    <Metadata
                        label="Execution lifetime"
                        value={snapshot
                            ? `${snapshot.protocol.parameters.lifetimeInRounds} rounds`
                            : 'Loading…'}
                    />
                    <Metadata
                        label="Slash target offset"
                        value={snapshot
                            ? `${snapshot.protocol.parameters.slashOffsetInRounds} rounds`
                            : 'Loading…'}
                    />
                    <Metadata
                        label="Active stack pause"
                        value={snapshot?.deployment.activeStackPausedUntil
                            ? `Scheduled through ${formatDate(snapshot.deployment.activeStackPausedUntil)}`
                            : 'Not paused'}
                    />
                    <Metadata
                        label="Legacy stack pause"
                        value={snapshot?.deployment.legacyStackPausedUntil
                            ? `Scheduled through ${formatDate(snapshot.deployment.legacyStackPausedUntil)}`
                            : 'Not paused or not authorized'}
                    />
                </MetadataSection>
            </div>
        </details>
    );
}

function MetadataSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section>
            <h2 className="mb-3 text-xl font-black text-aqua">{title}</h2>
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
    return urls.filter(Boolean).join(', ') || 'No default RPC configured';
}

function formatOptionalAddress(value: string | undefined): string {
    return !value || value === zeroAddress ? 'None' : value;
}

function formatBigint(value: bigint | undefined): string {
    return value === undefined ? 'Loading…' : value.toString();
}

function formatNumber(value: number | undefined): string {
    return value === undefined ? 'Loading…' : value.toString();
}

function formatUnixSeconds(value: bigint | undefined): string {
    if (value === undefined) return 'Loading…';
    if (value === 0n) return 'None';
    return formatDate(new Date(Number(value) * 1_000).toISOString());
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString();
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to update the RPC.';
}
