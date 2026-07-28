import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { formatAddressList, parseAddressList } from '@/lib/addresses';
import { useWatchlist } from '@/hooks/useWatchlist';
import type { BackendStatus, HealthStatus, PublicConfig } from '@/types/api';

interface WatchlistPanelProps {
    config: PublicConfig;
    notificationHealth: BackendStatus['notifications']['channels'] | null;
}

export function WatchlistPanel({ config, notificationHealth }: WatchlistPanelProps) {
    const network = config.network;
    const manager = useWatchlist(network, config);
    const maximum = config.maxWatchlistAddresses;
    const webPush = manager.watchlist?.channels.webPush;
    const telegram = manager.watchlist?.channels.telegram;
    const webPushHealth = notificationHealth?.webPush.status ?? 'unavailable';
    const telegramHealth = notificationHealth?.telegram.status ?? 'unavailable';
    const webPushLive = Boolean(
        config.channels.webPush.available &&
        webPushHealth === 'healthy' &&
        webPush?.enabled &&
        webPush.verified &&
        manager.pushCapability === 'enabled',
    );
    const telegramLive = Boolean(
        config.channels.telegram.available &&
        telegramHealth === 'healthy' &&
        telegram?.enabled &&
        telegram.verified,
    );
    const hasLiveChannel = webPushLive || telegramLive;
    const hasAvailableChannel =
        config.channels.webPush.available ||
        config.channels.telegram.available;
    const unhealthyConnectedStatuses = [
        webPush?.enabled && webPush.verified ? webPushHealth : null,
        telegram?.enabled && telegram.verified ? telegramHealth : null,
    ].filter((status): status is HealthStatus => status !== null && status !== 'healthy');
    const alertBadge = hasLiveChannel
        ? { label: 'Alerts live', className: 'bg-aqua' }
        : unhealthyConnectedStatuses.includes('degraded')
            ? { label: 'Delivery degraded', className: 'bg-orchid' }
            : unhealthyConnectedStatuses.includes('unavailable')
                ? { label: 'Delivery unavailable', className: 'bg-vermillion' }
                : !hasAvailableChannel
                    ? { label: 'Channels unavailable', className: 'bg-chartreuse' }
                    : manager.watchlist
                        ? { label: 'Connect a channel', className: 'bg-chartreuse' }
                        : { label: 'Not configured', className: 'bg-chartreuse' };

    return (
        <section id="alerts" className="border-6 border-chartreuse bg-malachite p-5 shadow-brutal-chartreuse sm:p-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-chartreuse">
                        Optional notifications
                    </div>
                    <h2 className="mt-1 text-3xl font-black text-whisper-white">Watch validators</h2>
                    <p className="mt-2 text-sm font-bold leading-relaxed text-whisper-white/75">
                        Alerts are intentionally sparse: a new node observation, a tally first reaching slash quorum,
                        execution becoming ready, a final veto or expiry, and confirmed token loss or its reorg correction.
                    </p>
                </div>
                <span className={`self-start border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${alertBadge.className}`}>
                    {alertBadge.label}
                </span>
            </div>

            {!manager.capabilityOriginSafe && (
                <p className="mt-5 border-3 border-vermillion bg-brand-black p-3 text-sm font-bold text-vermillion" role="alert">
                    Alerts are disabled on shared github.io origins because sibling projects can read the same browser storage.
                    Use Slashmon on a dedicated domain to keep the watchlist management key private.
                </p>
            )}

            {hasAvailableChannel || manager.watchlist ? (
                <AddressForm
                    key={manager.watchlist?.id ?? `new-${network}`}
                    initialAddresses={manager.watchlist?.addresses ?? []}
                    maximum={maximum}
                    isBusy={manager.isBusy || manager.isLoading || (!manager.capabilityOriginSafe && !manager.watchlist)}
                    isExisting={Boolean(manager.watchlist)}
                    onSave={manager.saveAddresses}
                />
            ) : (
                <p className="mt-5 border-3 border-orchid bg-brand-black p-4 text-sm font-bold text-orchid">
                    This backend currently offers no notification channel, so a watchlist cannot be created.
                </p>
            )}

            {manager.watchlist && (
                <>
                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <ChannelCard
                            title="Web Push"
                            state={channelState(
                                config.channels.webPush.available,
                                webPushHealth,
                                webPushLive,
                                webPush,
                                manager.pushCapability !== 'enabled',
                            )}
                            description={pushDescription(
                                manager.pushCapability,
                                config.channels.webPush.available,
                                webPushHealth,
                            )}
                        >
                            {!config.channels.webPush.available ? (
                                webPush?.connected && (
                                    <button
                                        type="button"
                                        onClick={manager.disableWebPush}
                                        disabled={manager.isBusy}
                                        className="brutal-button brutal-button--danger brutal-button--sm"
                                    >
                                        Disconnect
                                    </button>
                                )
                            ) : webPush?.connected ? (
                                <>
                                    {(!webPush.enabled || manager.pushCapability !== 'enabled') ? (
                                        <button
                                            type="button"
                                            onClick={manager.enableWebPush}
                                            disabled={
                                                manager.isBusy ||
                                                ['unsupported', 'install-required', 'permission-denied'].includes(manager.pushCapability)
                                            }
                                            className="brutal-button brutal-button--aqua brutal-button--sm"
                                        >
                                            Reconnect Web Push
                                        </button>
                                    ) : !webPush.verified && (
                                        <button
                                            type="button"
                                            onClick={manager.retryWebPushVerification}
                                            disabled={manager.isBusy}
                                            className="brutal-button brutal-button--aqua brutal-button--sm"
                                        >
                                            Retry verification
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={manager.disableWebPush}
                                        disabled={manager.isBusy}
                                        className="brutal-button brutal-button--danger brutal-button--sm"
                                    >
                                        Disconnect
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={manager.enableWebPush}
                                    disabled={
                                        manager.isBusy ||
                                        !config.channels.webPush.available ||
                                        ['unsupported', 'install-required', 'permission-denied'].includes(manager.pushCapability)
                                    }
                                    className="brutal-button brutal-button--aqua brutal-button--sm"
                                >
                                    Enable Web Push
                                </button>
                            )}
                        </ChannelCard>

                        <ChannelCard
                            title="Telegram"
                            state={channelState(
                                config.channels.telegram.available,
                                telegramHealth,
                                telegramLive,
                                telegram,
                            )}
                            description={telegramDescription(
                                config.channels.telegram.available,
                                telegramHealth,
                            )}
                        >
                            {!config.channels.telegram.available ? (
                                telegram?.connected && (
                                    <button
                                        type="button"
                                        onClick={manager.disconnectTelegram}
                                        disabled={manager.isBusy}
                                        className="brutal-button brutal-button--danger brutal-button--sm"
                                    >
                                        Disconnect
                                    </button>
                                )
                            ) : telegram?.connected ? (
                                <button
                                    type="button"
                                    onClick={manager.disconnectTelegram}
                                    disabled={manager.isBusy}
                                    className="brutal-button brutal-button--danger brutal-button--sm"
                                >
                                    Disconnect
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={manager.createTelegramLink}
                                    disabled={manager.isBusy || !config.channels.telegram.available}
                                    className="brutal-button brutal-button--aqua brutal-button--sm"
                                >
                                    Create one-time link
                                </button>
                            )}
                            {manager.telegramLink && (
                                <>
                                    <a
                                        href={manager.telegramLink.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="brutal-button brutal-button--sm"
                                    >
                                        Open Telegram
                                    </a>
                                    <span className="self-center text-xs font-bold text-whisper-white/70">
                                        Link expires {new Date(manager.telegramLink.expiresAt).toLocaleString()}
                                    </span>
                                </>
                            )}
                        </ChannelCard>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 border-3 border-chartreuse bg-brand-black p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs font-bold text-whisper-white/65">
                            This browser stores the management key. A lost key cannot be recovered.
                        </p>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={manager.refreshWatchlist}
                                disabled={manager.isBusy}
                                className="brutal-button brutal-button--aqua brutal-button--sm"
                            >
                                Refresh channels
                            </button>
                            <button
                                type="button"
                                onClick={manager.sendTest}
                                disabled={manager.isBusy || !hasLiveChannel}
                                className="brutal-button brutal-button--sm"
                            >
                                Send test
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (window.confirm('Delete this watchlist and both notification channels?')) {
                                        void manager.deleteWatch();
                                    }
                                }}
                                disabled={manager.isBusy}
                                className="brutal-button brutal-button--danger brutal-button--sm"
                            >
                                Delete watchlist
                            </button>
                        </div>
                    </div>
                </>
            )}

            {(manager.error || manager.notice) && (
                <p
                    className={`mt-5 border-3 bg-brand-black p-3 text-sm font-bold ${manager.error ? 'border-vermillion text-vermillion' : 'border-aqua text-aqua'}`}
                    role={manager.error ? 'alert' : 'status'}
                >
                    {manager.error ?? manager.notice}
                </p>
            )}
        </section>
    );
}

function AddressForm({
    initialAddresses,
    maximum,
    isBusy,
    isExisting,
    onSave,
}: {
    initialAddresses: readonly string[];
    maximum: number;
    isBusy: boolean;
    isExisting: boolean;
    onSave: (addresses: readonly string[]) => Promise<unknown>;
}) {
    const [text, setText] = useState(() => formatAddressList(initialAddresses));
    const [validation, setValidation] = useState<string | null>(null);
    const parsed = useMemo(() => parseAddressList(text, maximum), [maximum, text]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (parsed.errors[0]) {
            setValidation(parsed.errors[0]);
            return;
        }
        if (parsed.addresses.length === 0) {
            setValidation('Add at least one validator address.');
            return;
        }
        setValidation(null);
        await onSave(parsed.addresses).catch(() => undefined);
    };

    return (
        <form onSubmit={submit} className="mt-5 border-5 border-chartreuse bg-brand-black p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
                <label htmlFor="watched-validators" className="text-sm font-black text-chartreuse">
                    Validator addresses
                </label>
                <span className="text-xs font-bold text-whisper-white/60">
                    {parsed.addresses.length}/{maximum} unique
                </span>
            </div>
            <textarea
                id="watched-validators"
                value={text}
                onChange={(event) => {
                    setText(event.target.value);
                    setValidation(null);
                }}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                placeholder={'0x1234…\n0xabcd…'}
                className="mt-3 w-full resize-y border-3 border-chartreuse bg-malachite px-4 py-3 font-mono text-sm font-bold text-whisper-white placeholder:text-whisper-white/35"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-bold text-whisper-white/60">
                    Separate addresses with spaces, commas, or new lines.
                </span>
                <button type="submit" disabled={isBusy} className="brutal-button brutal-button--lg">
                    {isExisting ? 'Update watchlist' : 'Create watchlist'}
                </button>
            </div>
            {(validation || parsed.errors[0]) && (
                <p className="mt-3 text-sm font-bold text-vermillion" role="alert">
                    {validation ?? parsed.errors[0]}
                </p>
            )}
        </form>
    );
}

function ChannelCard({
    title,
    state,
    description,
    children,
}: {
    title: string;
    state: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <section className="border-5 border-aqua bg-lapis p-4 shadow-brutal-aqua">
            <div className="flex items-start justify-between gap-3">
                <h3 className="text-xl font-black text-whisper-white">{title}</h3>
                <span className="border-2 border-aqua px-2 py-1 text-[0.65rem] font-black uppercase text-aqua">
                    {state}
                </span>
            </div>
            <p className="mt-2 text-sm font-bold text-whisper-white/70">{description}</p>
            <div className="mt-4 flex flex-wrap gap-3">{children}</div>
        </section>
    );
}

function pushDescription(
    capability: ReturnType<typeof useWatchlist>['pushCapability'],
    backendAvailable: boolean,
    backendHealth: HealthStatus,
): string {
    if (!backendAvailable) return 'This backend does not offer Web Push.';
    if (backendHealth === 'degraded') {
        return 'Backend Web Push delivery is degraded; connected alerts may be delayed.';
    }
    if (backendHealth !== 'healthy') {
        return 'Current backend Web Push health is unavailable.';
    }
    if (capability === 'install-required') return 'On iPhone or iPad, install Slashmon to the Home Screen first.';
    if (capability === 'permission-denied') return 'Notifications are blocked in this browser’s site settings.';
    if (capability === 'unsupported') return 'This browser does not support Web Push.';
    return 'This browser receives alerts through its current push endpoint.';
}

function channelState(
    backendAvailable: boolean,
    backendHealth: HealthStatus,
    live: boolean,
    channel: { connected: boolean; enabled: boolean; verified: boolean } | undefined,
    localReconnectRequired = false,
): string {
    if (!backendAvailable) return 'Unavailable';
    if (backendHealth === 'degraded') return 'Backend degraded';
    if (backendHealth !== 'healthy') return 'Backend unavailable';
    if (live) return 'Live';
    if (channel?.connected && (!channel.enabled || localReconnectRequired)) {
        return 'Reconnect required';
    }
    if (channel?.connected) return 'Pending verification';
    return 'Not connected';
}

function telegramDescription(
    backendAvailable: boolean,
    backendHealth: HealthStatus,
): string {
    if (!backendAvailable) return 'This backend does not offer Telegram alerts.';
    if (backendHealth === 'degraded') {
        return 'Backend Telegram delivery is degraded; connected alerts may be delayed.';
    }
    if (backendHealth !== 'healthy') {
        return 'Current backend Telegram health is unavailable.';
    }
    return 'Alerts identify watched validators in one private bot chat.';
}
