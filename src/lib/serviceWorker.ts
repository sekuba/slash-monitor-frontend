const SERVICE_WORKER_SCOPE = import.meta.env.BASE_URL;
const SERVICE_WORKER_PATH = `${SERVICE_WORKER_SCOPE}sw.js`;

export function registerPushServiceWorker(): void {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: SERVICE_WORKER_SCOPE }).catch((error: unknown) => {
            console.error('Unable to register the slashveto.me push service worker:', error);
        });
    }, { once: true });
}

export async function getPushServiceWorker(): Promise<ServiceWorkerRegistration> {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers are not supported by this browser');
    }

    const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
    if (existing) {
        return existing;
    }

    await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: SERVICE_WORKER_SCOPE });
    return navigator.serviceWorker.ready;
}
