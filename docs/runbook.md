# Runbook

The supported production deployment is one Node 24 backend under systemd, one
SQLite database, and an HTTPS reverse proxy. Never run two backend instances for
the same installation.

## Prepare

Install Node 24 at `/usr/local/bin/node`, enable Corepack, and create the
backend environment:

```bash
/usr/local/bin/node --version
corepack enable
sudo install -m 0600 collector/deploy/slashmon-backend.env.example /etc/slashmon-backend.env
sudoedit /etc/slashmon-backend.env
```

Set the public PWA URL, its exact CORS origin, both Aztec endpoints, and at least
one Ethereum RPC. Keep the admin RPC private. Choose
`L1_SLASH_LOG_LOOKBACK_BLOCKS` before first start; it bounds only the initial
confirmed-log history. Its default is 600 Ethereum blocks, approximately the
current mainnet wall-clock span of three Aztec epochs with a small margin.
Later scans resume from SQLite.

Sentinel duty indexing checks sync every 60 seconds and quietly indexes a
three-epoch window on first start. It fetches one confirmed L1 committee and
exact-range stats only for that committee when a new epoch closes; idle polls
make neither call. `AZTEC_SENTINEL_LOOKBACK_EPOCHS` applies to both the L1
committee and Aztec history sides of catch-up. The defaults are 3 epochs,
an epoch-end buffer of 2 slots, 8 concurrent validator requests, and a 2 MiB
per-validator response limit. If the Aztec node overrides
`SENTINEL_EPOCH_END_BUFFER_SLOTS`, set
`AZTEC_SENTINEL_EPOCH_END_BUFFER_SLOTS` to the same value; the node does not
expose this internal Sentinel setting through its admin API.
Override `AZTEC_SENTINEL_POLL_INTERVAL_MS`,
`AZTEC_SENTINEL_LOOKBACK_EPOCHS`,
`AZTEC_SENTINEL_EPOCH_END_BUFFER_SLOTS`,
`AZTEC_SENTINEL_VALIDATOR_CONCURRENCY`, or
`AZTEC_SENTINEL_VALIDATOR_MAX_RESPONSE_BYTES` only for an observed node or RPC
constraint. The deployment script preserves these settings.

Telegram and Web Push are independently optional. Create one Telegram bot or
generate a stable VAPID keypair:

```bash
pnpm --filter @slashmon/backend exec web-push generate-vapid-keys
```

Changing VAPID keys requires browsers to subscribe again.

## Deploy

Run one mode from a clean checkout of the commit to deploy:

```bash
scripts/deploy-backend.sh --fresh
scripts/deploy-backend.sh --upgrade
scripts/deploy-backend.sh --reset-db
```

Use `--fresh` only for the first deployment or a full machine-level reset. It
permanently removes all Slashmon state and `/var/backups/slashmon`; it creates
no backup. Use `--upgrade` for a schema-compatible release. It stops the only
writer, checkpoints and checks SQLite, saves a timestamped database under
`/var/backups/slashmon`, switches the immutable release, and restarts without
deleting state.

Use `--reset-db` when a release intentionally requires an empty database. It
performs the same checkpoint, integrity check, and timestamped backup, then
removes only `slashmon.sqlite` and its SQLite sidecars. The new process creates
the current schema; watches, notification endpoints, journal history, and
collector cursors restart empty. Backups and earlier releases remain available.
Keep the previous release and backup until source polls and test deliveries
succeed. No mode provides automatic rollback.

The unit stores the database at `/var/lib/slashmon/slashmon.sqlite`. Startup
accepts an empty database or the current schema only; there is no automatic
schema migration. Releases that only change API reads or stored JSON metadata
remain compatible and should use `--upgrade`.

To self-host the PWA, install all dependencies and run `pnpm build` in the
release. Serve `dist/` as static files. Frontend RPC URLs must be public HTTPS
endpoints; never put credentials in `VITE_*` variables.

## HTTPS tunnel

Keep the backend on `127.0.0.1:8790`. Expose `/api/v2/*` over HTTPS and apply
request-body, read, and mutation rate limits. Serve the PWA on the exact origin
in `BACKEND_CORS_ORIGIN`; `SLASHMON_PUBLIC_URL` is its full installed URL for
notification links.

For a Cloudflare Tunnel that connects directly to the loopback listener, set
`BACKEND_TRUST_PROXY=true`. The backend then prefers Cloudflare's canonical
`CF-Connecting-IP` value and falls back to the rightmost valid
`X-Forwarded-For` address. Forwarded addresses are ignored unless the socket
peer is loopback. Leave this setting false if the backend is directly reachable
or the proxy connects over a non-loopback hop.

### Abuse-control defaults

The backend defaults to 180 API reads per minute per client and 600 globally,
plus 20 mutations per minute per client and per managed watch list. Anonymous
watch-list creation is limited to 3/hour and 10/day per client, with durable
global limits of 10/hour and 50/day. Notification tests have a five-minute
per-watch-list cooldown and durable global limits of 30/hour and 100/day.

New Web Push endpoints are limited to 3/hour and 10/day per watch list, and
20/hour and 100/day globally. These admission budgets use private SQLite
journal entries, so endpoint rotation, process restarts, and watch-list deletion
cannot reset them. The entries are removed by the normal seven-day notification
maintenance pass. Telegram starts at 20 sends/second globally, five
low-priority test or command sends/second, and one send/second per chat; real
alerts are scheduled first.

Every value is configurable in `collector/.env.example`. At the current small
traffic level, treat repeated 429 responses as an abuse or integration signal
before increasing a limit.

Use a restrictive browser policy. A same-origin baseline is:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self'; manifest-src 'self'; worker-src 'self';
connect-src 'self' https://YOUR-L1-RPCS; base-uri 'self';
form-action 'self'; frame-ancestors 'none'
```

Also send HSTS, `X-Content-Type-Options: nosniff`, and a no-referrer policy.
Add the API and any operator-selectable Monitor RPC origins to `connect-src`.

GitHub Pages cannot host the backend. A project path on a shared
`name.github.io` origin is Monitor-only because sibling projects share browser
storage. A dedicated custom domain can host PINGME.

## Verify

```bash
curl --fail http://127.0.0.1:8790/live
curl --fail http://127.0.0.1:8790/health
journalctl -u slashmon-backend.service --since '10 minutes ago'
```

Confirm that:

- Aztec and L1 health advance independently;
- the database identity matches the intended network;
- confirmed-log catch-up eventually becomes healthy;
- a Telegram link and test alert work, when enabled; and
- a Web Push endpoint receives verification and a test alert, when enabled.

An upstream outage should degrade health without deleting the last good state.
Repeatedly restarting does not repair a stale node or RPC. Web Push 404/410 is
endpoint-specific; shared authentication failures keep urgent work retryable
and degrade channel health.

Delivery is at-least-once. A crash after provider acceptance but before the
success commit can duplicate an alert; stable event IDs are the comparison key.
