import { useEffect, useState, type FormEvent } from 'react';
import { AddressStatus } from './AddressStatus';
import { CaseFeed } from './CaseFeed';
import { CaseTimeline } from './CaseTimeline';
import { MonitorDetails } from './MonitorDetails';
import { NetworkHealth } from './NetworkHealth';
import { ShareButton } from './ShareButton';
import { parseAddressList, formatAddressList } from '@/lib/addresses';
import {
    loadMonitorAddresses,
    saveMonitorAddresses,
} from '@/lib/monitorAddressStorage';
import { projectMonitorCases } from '@/lib/monitorCases';
import { selectCaseFeed } from '@/lib/caseFeed';
import { urlForWatchlist } from '@/lib/navigation';
import { summarizeNetwork } from '../../shared/protocol/index.ts';
import { useSlashingStore } from '@/store/slashingStore';
import type { MonitorConfigInput } from '@/types/slashing';
import type { ProtocolSnapshot } from '../../shared/protocol/index.ts';

interface DashboardProps {
    configInput: MonitorConfigInput;
    network: 'mainnet' | 'testnet';
    linkedAddresses: string[];
    selectedCaseId: string | null;
    onResetRpc: () => void;
    onToggleNetwork: () => void;
    onUpdateRpc: (url: string) => void;
    onWatchlistChange: (addresses: readonly string[]) => void;
    onOpenProtocolGuide: (protocol: ProtocolSnapshot | null) => void;
    onProtocolChange: (protocol: ProtocolSnapshot | null) => void;
}

export function Dashboard({
    configInput,
    network,
    linkedAddresses,
    selectedCaseId,
    onResetRpc,
    onToggleNetwork,
    onUpdateRpc,
    onWatchlistChange,
    onOpenProtocolGuide,
    onProtocolChange,
}: DashboardProps) {
    const store = useSlashingStore();
    const [addresses, setAddresses] = useState(() =>
        linkedAddresses.length > 0
            ? linkedAddresses
            : loadMonitorAddresses(network));
    const [addressText, setAddressText] = useState(() => formatAddressList(addresses));
    const [addressError, setAddressError] = useState<string | null>(null);

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

    useEffect(() => {
        onProtocolChange(projected?.protocol ?? null);
    }, [onProtocolChange, projected?.protocol]);

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
        onWatchlistChange(next);
    };
    const watchlistUrl = addresses.length > 0 && typeof window !== 'undefined'
        ? urlForWatchlist(window.location.href, 'monitor', network, addresses).href
        : null;
    const selectedCase = projected && selectedCaseId
        ? projected.cases.find((item) => item.id === selectedCaseId) ?? null
        : null;
    const feedCaseIds = new Set(projected
        ? Object.values(selectCaseFeed(projected.cases)).flat().map((item) => item.id)
        : []);
    const selectedInFeed = selectedCaseId ? feedCaseIds.has(selectedCaseId) : false;
    const selectedInWatchlist = selectedCase
        ? addresses.includes(selectedCase.sequencer)
        : false;

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

            <section className="mb-8 border-6 border-aqua bg-lapis p-4 shadow-brutal-aqua sm:p-5">
                <h1 className="text-3xl font-black text-whisper-white">
                    Filter by Sequencer
                </h1>
                <p className="mt-2 max-w-4xl text-sm font-bold text-whisper-white/75">
                    This page uses the public RPC shown above. Switch to the pingme
                    section to receive push notifications for slashings targeting your
                    sequencers.
                </p>
                <form onSubmit={saveAddresses} className="mt-4">
                    <label htmlFor="monitor-addresses" className="text-xs font-black uppercase text-aqua">
                        Sequencer addresses
                    </label>
                    <textarea
                        id="monitor-addresses"
                        value={addressText}
                        onChange={(event) => setAddressText(event.target.value)}
                        rows={Math.max(2, Math.min(8, addressText.split('\n').length))}
                        spellCheck={false}
                        placeholder="0x..."
                        className="mt-2 min-h-24 w-full resize-y border-5 border-aqua bg-brand-black p-3 font-mono text-sm font-black text-whisper-white shadow-brutal-aqua focus:border-chartreuse"
                    />
                    {addressError && (
                        <p className="mt-3 text-sm font-bold text-vermillion" role="alert">
                            {addressError}
                        </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button type="submit" className="brutal-button">Filter</button>
                        {watchlistUrl && (
                            <div className="flex items-center gap-1">
                                <ShareButton
                                    url={watchlistUrl}
                                    ariaLabel="Copy link to this Monitor watchlist"
                                    className="h-11 w-11 border-3 border-aqua"
                                />
                                <span className="text-xs font-black uppercase text-aqua">
                                    Share watchlist
                                </span>
                            </div>
                        )}
                    </div>
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

            {projected && selectedCase && !selectedInFeed && !selectedInWatchlist && (
                <section className="mb-8">
                    <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-aqua">
                        Shared case
                    </p>
                    <CaseTimeline
                        item={selectedCase}
                        protocol={projected.protocol}
                        selected
                        showSequencer
                        onOpenProtocolGuide={onOpenProtocolGuide}
                    />
                </section>
            )}

            <div className="grid gap-8">
                {projected && addresses.map((address) => (
                    <AddressStatus
                        key={address}
                        address={address}
                        network={network}
                        cases={projected.cases.filter(
                            (item) => item.sequencer === address,
                        )}
                        protocol={projected.protocol}
                        selectedCaseId={selectedInFeed ? null : selectedCaseId}
                        onOpenProtocolGuide={onOpenProtocolGuide}
                    />
                ))}
            </div>

            {addresses.length === 0 && (
                <section className="mb-8 border-5 border-orchid bg-aubergine p-6 shadow-brutal-orchid">
                    <h2 className="text-2xl font-black text-orchid">Add an address above</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white/75">
                        The network overview is public. Address cards make the protocol
                        path actionable for your own sequencers.
                    </p>
                </section>
            )}

            {projected && (
                <CaseFeed
                    cases={projected.cases}
                    protocol={projected.protocol}
                    selectedCaseId={selectedCaseId}
                    evidenceMode="l1"
                    onOpenProtocolGuide={onOpenProtocolGuide}
                />
            )}
        </main>
    );
}
