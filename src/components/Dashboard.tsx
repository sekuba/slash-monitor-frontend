import { useState, type FormEvent } from 'react';
import { AddressStatus } from './AddressStatus';
import { MonitorDetails } from './MonitorDetails';
import { NetworkHealth } from './NetworkHealth';
import { parseAddressList, formatAddressList } from '@/lib/addresses';
import {
    loadMonitorAddresses,
    saveMonitorAddresses,
} from '@/lib/monitorAddressStorage';
import { projectMonitorCases } from '@/lib/monitorCases';
import { summarizeNetwork } from '../../shared/protocol/index.ts';
import { useSlashingStore } from '@/store/slashingStore';
import type { MonitorConfigInput } from '@/types/slashing';

interface DashboardProps {
    configInput: MonitorConfigInput;
    network: 'mainnet' | 'testnet';
    onResetRpc: () => void;
    onToggleNetwork: () => void;
    onUpdateRpc: (url: string) => void;
}

export function Dashboard({
    configInput,
    network,
    onResetRpc,
    onToggleNetwork,
    onUpdateRpc,
}: DashboardProps) {
    const store = useSlashingStore();
    const [addresses, setAddresses] = useState(() => loadMonitorAddresses(network));
    const [addressText, setAddressText] = useState(() => formatAddressList(addresses));
    const [addressError, setAddressError] = useState<string | null>(null);
    const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

    const projected = (() => {
        if (!store.config || !store.isInitialized) return null;
        return projectMonitorCases({
            network,
            config: store.config,
            state: store,
            slashings: [...store.detectedSlashings.values()],
            confirmedSlashes: store.confirmedSlashes,
        });
    })();

    const saveAddresses = (event: FormEvent) => {
        event.preventDefault();
        const parsed = parseAddressList(addressText, 100);
        if (parsed.errors.length > 0) {
            setAddressError(parsed.errors[0]);
            return;
        }
        const next = parsed.addresses.map((item) => item.toLowerCase());
        setAddressError(null);
        setAddresses(next);
        saveMonitorAddresses(network, next);
    };

    const controls = (
        <div className="mb-8">
            <MonitorDetails
                key={configInput.chainId}
                configInput={configInput}
                network={network}
                onResetRpc={onResetRpc}
                onToggleNetwork={onToggleNetwork}
                onUpdateRpc={onUpdateRpc}
            />
        </div>
    );

    if (!store.isInitialized) {
        return (
            <main className="mx-auto max-w-7xl px-4 py-8">
                {controls}
                <div className={`mx-auto max-w-2xl border-5 p-8 ${
                    store.initializationError
                        ? 'border-vermillion bg-oxblood shadow-brutal-vermillion'
                        : 'border-chartreuse bg-brand-black text-center shadow-brutal-chartreuse'
                }`}>
                    {store.initializationError ? (
                        <>
                            <h1 className="text-2xl font-black text-vermillion">Monitor unavailable</h1>
                            <p className="mt-3 break-words font-bold text-whisper-white">
                                {store.initializationError}
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="mx-auto mb-4 h-16 w-16 animate-spin border-5 border-chartreuse border-t-transparent" />
                            <p className="font-black uppercase tracking-wider text-chartreuse">
                                Verifying the canonical L1 contracts…
                            </p>
                        </>
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-7xl px-4 py-8">
            {controls}

            <section className="mb-8 border-6 border-aqua bg-lapis p-5 shadow-brutal-aqua sm:p-7">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-aqua">
                    Independent browser monitor
                </p>
                <h1 className="mt-1 text-3xl font-black text-whisper-white">
                    Follow your addresses on the observable L1 path
                </h1>
                <p className="mt-3 max-w-4xl text-sm font-bold text-whisper-white/75">
                    This page uses only the public RPC shown above. It can see L1 votes,
                    payloads, vetoes, execution windows, executed rounds, actual
                    deductions, and current ejection state. It cannot infer an offense
                    reason: reasons require node evidence from PINGME.
                </p>
                <form onSubmit={saveAddresses} className="mt-6">
                    <label htmlFor="monitor-addresses" className="text-xs font-black uppercase text-aqua">
                        Sequencer addresses · stored only in this browser
                    </label>
                    <textarea
                        id="monitor-addresses"
                        value={addressText}
                        onChange={(event) => setAddressText(event.target.value)}
                        rows={Math.max(3, Math.min(8, addressText.split('\n').length))}
                        spellCheck={false}
                        placeholder="0x..."
                        className="mt-2 min-h-32 w-full resize-y border-5 border-brand-black bg-whisper-white p-3 font-mono text-sm font-black text-brand-black shadow-brutal focus:border-chartreuse"
                    />
                    {addressError && (
                        <p className="mt-3 text-sm font-bold text-vermillion" role="alert">
                            {addressError}
                        </p>
                    )}
                    <button type="submit" className="brutal-button mt-4">Show my L1 status</button>
                </form>
            </section>

            {store.audit.status !== 'ok' && (
                <section className="mb-8 border-5 border-vermillion bg-oxblood p-5 shadow-brutal-vermillion">
                    <h2 className="text-xl font-black text-vermillion">L1 evidence may be incomplete</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white/75">
                        {store.audit.issues[0]?.message ?? 'The latest pinned scan was incomplete.'}
                    </p>
                </section>
            )}

            {projected && (
                <NetworkHealth
                    summary={summarizeNetwork(projected.cases)}
                    protocol={projected.protocol}
                />
            )}

            {store.isScanning && (
                <div className="mb-8 border-5 border-aqua bg-lapis p-5 shadow-brutal-aqua">
                    <p className="font-black uppercase text-aqua">
                        Scanning live and historical slashing rounds…
                    </p>
                </div>
            )}

            <div className="grid gap-8">
                {projected && addresses.map((address) => (
                    <AddressStatus
                        key={address}
                        address={address}
                        cases={projected.cases.filter(
                            (item) => item.sequencer === address,
                        )}
                        protocol={projected.protocol}
                        selectedCaseId={selectedCaseId}
                        onSelectCase={setSelectedCaseId}
                    />
                ))}
            </div>

            {addresses.length === 0 && (
                <section className="border-5 border-orchid bg-aubergine p-6 shadow-brutal-orchid">
                    <h2 className="text-2xl font-black text-orchid">Add an address above</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white/75">
                        The network overview is public. Address cards make the protocol
                        path actionable for your own sequencers.
                    </p>
                </section>
            )}
        </main>
    );
}
