# Runbook

The supported production deployment is one Node 24 backend under systemd, one
SQLite database, and an HTTPS reverse proxy. Never run two backend instances for
the same installation.

## Switch from an older backend

From a clean checkout of the commit to deploy, run:

```bash
scripts/switch-backend.sh --fresh
```

The script keeps supported credentials and endpoints from
`/etc/slashmon-backend.env`, installs the current commit, removes the old service
unit, and starts `slashmon-backend.service`. It permanently removes the old and
new Slashmon state directories plus `/var/backups/slashmon`; it creates no
database backup and provides no automatic rollback. Run it only when losing all
existing watches, events, delivery state, and checkpoints is intended.

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
confirmed-log history. Later scans resume from SQLite.

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
constraint. The fresh-switch script preserves these settings.

Telegram and Web Push are independently optional. Create one Telegram bot or
generate a stable VAPID keypair:

```bash
pnpm --filter @slashmon/backend exec web-push generate-vapid-keys
```

Changing VAPID keys requires browsers to subscribe again.

## Install

Create an immutable release and install production dependencies:

```bash
revision="$(git rev-parse --short=12 HEAD)"
release="/opt/slashmon/releases/$revision"
sudo install -d -m 0755 "$release"
git archive HEAD | sudo tar -x -C "$release"
sudo corepack pnpm --dir "$release" install --prod --frozen-lockfile
sudo ln -sfn "$release" /opt/slashmon/current
sudo install -m 0644 collector/deploy/slashmon-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now slashmon-backend.service
```

The unit creates `/var/lib/slashmon` and stores
`/var/lib/slashmon/slashmon.sqlite`. Startup accepts an empty database or the
current schema only. Archive any database from an older Slashmon implementation
and start clean; there is intentionally no migration path.

To self-host the PWA, install all dependencies and run `pnpm build` in the
release. Serve `dist/` as static files. Frontend RPC URLs must be public HTTPS
endpoints; never put credentials in `VITE_*` variables.

## Reverse proxy

Keep the backend on `127.0.0.1:8790`. Expose `/api/v2/*` over HTTPS and apply
request-body, read, and mutation rate limits. Serve the PWA on the exact origin
in `BACKEND_CORS_ORIGIN`; `SLASHMON_PUBLIC_URL` is its full installed URL for
notification links.

If the proxy overwrites `X-Real-IP` or `X-Forwarded-For` and connects over
loopback, set `BACKEND_TRUST_PROXY=true`. Leave it false for any remote proxy
hop.

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

## Backup and upgrade

Stop the only writer, checkpoint and check SQLite, then copy the database:

```bash
sudo systemctl stop slashmon-backend.service
database=/var/lib/slashmon/slashmon.sqlite
sudo sqlite3 "$database" 'PRAGMA wal_checkpoint(TRUNCATE);'
test "$(sudo sqlite3 "$database" 'PRAGMA quick_check;')" = ok
sudo install -d -m 0700 /var/backups/slashmon
sudo cp --preserve=mode,ownership,timestamps "$database" /var/backups/slashmon/
sudo systemctl start slashmon-backend.service
```

For an upgrade, install a new immutable release, take this backup, switch the
`/opt/slashmon/current` symlink while stopped, and start the service. Keep the
previous release and backup until source polls and test deliveries succeed.

Delivery is at-least-once. A crash after provider acceptance but before the
success commit can duplicate an alert; stable event IDs are the comparison key.
