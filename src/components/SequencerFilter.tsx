import { useState, type FormEvent } from 'react';
import { ShareButton } from './ShareButton';
import { parseAddressList, formatAddressList } from '@/lib/addresses';

export function SequencerFilter({
    addresses,
    watchlistUrl,
    onSave,
}: {
    addresses: readonly string[];
    watchlistUrl: string | null;
    onSave: (addresses: string[]) => void;
}) {
    const [addressText, setAddressText] = useState(() => formatAddressList(addresses));
    const [addressError, setAddressError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<boolean | null>(null);
    const open = expanded ?? (addresses.length === 0 || addressError !== null);

    const save = (event: FormEvent) => {
        event.preventDefault();
        const parsed = parseAddressList(addressText, 100);
        if (parsed.errors.length > 0) {
            setAddressError(parsed.errors[0]);
            return;
        }
        setAddressError(null);
        setExpanded(null);
        onSave(parsed.addresses.map((item) => item.toLowerCase()));
    };

    return (
        <details
            open={open}
            onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                if (isOpen !== open) setExpanded(isOpen);
            }}
            className="group mb-8 border-6 border-chartreuse bg-malachite shadow-brutal-chartreuse"
        >
            <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
                <h1 className="text-3xl font-black text-whisper-white">
                    Filter by Sequencer
                </h1>
                <div className="flex items-center gap-3">
                    {addresses.length > 0 && (
                        <span className="border-3 border-brand-black bg-chartreuse px-3 py-2 text-xs font-black uppercase text-brand-black">
                            {addresses.length} watched
                        </span>
                    )}
                    <span className="text-sm font-black uppercase text-chartreuse" aria-hidden="true">
                        <span className="group-open:hidden">Open +</span>
                        <span className="hidden group-open:inline">Close −</span>
                    </span>
                </div>
            </summary>
            <div className="border-t-3 border-chartreuse/40 p-4 pt-3 sm:p-5 sm:pt-4">
                <p className="max-w-4xl text-sm font-bold text-whisper-white/75">
                    This page uses the public RPC shown above. Switch to the pingme
                    section to receive push notifications for slashings targeting your
                    sequencers.
                </p>
                <form onSubmit={save} className="mt-4">
                    <label htmlFor="monitor-addresses" className="text-xs font-black uppercase text-chartreuse">
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
            </div>
        </details>
    );
}
