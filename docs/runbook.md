# Slashmon v2 runbook

This is the deliberately plain single-host setup: Node 24, systemd, SQLite, and
an HTTPS reverse proxy. Fancy orchestration can wait until it solves a real
problem.

## Before the first v2 cutover

Install a system-wide Node 24 binary and confirm the exact path used by the unit:

```bash
/usr/bin/node --version
corepack pnpm --version
```

Create `/etc/slashmon-backend.env` from
`collector/deploy/slashmon-backend.env.example`, set mode `0600`, and fill in
the L1 and Aztec endpoints. Use an exact browser origin for CORS. Never put
backend secrets in the frontend `.env` file.

Choose `L1_SLASH_LOG_LOOKBACK_BLOCKS` before the first start. That bounded
window is intentionally replayed into the durable cursor, and any matching
watched slash is delivered as a critical **historical / backfilled** alert.
After startup the cursor, not this lookback value, owns continuity. Keep
`L1_SLASH_LOG_REORG_REWIND_BLOCKS` above the deepest confirmed reorg you are
prepared to reconcile; larger values trade extra `eth_getLogs` work for a
wider recovery tail.

```bash
sudo install -m 0600 collector/deploy/slashmon-backend.env.example /etc/slashmon-backend.env
sudoedit /etc/slashmon-backend.env
```

Telegram and Web Push are optional independently. Create a Telegram bot through
BotFather for Telegram delivery. Generate and then keep one stable VAPID
keypair for browser subscriptions:

```bash
pnpm --filter @slashmon/backend exec web-push generate-vapid-keys
```

Changing the VAPID key later requires browsers to subscribe again, so back up
the private key as carefully as the database.

## Build an immutable release

Install releases as root-owned, read-only trees. Do not copy files over the
process that is currently running.

```bash
revision="$(git rev-parse --short=12 HEAD)"
release="/opt/slashmon/releases/$revision"
sudo install -d -m 0755 "$release"
git archive HEAD | sudo tar -x -C "$release"
```

Choose the install that matches where the static PWA lives.

For a self-hosted PWA, install the full toolchain and build `dist/`. These are
public browser values, not secrets; use reachable HTTPS RPCs rather than a
loopback URL that would point at each user's own machine:

```bash
sudo corepack pnpm --dir "$release" install --frozen-lockfile
sudo env \
  VITE_API_BASE_URL= \
  VITE_BASE_PATH=/ \
  VITE_L1_RPC_URL=https://ethereum-rpc.example \
  VITE_TESTNET_L1_RPC_URL=https://sepolia-rpc.example \
  corepack pnpm --dir "$release" build
test -f "$release/dist/index.html"
```

When the PWA is built elsewhere (including a GitHub Pages public monitor),
production dependencies are enough on the backend server:

```bash
sudo corepack pnpm --dir "$release" install --prod --frozen-lockfile
```

Do not switch `/opt/slashmon/current` yet. Stop and back up the active writer
first.

The checked-in reference documents are intentionally ignored and are not part
of a release. Runtime ABIs and fixtures must be committed source files.

## Preserve the v1 database

The new unit deliberately reuses
`/var/lib/slashmon-offense-collector/offenses.sqlite`. Before the first schema
migration, stop the old writer and make a consistent backup. Install the
`sqlite3` command-line tool for this maintenance step.

```bash
sudo systemctl stop slashmon-offense-collector.service
database=/var/lib/slashmon-offense-collector/offenses.sqlite
sudo sqlite3 "$database" 'PRAGMA wal_checkpoint(TRUNCATE);'
test "$(sudo sqlite3 "$database" 'PRAGMA quick_check;')" = ok
sudo cp --preserve=mode,ownership,timestamps "$database" "${database}.pre-v2"
sudo ln -sfn "$release" /opt/slashmon/current
```

`quick_check` must print `ok`. If it does not, keep the service stopped and
repair or restore the database before asking new code to migrate it.

Install the new unit, disable the old name, and start exactly one backend:

