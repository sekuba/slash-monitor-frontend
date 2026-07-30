import { useCallback, useEffect, useState } from 'react';
import { backendApi } from '@/api/client';
import {
    enrollInWebPush,
    inspectPushCapability,
    requestWebPushPermission,
    unsubscribeFromWebPush,
    type PushCapability,
} from '@/lib/push';
import {
    clearWatchCredentials,
    isWatchStorageSafe,
    loadWatchCredentials,
    saveWatchCredentials,
    signalWatchChanged,
} from '@/lib/watchStorage';
import type {
    BackendConfig,
    ManagedWatch,
    MonitorNetwork,
    TelegramLink,
} from '@/types/backendApi';

export function useNotificationSubscription(
    network: MonitorNetwork,
    config: BackendConfig | null,
) {
    const [credentials, setCredentials] = useState(
        () => loadWatchCredentials(network),
    );
    const [watch, setWatch] = useState<ManagedWatch | null>(null);
    const [pushCapability, setPushCapability] =
        useState<PushCapability>('unsupported');
    const [telegramLink, setTelegramLink] = useState<TelegramLink | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const capabilityOriginSafe = isWatchStorageSafe();

    const refresh = useCallback(async () => {
        if (!credentials) {
            setWatch(null);
            return null;
        }
        const next = await backendApi.getWatch(
            credentials.id,
            credentials.managementToken,
        );
        setWatch(next);
        return next;
    }, [credentials]);

    useEffect(() => {
        void inspectPushCapability().then(setPushCapability);
    }, []);

    useEffect(() => {
        if (!credentials) return;
        const timer = window.setTimeout(() => {
            void refresh().then(
                () => setError(null),
                (caught) => setError(message(caught)),
            );
        }, 0);
        return () => window.clearTimeout(timer);
    }, [credentials, refresh]);

    const run = useCallback(async <T,>(
        action: () => Promise<T>,
        success?: string,
    ): Promise<T | null> => {
        setIsBusy(true);
        setError(null);
        setNotice(null);
        try {
            const result = await action();
            if (success) setNotice(success);
            return result;
        }
        catch (caught) {
            setError(message(caught));
            return null;
        }
        finally {
            setIsBusy(false);
        }
    }, []);

    const saveAddresses = useCallback(async (addresses: readonly string[]) => {
        return await run(async () => {
            if (credentials) {
                const next = await backendApi.updateWatch(
                    credentials.id,
                    credentials.managementToken,
                    addresses,
                );
                setWatch(next);
                signalWatchChanged(network);
                return next;
            }
            if (!capabilityOriginSafe) {
                throw new Error(
                    'PINGME watches require a dedicated origin because the management key is stored in this browser.',
                );
            }
            const created = await backendApi.createWatch(network, addresses);
            const nextCredentials = {
                id: created.watch.id,
                managementToken: created.managementToken,
            };
            saveWatchCredentials(network, nextCredentials);
            setCredentials(nextCredentials);
            setWatch(created.watch);
            return created.watch;
        }, credentials ? 'Sequencer list updated.' : 'Watch created. Choose an alert channel.');
    }, [capabilityOriginSafe, credentials, network, run]);

    const enableWebPush = useCallback(async () => {
        if (!credentials || !config?.notifications.webPush.publicKey) return;
        await run(async () => {
            await requestWebPushPermission();
            const enrollment = await enrollInWebPush(
                config.notifications.webPush.publicKey!,
            );
            const next = await backendApi.setWebPush(
                credentials.id,
                credentials.managementToken,
                enrollment.json,
            );
            setWatch(next);
            setPushCapability(await inspectPushCapability());
        }, 'Web Push connected.');
    }, [config, credentials, run]);

    const disableWebPush = useCallback(async () => {
        if (!credentials) return;
        await run(async () => {
            await backendApi.deleteWebPush(
                credentials.id,
                credentials.managementToken,
            );
            await unsubscribeFromWebPush();
            await refresh();
            setPushCapability(await inspectPushCapability());
        }, 'Web Push disconnected.');
    }, [credentials, refresh, run]);

    const createTelegramLink = useCallback(async () => {
        if (!credentials) return;
        const link = await run(() => backendApi.createTelegramLink(
            credentials.id,
            credentials.managementToken,
        ));
        if (link) setTelegramLink(link);
    }, [credentials, run]);

    const sendTest = useCallback(async () => {
        if (!credentials) return;
        await run(
            () => backendApi.sendTest(credentials.id, credentials.managementToken),
            'Test alert queued.',
        );
    }, [credentials, run]);

    const deleteWatch = useCallback(async () => {
        if (!credentials) return;
        await run(async () => {
            await backendApi.deleteWatch(
                credentials.id,
                credentials.managementToken,
            );
            clearWatchCredentials(network);
            setCredentials(null);
            setWatch(null);
            setTelegramLink(null);
        }, 'Watch deleted from the backend.');
    }, [credentials, network, run]);

    const forgetUnavailableWatch = useCallback(() => {
        clearWatchCredentials(network);
        setCredentials(null);
        setWatch(null);
        setTelegramLink(null);
        setError(null);
        setNotice('Unavailable local watch key removed. You can create a new watch.');
    }, [network]);

    return {
        watch,
        hasCredentials: Boolean(credentials),
        isBusy,
        error,
        notice,
        pushCapability,
        telegramLink,
        capabilityOriginSafe,
        saveAddresses,
        enableWebPush,
        disableWebPush,
        createTelegramLink,
        sendTest,
        deleteWatch,
        forgetUnavailableWatch,
        refresh,
    };
}

function message(value: unknown): string {
    return value instanceof Error ? value.message : 'The backend request failed';
}
