import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    decodeBase64Url,
    pushSubscriptionUsesApplicationServerKey,
    reconcileWebPushSubscription,
    requestWebPushPermission,
} from './push';

const VAPID_KEY = 'AQID-v8';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('decodeBase64Url', () => {
    it('decodes an unpadded VAPID-style base64url key', () => {
        expect(Array.from(decodeBase64Url(VAPID_KEY))).toEqual([1, 2, 3, 250, 255]);
    });

    it('compares the VAPID key only when the browser reveals it', () => {
        const matching = fakeSubscription('https://push.example/old', decodeBase64Url(VAPID_KEY));
        const mismatched = fakeSubscription('https://push.example/old', new Uint8Array([9, 9, 9]));
        const hidden = fakeSubscription('https://push.example/old', null);

        expect(pushSubscriptionUsesApplicationServerKey(matching, VAPID_KEY)).toBe(true);
        expect(pushSubscriptionUsesApplicationServerKey(mismatched, VAPID_KEY)).toBe(false);
        expect(pushSubscriptionUsesApplicationServerKey(hidden, VAPID_KEY)).toBeNull();
    });

    it('requests explicit permission without first awaiting service-worker state', async () => {
        const browser = installPushBrowser(null, 'default', 'granted');

        await requestWebPushPermission();

        expect(browser.requestPermission).toHaveBeenCalledOnce();
        expect(browser.getRegistration).not.toHaveBeenCalled();
    });

    it('retires a backend-disabled subscription before uploading a fresh endpoint', async () => {
        const browser = installPushBrowser(fakeSubscription(
            'https://push.example/gone',
            decodeBase64Url(VAPID_KEY),
        ));
        const upload = vi.fn(async () => undefined);

        await expect(reconcileWebPushSubscription(
            VAPID_KEY,
            { connected: true, enabled: false },
            upload,
            'https://push.example/gone',
        )).resolves.toBe('replaced');

        expect(browser.retiredEndpoints).toEqual(['https://push.example/gone']);
        expect(browser.subscribe).toHaveBeenCalledOnce();
        expect(upload).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: 'https://push.example/fresh-1',
        }));
    });

    it('replaces a subscription created with a different VAPID key', async () => {
        const browser = installPushBrowser(fakeSubscription(
            'https://push.example/wrong-key',
            new Uint8Array([9, 9, 9]),
        ));
        const upload = vi.fn(async () => undefined);

        await expect(reconcileWebPushSubscription(
            VAPID_KEY,
            { connected: true, enabled: true },
            upload,
            'https://push.example/wrong-key',
        )).resolves.toBe('replaced');

        expect(browser.retiredEndpoints).toEqual(['https://push.example/wrong-key']);
        expect(upload).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: 'https://push.example/fresh-1',
        }));
    });

    it('refreshes a rotated browser endpoint once without replacing it', async () => {
        const browser = installPushBrowser(fakeSubscription(
            'https://push.example/rotated',
            decodeBase64Url(VAPID_KEY),
        ));
        const upload = vi.fn(async () => undefined);

        await expect(reconcileWebPushSubscription(
            VAPID_KEY,
            { connected: true, enabled: true },
            upload,
            'https://push.example/previous',
        )).resolves.toBe('refreshed');

        expect(browser.retiredEndpoints).toEqual([]);
        expect(browser.subscribe).not.toHaveBeenCalled();
        expect(upload).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: 'https://push.example/rotated',
        }));

        upload.mockClear();
        await expect(reconcileWebPushSubscription(
            VAPID_KEY,
            { connected: true, enabled: true },
            upload,
            'https://push.example/rotated',
        )).resolves.toBe('unchanged');
        expect(upload).not.toHaveBeenCalled();
    });

    it('removes a fresh local subscription when its backend upload fails', async () => {
        const browser = installPushBrowser(null);
        const upload = vi.fn(async () => {
            throw new Error('backend offline');
        });

        await expect(reconcileWebPushSubscription(
            VAPID_KEY,
            { connected: true, enabled: true },
            upload,
            null,
        )).rejects.toThrow('backend offline');

        expect(browser.retiredEndpoints).toEqual(['https://push.example/fresh-1']);
    });

    it('does not auto-connect a channel the user never connected', async () => {
        const browser = installPushBrowser(null);
        const upload = vi.fn(async () => undefined);

        await expect(reconcileWebPushSubscription(
            VAPID_KEY,
            { connected: false, enabled: false },
            upload,
            null,
        )).resolves.toBe('not-connected');

        expect(browser.subscribe).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
    });

    it('does not show a permission prompt during foreground repair', async () => {
        const browser = installPushBrowser(null, 'default');
        const upload = vi.fn(async () => undefined);

        await expect(reconcileWebPushSubscription(
            VAPID_KEY,
            { connected: true, enabled: false },
            upload,
            null,
        )).resolves.toBe('permission-required');

        expect(browser.requestPermission).not.toHaveBeenCalled();
        expect(browser.subscribe).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
    });
});

function installPushBrowser(
    initialSubscription: PushSubscription | null,
    permission: NotificationPermission = 'granted',
    requestedPermission: NotificationPermission = permission,
) {
    let subscription = initialSubscription;
    let nextSubscription = 1;
    const retiredEndpoints: string[] = [];
    if (subscription) {
        attachUnsubscribe(subscription, () => {
            retiredEndpoints.push(subscription?.endpoint ?? '');
            subscription = null;
        });
    }

    const subscribe = vi.fn(async (options: PushSubscriptionOptionsInit) => {
        const key = options.applicationServerKey;
        const created = fakeSubscription(
            `https://push.example/fresh-${nextSubscription}`,
            typeof key === 'string' || !key ? null : new Uint8Array(toArrayBuffer(key)),
        );
        nextSubscription += 1;
        attachUnsubscribe(created, () => {
            retiredEndpoints.push(created.endpoint);
            subscription = null;
        });
        subscription = created;
        return created;
    });
    const registration = {
        pushManager: {
            getSubscription: vi.fn(async () => subscription),
            subscribe,
        },
    } as unknown as ServiceWorkerRegistration;
    const requestPermission = vi.fn(async () => requestedPermission);
    const getRegistration = vi.fn(async () => registration);
    const notification = { permission, requestPermission };
    vi.stubGlobal('window', {
        Notification: notification,
        PushManager: class {},
        matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal('Notification', notification);
    vi.stubGlobal('navigator', {
        serviceWorker: {
            getRegistration,
        },
        userAgent: '',
        platform: '',
        maxTouchPoints: 0,
    });

    return { getRegistration, requestPermission, retiredEndpoints, subscribe };
}

function fakeSubscription(endpoint: string, applicationServerKey: Uint8Array<ArrayBuffer> | null): PushSubscription {
    return {
        endpoint,
        expirationTime: null,
        options: applicationServerKey === null ? {} : {
            applicationServerKey: toArrayBuffer(applicationServerKey),
            userVisibleOnly: true,
        },
        toJSON: () => ({
            endpoint,
            expirationTime: null,
            keys: { auth: 'auth-key', p256dh: 'p256dh-key' },
        }),
        unsubscribe: vi.fn(async () => true),
        getKey: vi.fn(() => null),
    } as unknown as PushSubscription;
}

function attachUnsubscribe(subscription: PushSubscription, onUnsubscribe: () => void): void {
    Object.assign(subscription, {
        unsubscribe: vi.fn(async () => {
            onUnsubscribe();
            return true;
        }),
    });
}

function toArrayBuffer(value: BufferSource): ArrayBuffer {
    const bytes = ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value);
    return bytes.slice().buffer;
}