```bash
sudo install -m 0644 collector/deploy/slashmon-backend.service /etc/systemd/system/
sudo systemctl disable slashmon-offense-collector.service
sudo systemctl daemon-reload
sudo systemctl enable --now slashmon-backend.service
sudo systemctl status slashmon-backend.service
```

Never overlap two instances: they would compete for Telegram updates and could
double-send alerts even though SQLite serializes writes.

## Put HTTPS in front

The backend binds to `127.0.0.1:8790`. Proxy only the intended public API paths,
set request-body and per-client rate limits on both public reads and subscription
writes, and terminate TLS at Caddy, nginx, or an equivalent proxy. Keep the
Aztec admin port private. The backend briefly caches its compact public status;
do not cache bearer-authenticated responses at the proxy.

For a self-hosted build, serve `/opt/slashmon/current/dist/` as the static site
and proxy `/api/v2/*` to the backend. `VITE_API_BASE_URL` may stay empty in this
same-origin shape. The monitor has no client-side pathname routes, but the
proxy should still return `index.html` for the installed PWA base so
notification query links open cleanly. Do not cache API responses as static
assets.

The browser holds a bearer capability, so serve the PWA with a tight CSP and no
third-party scripts. A same-origin deployment can start with `default-src
'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self';
manifest-src 'self'; worker-src 'self'; connect-src 'self' <configured-L1-RPCs>;
base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. Add the separate
API origin to `connect-src` when using one. Also send HSTS, `nosniff`, and a
no-referrer policy at the proxy.

If the PWA and API are on separate origins, build with the API's public HTTPS
origin and set `COLLECTOR_CORS_ORIGIN` to the exact PWA origin. An HTTPS page
cannot use a plain-HTTP API. `SLASHMON_PUBLIC_URL` is the full installed PWA URL
used in notification links. Production notification watches need a dedicated
origin, preferably at its root:

```text
SLASHMON_PUBLIC_URL=https://slashmon.example/
COLLECTOR_CORS_ORIGIN=https://slashmon.example
VITE_BASE_PATH=/
```

GitHub Pages alone cannot serve the dynamic API. A project deployment at
`name.github.io/slashmon/` is intentionally public-monitor-only: all project
paths for that account share one browser origin, so storing a watch-list bearer
capability there would let sibling projects read it. A dedicated custom domain
on GitHub Pages is suitable; use `/` as its base path and point CORS/public URL
at that custom origin.

The Pages workflow requires these public repository variables and refuses to
publish a localhost fallback:

- `VITE_API_BASE_URL` — public HTTPS backend origin;
- `VITE_L1_RPC_URL` — one or more comma-separated public HTTPS mainnet RPCs;
- `VITE_TESTNET_L1_RPC_URL` — equivalent Sepolia RPCs; and
- `VITE_BASE_PATH` — `/slashmon/` for a public project Pages monitor or `/` for
  a dedicated custom-domain root (the workflow defaults to `/slashmon/`).

Registry variables are optional because the canonical mainnet and testnet
addresses are committed defaults. Every `VITE_*` value is visible to browsers;
never put paid RPC credentials in one. The API remains rooted at `/api/v2` on
its own origin; `VITE_BASE_PATH` scopes only the static PWA and service worker.

The production example enables `API_TRUST_LOOPBACK_PROXY`. That only trusts
client-address headers when the immediate socket peer is loopback. Configure
the one local proxy to overwrite `X-Real-IP` or `X-Forwarded-For`, then apply
per-client request and body limits there too, with a particularly tight budget
for anonymous `POST /api/v2/subscriptions`. The process also has read/create
limits and a bounded channel-less pool, but those are the last fence rather
than a replacement for edge controls. Do not enable this switch for a remote
proxy hop.

## Verify a deployment

```bash
curl --fail --silent http://127.0.0.1:8790/live
curl --fail --silent http://127.0.0.1:8790/health
journalctl -u slashmon-backend.service --since '10 minutes ago'
```

Then verify, without pasting secrets into shell history:

- Aztec and L1 source timestamps advance independently;
- the configured chain ID and Registry match the intended network;
- the delivery queue has no steadily growing backlog;
- one operator Telegram chat links and receives a test alert, if enabled;
- one installed PWA receives its private wire check, changes from **checking**
  to **alerts armed**, and receives a test push, if enabled; and
- any one-time historical slash alert is clearly labelled backfilled and falls
  inside the lookback chosen before migration.

L1 health remains degraded while the confirmed-log cursor is catching up, even
if fresh round snapshots are healthy. It should become healthy after the
backlog drains; a stuck checkpoint or repeated `eth_getLogs` error needs RPC or
range-size attention, not a database reset.

Keep `L1_SLASH_LOG_PROVIDER_TIMEOUT_MS` below `L1_SLASH_LOG_MAX_RUN_MS` (the
loader enforces this). The former makes room for another RPC inside one
backfill pass; the latter protects fresh snapshot cadence. A global deadline
also rotates the next pass away from the provider that consumed it.

The default `L1_MAX_HEAD_STALL_MS=120000` tolerates a run of missed Ethereum
slots, then rejects a provider that keeps returning the same confirmed height.
If this trips, compare all configured RPCs before increasing it; a responsive
JSON-RPC endpoint can still be frozen upstream.

A provider outage should degrade delivery health while collection continues.
An upstream outage is not fixed by restarting the service in a tight loop.
A wrong Telegram username/token is isolated as an unhealthy optional channel;
it must not stop L1 collection or Web Push. Fix the credential pair, then verify
the channel recovers without deleting user endpoints.

Web Push HTTP 400/401/403 responses are treated as a shared request/VAPID
channel fault: health degrades and urgent work stays retryable without deleting
every browser endpoint. HTTP 404/410 is endpoint-scoped and triggers foreground
subscription repair in that browser.

## Roll back the first migration

The v2 schema is not readable by the v1 binary. Switching the release or unit
without restoring the pre-v2 database is not a rollback.

Stop the sole writer, keep the failed v2 database for forensics, and restore the
checkpointed copy atomically before re-enabling the old unit:

```bash
sudo systemctl stop slashmon-backend.service
database=/var/lib/slashmon-offense-collector/offenses.sqlite
backup="${database}.pre-v2"
failed="${database}.failed-v2.$(date -u +%Y%m%dT%H%M%SZ)"
sudo test -f "$backup"
sudo sqlite3 "$database" 'PRAGMA wal_checkpoint(TRUNCATE);'
test "$(sudo sqlite3 "$database" 'PRAGMA quick_check;')" = ok
sudo cp --preserve=mode,ownership,timestamps "$database" "$failed"
if sudo test -e "${database}-wal"; then sudo mv "${database}-wal" "${failed}-wal"; fi
if sudo test -e "${database}-shm"; then sudo mv "${database}-shm" "${failed}-shm"; fi
sudo cp --preserve=mode,ownership,timestamps "$backup" "${database}.restore"
sudo mv "${database}.restore" "$database"
sudo systemctl disable slashmon-backend.service
sudo systemctl enable --now slashmon-offense-collector.service
```

If the old service used a fixed `User=`, verify the restored file belongs to
that user before starting it. A `DynamicUser` plus `StateDirectory` unit should
repair state-directory ownership itself. Never start old and new units at the
same time. Any events collected only after the v2 migration remain in the
preserved timestamped `failed-v2` copy, not in the restored v1 database. The
checkpoint makes that forensic copy self-contained; moving the v2 WAL/SHM
sidecars prevents SQLite from replaying v2 pages over the restored v1 file.

## Routine backup and upgrades

For the simplest reliable backup, stop the service briefly, checkpoint WAL,
run `quick_check`, copy the database with mode `0600`, and start it again. Move
encrypted copies off-host according to the threat model.

For upgrades, install a new versioned release, stop the backend, back up before
any schema migration, switch `/opt/slashmon/current`, and start it. Retain the
previous release and pre-migration database until the new service has completed
several source polls and test deliveries.

Provider delivery is at-least-once. A crash in the narrow interval after a
provider accepts a message but before SQLite records success can produce a
duplicate. Treat a stable event ID as the thing to compare; never trade a quiet
screen for silently dropped warnings.
