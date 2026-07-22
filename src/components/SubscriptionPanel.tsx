import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { parseAddressList, formatAddressList } from '@/lib/addresses';
import { useNotificationSubscription } from '@/hooks/useNotificationSubscription';
import type { BackendConfig, MonitorNetwork } from '@/types/backendApi';

interface SubscriptionPanelProps {
    network: MonitorNetwork;
    config: BackendConfig | null;
}

export function SubscriptionPanel({ network, config }: SubscriptionPanelProps) {
    const manager = useNotificationSubscription(network, config);
    const maximum = config?.limits.maxSequencers ?? 100;

    const webPushConnected = Boolean(
        manager.subscription?.channels.webPush.enabled &&
        manager.subscription.channels.webPush.verified &&
        manager.pushCapability === 'enabled',
    );
    const webPushPending = Boolean(
        manager.subscription?.channels.webPush.enabled &&
        !manager.subscription.channels.webPush.verified,
    );
    const telegramConnected = Boolean(
        manager.subscription?.channels.telegram.enabled &&
        manager.subscription.channels.telegram.verified &&
        config?.telegram.enabled,
    );
    const telegramPending = Boolean(
        manager.subscription?.channels.telegram.enabled &&
        (!manager.subscription.channels.telegram.verified || !config?.telegram.enabled),
    );
    const hasChannel = Boolean(telegramConnected || webPushConnected);
    const hasPendingChannel = Boolean(telegramPending || webPushPending);

    return (
        <section id="notifications" className="mb-8 border-6 border-chartreuse bg-malachite p-5 shadow-brutal-chartreuse sm:p-7">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="mb-3 inline-flex border-3 border-brand-black bg-chartreuse px-3 py-1 text-xs font-black uppercase text-brand-black">
                        Address-First Alerts
                    </div>
                    <h2 className="text-3xl font-black text-chartreuse">Watch My Sequencers</h2>
                    <p className="mt-2 max-w-3xl text-sm font-bold text-whisper-white">
                        Pick the {network} sequencers first, then connect Telegram, Web Push, or both. Alerts are sent by the backend even when this tab is dead.
                    </p>
                </div>
                <span className={`self-start border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${hasChannel ? 'bg-aqua' : hasPendingChannel ? 'bg-chartreuse' : 'bg-vermillion'}`}>
                    {hasChannel ? 'Alerts Armed' : hasPendingChannel ? 'Channel Checking' : 'No Channel Yet'}
                </span>
            </div>

            {!manager.capabilityOriginSafe && (
                <p className="mb-5 border-3 border-vermillion bg-brand-black p-3 text-sm font-bold text-vermillion" role="alert">
                    This shared github.io origin is public-monitor only. Put Slashmon on a dedicated domain before creating notification watches; sibling Pages projects share browser storage and could otherwise steal the management key.
                </p>
            )}

            <AddressForm
                key={manager.subscription?.id ?? `new-${network}`}
                initialAddresses={manager.subscription?.sequencers ?? []}
                maximum={maximum}
                isBusy={manager.isBusy || manager.isLoading || (!manager.capabilityOriginSafe && !manager.subscription)}
                isExisting={Boolean(manager.subscription)}
                onSave={manager.saveAddresses}
            />

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <ChannelCard
                    title="Telegram"
                    enabled={telegramConnected}
                    pending={telegramPending}
                    available={Boolean(config?.telegram.enabled)}
                    description="Fast mobile and desktop alerts with durable messages in your bot chat. Telegram learns your chat/address association."
                >
                    <button
                        type="button"
                        onClick={manager.createTelegramLink}
                        disabled={!manager.subscription || manager.isBusy || !config?.telegram.enabled}
                        className="brutal-button brutal-button--aqua brutal-button--sm"
                    >
                        {manager.subscription?.channels.telegram.enabled ? 'Relink Telegram' : 'Make One-Time Link'}
                    </button>
                    {manager.telegramLink && (
                        <a
                            href={manager.telegramLink.url}
                            target="_blank"
                            rel="noreferrer"
                            className="brutal-button brutal-button--sm"
                        >
                            Open Telegram
                        </a>
                    )}
                </ChannelCard>

                <ChannelCard
                    title="PWA Web Push"
                    enabled={webPushConnected}
                    pending={webPushPending}
                    available={Boolean(config?.webPush.enabled) && manager.pushCapability !== 'unsupported'}
                    description={pushDescription(manager.pushCapability)}
                >
                    {webPushConnected || webPushPending ? (
                        <button
                            type="button"
                            onClick={manager.disableWebPush}
                            disabled={manager.isBusy}
                            className="brutal-button brutal-button--outline-danger brutal-button--sm"
                        >
                            {webPushPending ? 'Cancel Web Push' : 'Disable Web Push'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={manager.enableWebPush}
                            disabled={!manager.subscription || manager.isBusy || !config?.webPush.enabled || manager.pushCapability === 'unsupported' || manager.pushCapability === 'install-required' || manager.pushCapability === 'permission-denied'}
                            className="brutal-button brutal-button--aqua brutal-button--sm"
                        >
                            Enable Web Push
                        </button>
                    )}
                </ChannelCard>
            </div>

            {manager.subscription && (
                <div className="mt-5 flex flex-col gap-3 border-3 border-chartreuse bg-brand-black p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs font-bold text-whisper-white/65">
                        This browser holds the management key. Slashmon cannot recover it if site data is erased.
                    </p>
                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={manager.refreshSubscription}
                            disabled={manager.isBusy}
                            className="brutal-button brutal-button--outline-aqua brutal-button--sm"
                        >
                            Refresh Channels
                        </button>
                        <button
                            type="button"
                            onClick={manager.sendTest}
                            disabled={manager.isBusy || !hasChannel}
                            className="brutal-button brutal-button--outline-chartreuse brutal-button--sm"
                        >
                            Send Test
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (window.confirm('Delete this watch list and all of its notification endpoints?')) {
                                    void manager.deleteWatch();
                                }
                            }}
                            disabled={manager.isBusy}
                            className="brutal-button brutal-button--outline-danger brutal-button--sm"
                        >
                            Delete Watch
                        </button>
                    </div>
                </div>
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
    const [addressText, setAddressText] = useState(() => formatAddressList(initialAddresses));
    const [validationMessage, setValidationMessage] = useState<string | null>(null);
    const parsed = useMemo(() => parseAddressList(addressText, maximum), [addressText, maximum]);

    const handleSave = async (event: FormEvent) => {
        event.preventDefault();
        if (parsed.errors.length > 0) {
            setValidationMessage(parsed.errors[0]);
            return;
        }
        if (parsed.addresses.length === 0) {
            setValidationMessage('Add at least one sequencer address before saving.');
            return;
        }
        setValidationMessage(null);
        await onSave(parsed.addresses).catch(() => undefined);
    };

    return (
        <form onSubmit={handleSave} className="border-5 border-chartreuse bg-brand-black p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <label htmlFor="watched-sequencers" className="text-sm font-black uppercase text-chartreuse">
                    Sequencer Addresses
                </label>
                <span className="text-xs font-bold text-whisper-white/60">
                    {parsed.addresses.length}/{maximum} unique · spaces, commas, or new lines
                </span>
            </div>
            <textarea
                id="watched-sequencers"
                value={addressText}
                onChange={(event) => {
                    setAddressText(event.target.value);
                    setValidationMessage(null);
                }}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                placeholder={'0x1234…\n0xabcd…'}
                className="mt-3 w-full resize-y border-3 border-chartreuse bg-malachite px-4 py-3 font-mono text-sm font-bold text-whisper-white placeholder:text-whisper-white/35 focus:outline-hidden"
                aria-describedby="sequencer-address-help"
            />
            <div id="sequencer-address-help" className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-bold text-whisper-white/65">
                    The address list is public chain data. Its association with your browser or Telegram account is sensitive.
                </p>
                <button
                    type="submit"
                    disabled={isBusy}
                    className="brutal-button brutal-button--lg shrink-0"
                >
                    {isExisting ? 'Update Watch List' : 'Create Watch List'}
                </button>
            </div>
            {(validationMessage || parsed.errors[0]) && (
                <p className="mt-3 text-sm font-bold text-vermillion" role="alert">
                    {validationMessage ?? parsed.errors[0]}
                </p>
            )}
        </form>
    );
}

function ChannelCard({
    title,
    enabled,
    pending = false,
    available,
    description,
    children,
}: {
    title: string;
    enabled: boolean;
    pending?: boolean;
    available: boolean;
    description: string;
    children: ReactNode;
}) {
    return (
        <article className={`border-5 p-5 ${enabled ? 'border-aqua bg-lapis shadow-brutal-aqua' : 'border-brand-black bg-brand-black shadow-brutal'}`}>
            <div className="flex items-start justify-between gap-3">
                <h3 className={`text-xl font-black ${enabled ? 'text-aqua' : 'text-whisper-white'}`}>{title}</h3>
                <span className={`border-3 border-brand-black px-2 py-1 text-xs font-black uppercase text-brand-black ${enabled ? 'bg-aqua' : pending || available ? 'bg-chartreuse' : 'bg-vermillion'}`}>
                    {enabled ? 'Connected' : pending ? 'Checking' : available ? 'Ready' : 'Unavailable'}
                </span>
            </div>
            <p className="mt-3 min-h-14 text-sm font-bold text-whisper-white/70">{description}</p>
            <div className="mt-4 flex flex-wrap gap-3">{children}</div>
        </article>
    );
}

function pushDescription(capability: ReturnType<typeof useNotificationSubscription>['pushCapability']): string {
    switch (capability) {
        case 'install-required':
            return 'On iPhone or iPad: add Slashmon to your Home Screen, open the installed app, then enable Web Push.';
        case 'permission-denied':
            return 'Notifications are blocked. Re-enable them in browser or operating-system settings first.';
        case 'unsupported':
            return 'This browser does not expose standards-based Web Push. Telegram remains available.';
        case 'enabled':
            return 'Encrypted browser push that works after the page closes. Lock-screen previews may reveal alert text.';
        default:
            return 'Encrypted browser push that works after the page closes. No native Slashmon app required.';
    }
}
