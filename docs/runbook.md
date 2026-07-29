# Production runbook

The supported deployment is one Node 24 backend, one SQLite database, one
private Aztec admin endpoint, one or more Ethereum RPCs, and an HTTPS reverse
proxy or Cloudflare Tunnel. Do not run two backend processes for one
installation: provider delivery and Telegram polling are single-writer work.

## Prepare

Install Node 24 at `/usr/local/bin/node`, enable Corepack, and create the
protected environment:

```bash
/usr/local/bin/node --version
corepack enable
sudo install -m 0600 collector/deploy/slashmon-backend.env.example /etc/slashmon-backend.env
sudoedit /etc/slashmon-backend.env
```

Set:

- the network, public PWA URL, and exact CORS origin;
- public and admin endpoints for the same Aztec node;
- at least one Ethereum RPC; and
- optional Telegram and Web Push credentials.

Keep the Aztec admin endpoint and all credentials private. Choose
`L1_SLASH_LOG_LOOKBACK_BLOCKS` before first start; it bounds initial log history
only, after which the durable SQLite cursor takes over.

Sentinel defaults are intentionally bounded. The collector checks sync on idle
polls, then fetches the confirmed committee and exact-range history only when
an epoch becomes ready. If the node overrides its Sentinel epoch-end buffer,
set the backend buffer to the same value. All optional collection and abuse
controls are documented in
[`collector/.env.example`](../collector/.env.example).

Telegram and Web Push are independently optional. Generate a stable VAPID
keypair with:

```bash
pnpm --filter @slashmon/backend exec web-push generate-vapid-keys
```

Changing VAPID keys invalidates existing browser subscriptions.

## Deploy

Run exactly one mode from a clean checkout:

```bash
scripts/deploy-backend.sh --fresh
scripts/deploy-backend.sh --upgrade
scripts/deploy-backend.sh --reset-db
```

- `--fresh` is for first installation or an intentional full reset. It removes
  Slashmon state and its backup directory without creating a backup.
- `--upgrade` stops the writer, checkpoints and verifies SQLite, makes a
  timestamped backup, switches releases, and preserves state.
- `--reset-db` makes the same verified backup and then removes only the active
  SQLite database and sidecars. Watches, journals, channels, and cursors start
  empty.

There is no automatic rollback or general schema migration. Keep the prior
release and verified backup until source health and test deliveries succeed.
The default database is `/var/lib/slashmon/slashmon.sqlite`.

For a self-hosted PWA, run `pnpm build` and serve `dist/` as static files.
Frontend RPC URLs must be public HTTPS endpoints; every `VITE_*` setting is
visible to the browser.

## HTTPS boundary

Keep the backend on `127.0.0.1:8790` and expose only `/api/v2/*` over HTTPS.
Apply request-body, read, mutation, and enrollment rate limits. The PWA origin
must exactly match `BACKEND_CORS_ORIGIN`; `SLASHMON_PUBLIC_URL` is the complete
installed URL used in notifications.

Set `BACKEND_TRUST_PROXY=true` only when a Cloudflare Tunnel connects directly
to the loopback listener. The backend then accepts Cloudflare's canonical
client address and a constrained forwarded-address fallback. Otherwise leave
it false.

Use a restrictive browser policy. A starting point is:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self'; manifest-src 'self'; worker-src 'self';
connect-src 'self' https://YOUR-L1-RPCS; base-uri 'self';
form-action 'self'; frame-ancestors 'none'
```

Also send HSTS, `X-Content-Type-Options: nosniff`, and a no-referrer policy.
Add only the actual API and operator-selectable Monitor RPC origins to
`connect-src`.

PINGME needs a dedicated browser origin because its management token is an
origin-wide bearer capability. A shared `name.github.io` origin is suitable
only for the public Monitor.

## Verify

```bash
curl --fail http://127.0.0.1:8790/live
curl --fail http://127.0.0.1:8790/health
journalctl -u slashmon-backend.service --since '10 minutes ago'
```

Confirm:

- Aztec and L1 cursors advance independently and report freshness;
- node, Registry, Rollup, chain, and database identities agree;
- confirmed-log catch-up reaches healthy state;
- a Telegram link and test work, when configured; and
- Web Push verification and a test alert work, when configured.

An upstream outage should degrade one source without deleting its last good
state or stopping the other source. Repeated restarts do not repair a stale
node or RPC. Web Push 404/410 disables only that endpoint; shared
authentication failures remain visible and retryable.

Delivery is at-least-once. A crash after provider acceptance but before the
success commit can duplicate an alert; compare stable transition IDs.
