import { getPushServiceWorker } from './serviceWorker';

export interface WebPushSubscriptionJson {
    endpoint: string;
    expirationTime: number | null;
    keys: {
        auth: string;
        p256dh: string;
    };
}

export type PushCapability =
    | 'available'
    | 'enabled'
    | 'permission-denied'
    | 'install-required'
    | 'unsupported';

interface WebPushEnrollmentOptions {
    replaceExisting?: boolean;
    requestPermission?: boolean;
}

export async function inspectPushCapability(): Promise<PushCapability> {
    const unavailable = inspectStaticPushCapability();
    if (unavailable) return unavailable;

    const registration = await getPushServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? 'enabled' : 'available';
}

export async function enrollInWebPush(
    applicationServerKey: string,
    options: WebPushEnrollmentOptions = {},
): Promise<{
    subscription: PushSubscription;
    json: WebPushSubscriptionJson;
    created: boolean;
}> {
    if (!applicationServerKey.trim()) {
        throw new Error('The slashveto.me backend has not published a Web Push key');
    }

    assertPushEnvironmentAvailable();
    if (options.requestPermission === false) {
        if (Notification.permission !== 'granted') {
            throw new Error('Notification permission must be granted before Web Push can be repaired');
        }
    }
    else {
        // Calling requestPermission is the first asynchronous browser action in
        // this path. Explicit enrollment can therefore retain Safari/iOS user
        // activation instead of losing it to service-worker lookups.
        await requestWebPushPermission();
    }

    const registration = await getPushServiceWorker();
    let existing = await registration.pushManager.getSubscription();
    const keyMatch = existing
        ? pushSubscriptionUsesApplicationServerKey(existing, applicationServerKey)
        : null;
    if (existing && (options.replaceExisting === true || keyMatch === false)) {
        const staleEndpoint = existing.endpoint;
        await existing.unsubscribe();
        existing = await registration.pushManager.getSubscription();
        if (existing?.endpoint === staleEndpoint) {
            throw new Error('The browser could not retire its stale Web Push subscription');
        }
    }
    const created = existing === null;
    const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(applicationServerKey),
    });

    return { subscription, json: serializePushSubscription(subscription), created };
}

export async function requestWebPushPermission(): Promise<void> {
    assertPushEnvironmentAvailable();
    if (Notification.permission === 'granted') return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error(permission === 'denied'
            ? 'Notification permission was denied'
            : 'Notification permission was not granted');
    }
}

async function getExistingPushSubscription(): Promise<PushSubscription | null> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return null;
    }
    const registration = await getPushServiceWorker();
    return registration.pushManager.getSubscription();
}

export async function unsubscribeFromWebPush(): Promise<boolean> {
    const subscription = await getExistingPushSubscription();
    return subscription ? subscription.unsubscribe() : true;
}

export function serializePushSubscription(subscription: PushSubscription): WebPushSubscriptionJson {
    const value = subscription.toJSON();
    const auth = value.keys?.auth;
    const p256dh = value.keys?.p256dh;

    if (!value.endpoint || !auth || !p256dh) {
        throw new Error('The browser returned an incomplete Web Push subscription');
    }

    return {
        endpoint: value.endpoint,
        expirationTime: value.expirationTime ?? null,
        keys: { auth, p256dh },
    };
}

/** Returns null when the browser does not reveal the key used by a subscription. */
export function pushSubscriptionUsesApplicationServerKey(
    subscription: PushSubscription,
    applicationServerKey: string,
): boolean | null {
    const options = subscription.options as { applicationServerKey?: ArrayBuffer | null } | undefined;
    if (!options || !('applicationServerKey' in options) || options.applicationServerKey === null || options.applicationServerKey === undefined) {
        return null;
    }

    const actual = toBytes(options.applicationServerKey);
    const expected = decodeBase64Url(applicationServerKey);
    if (actual.byteLength !== expected.byteLength) {
        return false;
    }
    return actual.every((value, index) => value === expected[index]);
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
    const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - normalized.length % 4) % 4);
    const decoded = atob(normalized + padding);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
        bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
}

function toBytes(value: BufferSource): Uint8Array {
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return new Uint8Array(value);
}

function inspectStaticPushCapability(): Exclude<PushCapability, 'available' | 'enabled'> | null {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return 'unsupported';
    }
    if (isIosDevice() && !isStandaloneApp()) {
        return 'install-required';
    }
    if (Notification.permission === 'denied') {
        return 'permission-denied';
    }
    return null;
}

function assertPushEnvironmentAvailable(): void {
    const unavailable = inspectStaticPushCapability();
    if (unavailable === 'unsupported') {
        throw new Error('Web Push is not supported by this browser');
    }
    if (unavailable === 'install-required') {
        throw new Error('Install slashveto.me on your Home Screen before enabling Web Push');
    }
    if (unavailable === 'permission-denied') {
        throw new Error('Notification permission is blocked in browser settings');
    }
}

function isStandaloneApp(): boolean {
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

function isIosDevice(): boolean {
    const navigatorWithTouch = navigator as Navigator & { maxTouchPoints?: number };
    return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && (navigatorWithTouch.maxTouchPoints ?? 0) > 1);
}
