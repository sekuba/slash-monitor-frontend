import { useCallback, useEffect, useRef, useState } from 'react';
import { SlashmonApiError, monitorApi } from '@/api/monitorClient';
import {
    enrollInWebPush,
    getExistingPushSubscription,
    inspectPushCapability,
    reconcileWebPushSubscription,
    requestWebPushPermission,
    unsubscribeFromWebPush,
    type PushCapability,
} from '@/lib/push';
import {
    clearWatchlistCredentials,
    isCapabilityStorageSafeOrigin,
    loadWatchlistCredentials,
    saveWatchlistCredentials,
    signalWatchlistChanged,
    subscribeToWatchlistChanges,
    type StoredWatchlistCredentials,
} from '@/lib/watchlistStorage';
import type {
    MonitorNetwork,
    PublicConfig,
    TelegramLink,
    Watchlist,
    WebPushConnectionResult,
    WebPushVerificationResult,
} from '@/types/api';

const CHANNEL_RECONCILIATION_INTERVAL_MS = 60_000;

export function useWatchlist(network: MonitorNetwork, config: PublicConfig) {
    const capabilityOriginSafe = isCapabilityStorageSafeOrigin();
    const [credentials, setCredentials] = useState<StoredWatchlistCredentials | null>(() => (
        loadWatchlistCredentials(network)
    ));
    const [watchlist, setWatchlist] = useState<Watchlist | null>(null);
    const [pushCapability, setPushCapability] = useState<PushCapability>('unsupported');
    const [telegramLink, setTelegramLink] = useState<TelegramLink | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const reconciliationInFlight = useRef<{ scope: string; promise: Promise<void> } | null>(null);
    const lastUploadedPushEndpoint = useRef<{ scope: string; endpoint: string } | null>(null);
    const webPushOperationTail = useRef<Promise<void>>(Promise.resolve());

    const serializeWebPushOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
        const result = webPushOperationTail.current.then(operation, operation);
        webPushOperationTail.current = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }, []);

    const inspectPush = useCallback(async () => {
        try {
            setPushCapability(await inspectPushCapability());
        }
        catch {
            setPushCapability('unsupported');
        }
    }, []);

    const fetchWatchlist = useCallback(async (
        activeCredentials: StoredWatchlistCredentials,
        reportTransientError = true,
    ): Promise<Watchlist | null> => {
        try {
            const remote = await monitorApi.getWatchlist(
                activeCredentials.id,
                activeCredentials.managementToken,
            );
            setWatchlist(remote);
            setTelegramLink((current) => (
                remote.channels.telegram.connected ||
                (current && Date.parse(current.expiresAt) <= Date.now())
                    ? null
                    : current
            ));
            if (reportTransientError) {
                setError(null);
            }
            return remote;
        }
        catch (caught) {
            if (caught instanceof SlashmonApiError && (caught.status === 401 || caught.status === 404)) {
                clearWatchlistCredentials(network);
                setWatchlist(null);
                setError('The saved watchlist credentials are no longer valid. Create a new watchlist below.');
                return null;
            }
            if (reportTransientError) {
                setError(toErrorMessage(caught));
            }
            return null;
        }
    }, [network]);

    useEffect(() => {
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) {
                return;
            }
            void Promise.all([
                inspectPush(),
                credentials ? fetchWatchlist(credentials) : Promise.resolve(),
            ]).finally(() => {
                if (!cancelled) {
                    setIsLoading(false);
                }
            });
        });
        return () => {
            cancelled = true;
        };
    }, [credentials, fetchWatchlist, inspectPush]);

    useEffect(() => subscribeToWatchlistChanges(network, () => {
        const stored = loadWatchlistCredentials(network);
        setCredentials(stored);
        if (!stored) {
            setWatchlist(null);
            setTelegramLink(null);
        }
    }), [network]);

    useEffect(() => {
        if (!telegramLink) return;
        const remainingMs = Date.parse(telegramLink.expiresAt) - Date.now();
        if (remainingMs <= 0) {
            queueMicrotask(() => setTelegramLink(null));
            return;
        }
        const timer = window.setTimeout(
            () => setTelegramLink(null),
            Math.min(remainingMs, 2_147_483_647),
        );
        return () => window.clearTimeout(timer);
    }, [telegramLink]);

    const reconcileChannels = useCallback((): Promise<void> => {
        if (!credentials) {
            return Promise.resolve();
        }
        const scope = `${network}:${credentials.id}`;
        if (reconciliationInFlight.current?.scope === scope) {
            return reconciliationInFlight.current.promise;
        }
        let task: Promise<void>;
        task = serializeWebPushOperation(async () => {
            const remote = await fetchWatchlist(credentials, false);
            if (!remote) {
                return;
            }
            if (!config.channels.webPush.available || !config.channels.webPush.publicKey) {
                return;
            }
            const publicKey = config.channels.webPush.publicKey;
            let connection: WebPushConnectionResult | null = null;
            const result = await reconcileWebPushSubscription(
                publicKey,
                remote.channels.webPush,
                async (pushSubscription) => {
                    connection = await monitorApi.setWebPush(
                        credentials.id,
                        credentials.managementToken,
                        pushSubscription,
                    );
                    lastUploadedPushEndpoint.current = { scope, endpoint: pushSubscription.endpoint };
                },
                lastUploadedPushEndpoint.current?.scope === scope
                    ? lastUploadedPushEndpoint.current.endpoint
                    : null,
            );
            if (result === 'created' || result === 'replaced' || result === 'refreshed') {
                await fetchWatchlist(credentials, false);
                await inspectPush();
            }
            if (result === 'created' || result === 'replaced') {
                setNotice(connection
                    ? webPushConnectionNotice(connection, 'Web Push endpoint repaired.')
                    : 'Web Push endpoint repaired. Refresh channel state to confirm delivery.');
            }
        }).catch((caught: unknown) => {
            setError(`Web Push needs reconnecting: ${toErrorMessage(caught)}`);
        }).finally(() => {
            if (reconciliationInFlight.current?.scope === scope && reconciliationInFlight.current.promise === task) {
                reconciliationInFlight.current = null;
            }
        });
        reconciliationInFlight.current = { scope, promise: task };
        return task;
    }, [config, credentials, fetchWatchlist, inspectPush, network, serializeWebPushOperation]);

    useEffect(() => {
        if (!credentials) {
            return;
        }

        const runWhileVisible = () => {
            if (document.visibilityState !== 'hidden') {
                void reconcileChannels();
            }
        };
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                void reconcileChannels();
            }
        };

        // A foreground pass picks up Telegram links completed out-of-tab and
        // detects browser-side subscription rotation. Keeping this here
        // (instead of pushsubscriptionchange) means the watchlist management
        // capability never has to enter the service worker.
        runWhileVisible();
        const interval = window.setInterval(runWhileVisible, CHANNEL_RECONCILIATION_INTERVAL_MS);
        window.addEventListener('focus', runWhileVisible);
        window.addEventListener('online', runWhileVisible);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', runWhileVisible);
            window.removeEventListener('online', runWhileVisible);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [config.channels.webPush.available, config.channels.webPush.publicKey, credentials, reconcileChannels]);

    const saveAddresses = useCallback(async (validators: readonly string[]) => {
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            if (credentials) {
                const updated = await monitorApi.updateWatchlist(
                    credentials.id,
                    credentials.managementToken,
                    validators,
                );
                setWatchlist(updated);
                signalWatchlistChanged(network);
                setNotice('Watchlist updated.');
                return updated;
            }

            if (!capabilityOriginSafe) {
                throw new Error('Notification watchlists are disabled on shared github.io origins. Use a dedicated Slashmon domain so sibling sites cannot read the management key.');
            }

            const created = await monitorApi.createWatchlist(validators);
            const nextCredentials = {
                id: created.id,
                managementToken: created.managementToken,
            };
            saveWatchlistCredentials(network, nextCredentials);
            setWatchlist(created);
            setNotice('Watchlist created. Connect at least one notification channel.');
            return created;
        }
        catch (caught) {
            setError(toErrorMessage(caught));
            throw caught;
        }
        finally {
            setIsBusy(false);
        }
    }, [capabilityOriginSafe, credentials, network]);

    const enableWebPush = useCallback(async () => {
        if (!credentials || !watchlist) {
            setError('Save a validator address list before enabling Web Push.');
            return;
        }
        if (!config.channels.webPush.available || !config.channels.webPush.publicKey) {
            setError('Web Push is not enabled on the Slashmon backend.');
            return;
        }
        const publicKey = config.channels.webPush.publicKey;

        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            // Ask while the Enable click still owns transient user activation;
            // Safari can reject prompts delayed by service-worker awaits.
            await requestWebPushPermission();
            const connection = await serializeWebPushOperation(async () => {
                const existing = await getExistingPushSubscription();
                const forceReplacement = Boolean(
                    existing && watchlist.channels.webPush.connected && !watchlist.channels.webPush.enabled,
                );
                const enrolled = await enrollInWebPush(publicKey, {
                    replaceExisting: forceReplacement,
                });
                let activeEnrollment = enrolled;
                let result: WebPushConnectionResult;
                try {
                    result = await monitorApi.setWebPush(
                        credentials.id,
                        credentials.managementToken,
                        activeEnrollment.json,
                    );
                }
                catch (caught) {
                    if (
                        caught instanceof SlashmonApiError &&
                        caught.status === 409 &&
                        caught.code === 'push_endpoint_in_use'
                    ) {
                        // A browser subscription can outlive a locally deleted
                        // watchlist capability. Possession of its endpoint is
                        // not authority to steal it from the old list: retire
                        // it locally, obtain a fresh provider endpoint, and try
                        // the authorized upload once more.
                        await activeEnrollment.subscription.unsubscribe().catch(() => false);
                        activeEnrollment = await enrollInWebPush(publicKey, { replaceExisting: true });
                        try {
                            result = await monitorApi.setWebPush(
                                credentials.id,
                                credentials.managementToken,
                                activeEnrollment.json,
                            );
                        }
                        catch (replacementError) {
                            if (activeEnrollment.created) {
                                await activeEnrollment.subscription.unsubscribe().catch(() => false);
                            }
                            throw replacementError;
                        }
                    }
                    else {
                        if (activeEnrollment.created) {
                            await activeEnrollment.subscription.unsubscribe().catch(() => false);
                        }
                        throw caught;
                    }
                }
                lastUploadedPushEndpoint.current = {
                    scope: `${network}:${credentials.id}`,
                    endpoint: activeEnrollment.json.endpoint,
                };
                setWatchlist(await monitorApi.getWatchlist(
                    credentials.id,
                    credentials.managementToken,
                ));
                await inspectPush();
                return result;
            });
            setNotice(webPushConnectionNotice(connection));
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [config, credentials, inspectPush, network, serializeWebPushOperation, watchlist]);

    const disableWebPush = useCallback(async () => {
        if (!credentials) {
            return;
        }
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            await serializeWebPushOperation(async () => {
                await monitorApi.deleteWebPush(
                    credentials.id,
                    credentials.managementToken,
                );
                await unsubscribeFromWebPush();
                lastUploadedPushEndpoint.current = null;
                setWatchlist(await monitorApi.getWatchlist(
                    credentials.id,
                    credentials.managementToken,
                ));
                await inspectPush();
            });
            setNotice('Web Push disconnected.');
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [credentials, inspectPush, serializeWebPushOperation]);

    const retryWebPushVerification = useCallback(async () => {
        if (!credentials) return;
        setIsBusy(true);
        setError(null);
        try {
            const result = await monitorApi.verifyWebPush(
                credentials.id,
                credentials.managementToken,
            );
            await fetchWatchlist(credentials, false);
            setNotice(webPushVerificationNotice(result));
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [credentials, fetchWatchlist]);

    const createTelegramLink = useCallback(async () => {
        if (!credentials || !watchlist) {
            setError('Save a validator address list before connecting Telegram.');
            return;
        }
        if (!config.channels.telegram.available) {
            setError('Telegram notifications are not enabled on the Slashmon backend.');
            return;
        }
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            const link = await monitorApi.createTelegramLink(
                credentials.id,
                credentials.managementToken,
            );
            setTelegramLink(link);
            setNotice('One-time Telegram link ready. Open it before it expires.');
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [config.channels.telegram.available, credentials, watchlist]);

    const disconnectTelegram = useCallback(async () => {
        if (!credentials) return;
        setIsBusy(true);
        setError(null);
        try {
            await monitorApi.deleteTelegram(credentials.id, credentials.managementToken);
            setTelegramLink(null);
            await fetchWatchlist(credentials, false);
            setNotice('Telegram disconnected.');
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [credentials, fetchWatchlist]);

    const refreshWatchlist = useCallback(async () => {
        if (!credentials) {
            return;
        }
        setIsBusy(true);
        setError(null);
        try {
            await fetchWatchlist(credentials);
            await inspectPush();
            setNotice('Channel state refreshed.');
        }
        finally {
            setIsBusy(false);
        }
    }, [credentials, fetchWatchlist, inspectPush]);

    const sendTest = useCallback(async () => {
        if (!credentials) {
            return;
        }
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            const result = await monitorApi.sendTest(
                credentials.id,
                credentials.managementToken,
            );
            setNotice(
                `Test alert queued for ${result.queued} active channel${result.queued === 1 ? '' : 's'}.`,
            );
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [credentials]);

    const deleteWatch = useCallback(async () => {
        if (!credentials) {
            return;
        }
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            await serializeWebPushOperation(async () => {
                await monitorApi.deleteWatchlist(credentials.id, credentials.managementToken);
                await unsubscribeFromWebPush().catch(() => false);
                lastUploadedPushEndpoint.current = null;
            });
            clearWatchlistCredentials(network);
            setWatchlist(null);
            setTelegramLink(null);
            await inspectPush();
            setNotice('Watchlist and notification endpoints deleted.');
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [credentials, inspectPush, network, serializeWebPushOperation]);

    return {
        watchlist,
        pushCapability,
        telegramLink,
        isBusy,
        isLoading,
        error,
        notice,
        capabilityOriginSafe,
        saveAddresses,
        enableWebPush,
        disableWebPush,
        retryWebPushVerification,
        createTelegramLink,
        disconnectTelegram,
        refreshWatchlist,
        sendTest,
        deleteWatch,
    };
}

function toErrorMessage(error: unknown): string {
    if (error instanceof SlashmonApiError && error.retryAfterMs !== null) {
        return `${error.message} Try again in ${formatRetryDelay(error.retryAfterMs)}.`;
    }
    return error instanceof Error
        ? error.message
        : 'The notification backend did not accept that request';
}

function webPushConnectionNotice(
    result: WebPushConnectionResult,
    prefix = 'Web Push connected.',
): string {
    if (result.verified) {
        return `${prefix} The endpoint is verified and alerts are live.`;
    }
    if (result.verificationQueued > 0) {
        return `${prefix} A verification alert was queued; alerts activate after it is delivered.`;
    }
    return `${prefix} A verification alert is already pending.`;
}

function webPushVerificationNotice(result: WebPushVerificationResult): string {
    if (result.verified) {
        return 'Web Push is already verified and alerts are live.';
    }
    return result.queued > 0
        ? 'A fresh Web Push verification alert was queued.'
        : 'A Web Push verification alert is already pending.';
}

function formatRetryDelay(delayMs: number): string {
    let remainingSeconds = Math.max(1, Math.ceil(delayMs / 1_000));
    const units = [
        ['day', 86_400],
        ['hour', 3_600],
        ['minute', 60],
        ['second', 1],
    ] as const;
    const parts: string[] = [];
    for (const [label, seconds] of units) {
        const count = Math.floor(remainingSeconds / seconds);
        if (count === 0) continue;
        parts.push(`${count} ${label}${count === 1 ? '' : 's'}`);
        remainingSeconds %= seconds;
    }
    return parts.join(' ');
}
