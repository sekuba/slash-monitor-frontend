import { useState, type FormEvent, type ReactNode } from 'react';
import { parseAddressList, formatAddressList } from '@/lib/addresses';
import { urlForWatchlist } from '@/lib/navigation';
import { useNotificationSubscription } from '@/hooks/useNotificationSubscription';
import { ShareButton } from './ShareButton';
import type { BackendConfig, MonitorNetwork } from '@/types/backendApi';

export function WatchSettings({
    network,
    config,
    linkedAddresses,
    onWatchlistChange,
}: {
    network: MonitorNetwork;
    config: BackendConfig | null;
    linkedAddresses: string[];
    onWatchlistChange: (addresses: readonly string[]) => void;
}) {
    const manager = useNotificationSubscription(network, config);
    const [draft, setDraft] = useState<{
        watchVersion: string;
        value: string;
    } | null>(null);
    const [validation, setValidation] = useState<string | null>(null);
    const savedAddresses = manager.watch?.addresses ?? [];
    const addresses = linkedAddresses.length > 0 ? linkedAddresses : savedAddresses;
    const watchVersion = [
        manager.watch?.updatedAt ?? 'new',
        linkedAddresses.join(','),
    ].join(':');
    const value = draft?.watchVersion === watchVersion
        ? draft.value
        : formatAddressList(addresses);
    const webPush = manager.watch?.endpoints.find((item) => item.kind === 'web_push');
    const telegram = manager.watch?.endpoints.find((item) => item.kind === 'telegram');
    const viewingDifferentSharedList = linkedAddresses.length > 0 &&
        !sameAddresses(linkedAddresses, savedAddresses);
    const shareUrl = addresses.length > 0 && typeof window !== 'undefined'
        ? urlForWatchlist(window.location.href, 'pingme', network, addresses).href
        : null;

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const parsed = parseAddressList(value, config?.maxSequencers ?? 100);
        if (parsed.errors.length > 0 || parsed.addresses.length === 0) {
            setValidation(parsed.errors[0] ?? 'Enter at least one sequencer address.');
            return;
        }
        setValidation(null);
        const saved = await manager.saveAddresses(parsed.addresses);
        if (saved) onWatchlistChange(parsed.addresses);
    };

    return (
        <section className="mb-8 border-6 border-chartreuse bg-malachite p-5 shadow-brutal-chartreuse sm:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="text-3xl font-black text-whisper-white">
                        Sequencers to watch
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm font-bold text-whisper-white/70">
                        PINGME links each address’s node and L1 evidence into one timeline.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {shareUrl && (
                        <div className="flex items-center gap-1">
                            <ShareButton
                                url={shareUrl}
                                ariaLabel="Copy link to this PINGME watchlist"
                                className="h-11 w-11 border-3 border-aqua"
                            />
                            <span className="text-xs font-black uppercase text-aqua">
                                Share watchlist
                            </span>
                        </div>
                    )}
                    <span className={`w-fit border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${
                        viewingDifferentSharedList
                            ? 'bg-orchid'
                            : webPush?.enabled || telegram?.enabled
                                ? 'bg-aqua'
                                : 'bg-chartreuse'
                    }`}>
                        {viewingDifferentSharedList
                            ? 'Shared list'
                            : webPush?.enabled || telegram?.enabled
                                ? 'Alerts live'
                                : 'Status only'}
                    </span>
                </div>
            </div>

            {!manager.capabilityOriginSafe && (
                <p className="mt-5 border-3 border-vermillion bg-oxblood p-3 text-sm font-bold text-vermillion">
                    This shared github.io origin cannot safely store a private watch key.
                    Use a dedicated origin for PINGME.
                </p>
            )}
            {viewingDifferentSharedList && (
                <p className="mt-5 border-3 border-orchid bg-aubergine p-3 text-sm font-bold text-whisper-white">
                    You are viewing addresses from a public link. Your private PINGME
                    watch and notification channels have not changed. Submit this list
                    below only if you want to replace your saved watch.
                </p>
            )}

            <form onSubmit={submit} className="mt-6">
                <label className="block text-xs font-black uppercase text-chartreuse" htmlFor="watch-addresses">
                    Sequencer addresses · one per line
                </label>
                <textarea
                    id="watch-addresses"
                    value={value}
                    onChange={(event) => setDraft({
                        watchVersion,
                        value: event.target.value,
                    })}
                    rows={Math.max(3, Math.min(8, value.split('\n').length))}
                    spellCheck={false}
                    placeholder="0x..."
                    className="mt-2 min-h-32 w-full resize-y border-5 border-brand-black bg-whisper-white p-3 font-mono text-sm font-black text-brand-black shadow-brutal focus:border-aqua"
                />
                {(validation || manager.error) && (
                    <p className="mt-3 break-words text-sm font-bold text-vermillion" role="alert">
                        {validation ?? manager.error}
                    </p>
                )}
                {manager.notice && (
                    <p className="mt-3 text-sm font-bold text-aqua" role="status">
                        {manager.notice}
                    </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                    <button
                        type="submit"
                        disabled={manager.isBusy || !manager.capabilityOriginSafe}
                        className="brutal-button"
                    >
                        {viewingDifferentSharedList
                            ? 'Use as my PINGME watch'
                            : manager.watch
                                ? 'Update addresses'
                                : 'Create watch'}
                    </button>
                    {manager.watch && (
                        <button
                            type="button"
                            disabled={manager.isBusy}
                            onClick={() => void manager.deleteWatch()}
                            className="brutal-button brutal-button--danger"
                        >
                            Delete watch
                        </button>
                    )}
                    {!manager.watch && manager.hasCredentials && manager.error && (
                        <button
                            type="button"
                            disabled={manager.isBusy}
                            onClick={manager.forgetUnavailableWatch}
                            className="brutal-button brutal-button--danger"
                        >
                            Forget unavailable watch
                        </button>
                    )}
                </div>
            </form>

            {manager.watch && (
                <div className="mt-7 grid gap-5 lg:grid-cols-2">
                    <Channel
                        title="Web Push"
                        connected={Boolean(webPush?.enabled)}
                        description={pushDescription(manager.pushCapability)}
                    >
                        <button
                            type="button"
                            disabled={
                                manager.isBusy ||
                                !config?.notifications.webPush.enabled
                            }
                            onClick={() => void (
                                webPush?.enabled
                                    ? manager.disableWebPush()
                                    : manager.enableWebPush()
                            )}
                            className="brutal-button brutal-button--aqua brutal-button--sm"
                        >
                            {webPush?.enabled ? 'Disconnect' : 'Connect Web Push'}
                        </button>
                    </Channel>
                    <Channel
                        title="Telegram"
                        connected={Boolean(telegram?.enabled)}
                        description="Receive the same exact case transitions in a private bot chat."
                    >
                        <button
                            type="button"
                            disabled={
                                manager.isBusy ||
                                !config?.notifications.telegram.enabled
                            }
                            onClick={() => void manager.createTelegramLink()}
                            className="brutal-button brutal-button--aqua brutal-button--sm"
                        >
                            {telegram?.enabled ? 'Relink Telegram' : 'Create one-time link'}
                        </button>
                        {manager.telegramLink && (
                            <a
                                className="brutal-button brutal-button--orchid brutal-button--sm"
                                href={manager.telegramLink.url}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Open Telegram
                            </a>
                        )}
                    </Channel>
                    <div className="lg:col-span-2">
                        <button
                            type="button"
                            disabled={manager.isBusy || !(webPush?.enabled || telegram?.enabled)}
                            onClick={() => void manager.sendTest()}
                            className="brutal-button brutal-button--neutral brutal-button--sm"
                        >
                            Send test alert
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}

function sameAddresses(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every((item) => rightSet.has(item));
}

function Channel({
    title,
    connected,
    description,
    children,
}: {
    title: string;
    connected: boolean;
    description: string;
    children: ReactNode;
}) {
    return (
        <article className={`border-5 p-5 ${
            connected
                ? 'border-aqua bg-lapis shadow-brutal-aqua'
                : 'border-brand-black bg-brand-black shadow-brutal'
        }`}>
            <div className="flex items-start justify-between gap-3">
                <h3 className={connected ? 'text-aqua' : 'text-whisper-white'}>{title}</h3>
                <span className={`border-3 border-brand-black px-2 py-1 text-xs font-black uppercase text-brand-black ${
                    connected ? 'bg-aqua' : 'bg-chartreuse'
                }`}>
                    {connected ? 'Connected' : 'Optional'}
                </span>
            </div>
            <p className="mt-3 min-h-12 text-sm font-bold text-whisper-white/70">
                {description}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">{children}</div>
        </article>
    );
}

function pushDescription(capability: ReturnType<typeof useNotificationSubscription>['pushCapability']) {
    if (capability === 'install-required') {
        return 'On iPhone or iPad, install Slashmon to the Home Screen first.';
    }
    if (capability === 'permission-denied') return 'Browser notifications are blocked.';
    if (capability === 'unsupported') return 'Web Push is unavailable in this browser.';
    return 'Browser alerts arrive even after this page closes.';
}
