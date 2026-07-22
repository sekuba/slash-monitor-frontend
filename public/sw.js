/* Slashmon's service worker is deliberately push-only. Monitor API responses are
 * never cached: stale slashing data must look stale, not quietly look current. */

const APP_NAME = 'Slashmon';
const ICON_PATH = new URL('favicon.svg', self.registration.scope).href;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event.data);
  const notification = buildNotification(payload);

  event.waitUntil(
    self.registration.showNotification(notification.title, notification.options),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = safeTargetUrl(event.notification.data);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of windows) {
      const clientUrl = new URL(client.url);
      const scopeUrl = new URL(self.registration.scope);
      if (clientUrl.origin !== scopeUrl.origin || !clientUrl.pathname.startsWith(scopeUrl.pathname)) {
        continue;
      }
      if ('navigate' in client) {
        await client.navigate(targetUrl);
      }
      return client.focus();
    }

    return self.clients.openWindow(targetUrl);
  })());
});

function readPushPayload(data) {
  if (!data) {
    return {};
  }

  try {
    const value = data.json();
    return value && typeof value === 'object' ? value : {};
  }
  catch {
    try {
      return { body: data.text() };
    }
    catch {
      return {};
    }
  }
}

function buildNotification(payload) {
  const metadata = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const title = safeText(payload.title, `${APP_NAME} alert`, 120);
  const body = safeText(payload.body, 'A watched sequencer has a new slashing event.', 600);
  const eventId = safeIdentifier(payload.eventId || metadata.eventId);
  const network = (payload.network || metadata.network) === 'testnet' ? 'testnet' : 'mainnet';
  const url = typeof payload.url === 'string'
    ? payload.url
    : typeof metadata.url === 'string' ? metadata.url : '';
  const tag = safeIdentifier(payload.tag) || eventId || `slashmon-${network}`;

  return {
    title,
    options: {
      body,
      icon: ICON_PATH,
      badge: ICON_PATH,
      tag,
      renotify: true,
      data: { eventId, network, url },
    },
  };
}

function safeTargetUrl(data) {
  const scope = new URL(self.registration.scope);
  let url = new URL('./', scope);
  if (data && typeof data.url === 'string' && data.url.trim()) {
    try {
      const candidate = new URL(data.url, scope);
      if (candidate.origin === scope.origin && candidate.pathname.startsWith(scope.pathname)) {
        url = candidate;
      }
    }
    catch {
      // Fall through to the service-worker scope root.
    }
  }

  const network = data && data.network === 'testnet' ? 'testnet' : 'mainnet';
  url.hash = '';
  url.searchParams.set('view', 'watch');
  url.searchParams.set('network', network);

  const eventId = safeIdentifier(data && data.eventId) || safeIdentifier(url.searchParams.get('event'));
  if (eventId) {
    url.searchParams.set('event', eventId);
  }
  else {
    url.searchParams.delete('event');
  }

  return url.href;
}

function safeText(value, fallback, maxLength) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function safeIdentifier(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return /^[a-zA-Z0-9:_-]{1,200}$/.test(trimmed) ? trimmed : '';
}
