import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    decodeBase64Url,
    enrollInWebPush,
    pushSubscriptionUsesApplicationServerKey,
    requestWebPushPermission,
} from './push';

const VAPID_KEY = 'AQID-v8';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('web push enrollment', () => {
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

    it('reuses an existing subscription created with the expected VAPID key', async () => {
        const browser = installPushBrowser(fakeSubscription(
            'https://push.example/current',
            decodeBase64Url(VAPID_KEY),
        ));

        const enrolled = await enrollInWebPush(VAPID_KEY);

        expect(enrolled.created).toBe(false);
        expect(enrolled.json.endpoint).toBe('https://push.example/current');
        expect(browser.subscribe).not.toHaveBeenCalled();
        expect(browser.retiredEndpoints).toEqual([]);
    });

    it('retires a subscription created with a different VAPID key before subscribing', async () => {
        const browser = installPushBrowser(fakeSubscription(
            'https://push.example/wrong-key',
            new Uint8Array([9, 9, 9]),
        ));

        const enrolled = await enrollInWebPush(VAPID_KEY);

        expect(enrolled.created).toBe(true);
        expect(enrolled.json.endpoint).toBe('https://push.example/fresh-1');
        expect(browser.retiredEndpoints).toEqual(['https://push.example/wrong-key']);
        expect(browser.subscribe).toHaveBeenCalledOnce();
    });

    it('replaces an existing subscription on request', async () => {
        const browser = installPushBrowser(fakeSubscription(
            'https://push.example/stale',
            decodeBase64Url(VAPID_KEY),
        ));

        const enrolled = await enrollInWebPush(VAPID_KEY, { replaceExisting: true });

        expect(enrolled.created).toBe(true);
        expect(browser.retiredEndpoints).toEqual(['https://push.example/stale']);
        expect(enrolled.json.endpoint).toBe('https://push.example/fresh-1');
    });

    it('refuses enrollment without an explicit permission grant when prompts are disabled', async () => {
        const browser = installPushBrowser(null, 'default');

        await expect(enrollInWebPush(VAPID_KEY, { requestPermission: false }))
            .rejects.toThrow(/permission must be granted/);
        expect(browser.requestPermission).not.toHaveBeenCalled();
        expect(browser.subscribe).not.toHaveBeenCalled();
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
