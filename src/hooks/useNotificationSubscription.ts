import { useCallback, useEffect, useRef, useState } from 'react';
import { SlashmonApiError, slashmonApi } from '@/api/client';
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
    clearSubscriptionCredentials,
    isCapabilityStorageSafeOrigin,
    loadSubscriptionCredentials,
    saveSubscriptionCredentials,
    signalSubscriptionScopeChanged,
    subscribeToSubscriptionScope,
    type StoredSubscriptionCredentials,
} from '@/lib/subscriptionStorage';
import type { BackendConfig, ManagedSubscription, MonitorNetwork, TelegramLink } from '@/types/backendApi';

const CHANNEL_RECONCILIATION_INTERVAL_MS = 60_000;

export function useNotificationSubscription(network: MonitorNetwork, config: BackendConfig | null) {
    const capabilityOriginSafe = isCapabilityStorageSafeOrigin();
    const [credentials, setCredentials] = useState<StoredSubscriptionCredentials | null>(() => (
        loadSubscriptionCredentials(network)
    ));
    const [subscription, setSubscription] = useState<ManagedSubscription | null>(null);
    const [pushCapability, setPushCapability] = useState<PushCapability>('unsupported');
    const [telegramLink, setTelegramLink] = useState<TelegramLink | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const reconciliationInFlight = useRef<{ scope: string; promise: Promise<void> } | null>(null);
    const lastUploadedPushEndpoint = useRef<{ scope: string; endpoint: string } | null>(null);
    const webPushOperationTail = useRef<Promise<void>>(Promise.resolve());

    const serializeWebPushOperation = useCallback((operation: () => Promise<void>): Promise<void> => {
        const result = webPushOperationTail.current.then(operation, operation);
        webPushOperationTail.current = result.catch(() => undefined);
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

    const fetchSubscription = useCallback(async (
        activeCredentials: StoredSubscriptionCredentials,
        reportTransientError = true,
    ): Promise<ManagedSubscription | null> => {
        try {
            const remote = await slashmonApi.getSubscription(
                activeCredentials.id,
                activeCredentials.managementToken,
            );
            setSubscription(remote);
            if (reportTransientError) {
                setError(null);
            }
            return remote;
        }
        catch (caught) {
            if (caught instanceof SlashmonApiError && (caught.status === 401 || caught.status === 404)) {
                clearSubscriptionCredentials(network);
                setSubscription(null);
                setError('This browser no longer has the key for its old watch list. Create a fresh one below.');
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
                credentials ? fetchSubscription(credentials) : Promise.resolve(),
            ]).finally(() => {
                if (!cancelled) {
                    setIsLoading(false);
                }
            });
        });
        return () => {
            cancelled = true;
        };
    }, [credentials, fetchSubscription, inspectPush]);

    useEffect(() => subscribeToSubscriptionScope(network, () => {
        const stored = loadSubscriptionCredentials(network);
        setCredentials(stored);
        if (!stored) {
            setSubscription(null);
            setTelegramLink(null);
        }
    }), [network]);

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
            const remote = await fetchSubscription(credentials, false);
            if (!remote) {
                return;
            }
            if (!config?.webPush.enabled || !config.webPush.publicKey) {
                return;
            }
            const publicKey = config.webPush.publicKey;
            const result = await reconcileWebPushSubscription(
                publicKey,
                remote.channels.webPush,
                async (pushSubscription) => {
                    await slashmonApi.setWebPushChannel(
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
                await fetchSubscription(credentials, false);
                await inspectPush();
            }
            if (result === 'created' || result === 'replaced') {
                setNotice('Web Push endpoint repaired. The wire is live again.');
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
    }, [config, credentials, fetchSubscription, inspectPush, network, serializeWebPushOperation]);

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
        // (instead of pushsubscriptionchange) means the watch-list management
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
    }, [config?.webPush.enabled, config?.webPush.publicKey, credentials, reconcileChannels]);

    const saveAddresses = useCallback(async (sequencers: readonly string[]) => {
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            if (credentials) {
                const updated = await slashmonApi.updateSubscription(
                    credentials.id,
                    credentials.managementToken,
                    sequencers,
                );
                setSubscription(updated);
                signalSubscriptionScopeChanged(network);
                setNotice('Watch list updated. The backend is on it.');
                return updated;
            }

            if (!capabilityOriginSafe) {
                throw new Error('Notification watch lists are disabled on shared github.io origins. Use a dedicated Slashmon domain so sibling sites cannot read the management key.');
            }

            const created = await slashmonApi.createSubscription(network, sequencers);
            const nextCredentials = {
                id: created.subscription.id,
                managementToken: created.managementToken,
            };
            saveSubscriptionCredentials(network, nextCredentials);
            setSubscription(created.subscription);
            setNotice('Watch list created. Connect at least one notification channel.');
            return created.subscription;
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
        if (!credentials || !subscription) {
            setError('Save a sequencer address list before enabling Web Push.');
            return;
        }
        if (!config?.webPush.enabled || !config.webPush.publicKey) {
            setError('Web Push is not enabled on the Slashmon backend.');
            return;
        }
        const publicKey = config.webPush.publicKey;

        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            // Ask while the Enable click still owns transient user activation;
            // Safari can reject prompts delayed by service-worker awaits.
            await requestWebPushPermission();
            await serializeWebPushOperation(async () => {
                const existing = await getExistingPushSubscription();
                const forceReplacement = Boolean(
                    existing && subscription.channels.webPush.connected && !subscription.channels.webPush.enabled,
                );
                const enrolled = await enrollInWebPush(publicKey, {
                    replaceExisting: forceReplacement,
                });
                let activeEnrollment = enrolled;
                try {
                    await slashmonApi.setWebPushChannel(
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
                        // watch-list capability. Possession of its endpoint is
                        // not authority to steal it from the old list: retire
                        // it locally, obtain a fresh provider endpoint, and try
                        // the authorized upload once more.
                        await activeEnrollment.subscription.unsubscribe().catch(() => false);
                        activeEnrollment = await enrollInWebPush(publicKey, { replaceExisting: true });
                        try {
                            await slashmonApi.setWebPushChannel(
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
                setSubscription(await slashmonApi.getSubscription(
                    credentials.id,
                    credentials.managementToken,
                ));
                await inspectPush();
            });
            setNotice('Web Push verification queued. The channel arms after the private test ping lands.');
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [config, credentials, inspectPush, network, serializeWebPushOperation, subscription]);

    const disableWebPush = useCallback(async () => {
        if (!credentials) {
            return;
        }
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            await serializeWebPushOperation(async () => {
                await slashmonApi.deleteWebPushChannel(
                    credentials.id,
                    credentials.managementToken,
                );
                await unsubscribeFromWebPush();
                lastUploadedPushEndpoint.current = null;
                setSubscription(await slashmonApi.getSubscription(
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

    const createTelegramLink = useCallback(async () => {
        if (!credentials || !subscription) {
            setError('Save a sequencer address list before connecting Telegram.');
            return;
        }
        if (!config?.telegram.enabled) {
            setError('Telegram notifications are not enabled on the Slashmon backend.');
            return;
        }
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            const link = await slashmonApi.createTelegramLink(
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
    }, [config?.telegram.enabled, credentials, subscription]);

    const refreshSubscription = useCallback(async () => {
        if (!credentials) {
            return;
        }
        setIsBusy(true);
        setError(null);
        try {
            await fetchSubscription(credentials);
            await inspectPush();
            setNotice('Channel state refreshed.');
        }
        finally {
            setIsBusy(false);
        }
    }, [credentials, fetchSubscription, inspectPush]);

    const sendTest = useCallback(async () => {
        if (!credentials) {
            return;
        }
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            await slashmonApi.sendTest(credentials.id, credentials.managementToken);
            setNotice('Test alert queued. Give the delivery pipes a moment.');
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
                await slashmonApi.deleteSubscription(credentials.id, credentials.managementToken);
                await unsubscribeFromWebPush().catch(() => false);
                lastUploadedPushEndpoint.current = null;
            });
            clearSubscriptionCredentials(network);
            setSubscription(null);
            setTelegramLink(null);
            await inspectPush();
            setNotice('Watch list and notification endpoints deleted.');
        }
        catch (caught) {
            setError(toErrorMessage(caught));
        }
        finally {
            setIsBusy(false);
        }
    }, [credentials, inspectPush, network, serializeWebPushOperation]);

    return {
        subscription,
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
        createTelegramLink,
        refreshSubscription,
        sendTest,
        deleteWatch,
    };
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The notification backend did not accept that request';
}
