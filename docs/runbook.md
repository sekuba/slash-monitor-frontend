# Runbook

The supported production shape is one Node 24 backend, one SQLite file, one
Aztec node, one or more Ethereum RPCs, and a local Cloudflare Tunnel connector.
Do not run two backend processes for the same installation. The disposable
parallel test installation documented below uses a different service, release
tree, environment, port, and SQLite state.

## Prepare

Install Node 24 at `/usr/local/bin/node`, enable Corepack, and create the
private environment file:

```bash
/usr/local/bin/node --version
corepack enable
sudo install -m 0600 collector/deploy/slashmon-backend.env.example /etc/slashmon-backend.env
sudoedit /etc/slashmon-backend.env
```

Set:

- `SLASHMON_NETWORK` once; the hosted backend serves only that network;
- `SLASHMON_PUBLIC_URL` and its exact `BACKEND_CORS_ORIGIN`;
- public and admin URLs for the same Aztec node; and
- one or more comma-separated Ethereum URLs in `L1_RPC_URL`.

The network selects the expected chain and default Registry. Override
`L1_REGISTRY_ADDRESS` only for an intentional deployment. Choose
`L1_SLASH_LOG_LOOKBACK_BLOCKS` before the first start; it bounds initial
confirmed-log history, after which scanning resumes from SQLite.

Keep the Aztec admin endpoint and all credentials private. Frontend `VITE_*`
settings are public and must contain only browser-safe HTTPS RPCs.

Telegram and Web Push are independently optional. Telegram needs both bot
variables. Web Push needs a stable VAPID keypair:

```bash
pnpm --filter @slashmon/backend exec web-push generate-vapid-keys
```

Changing VAPID keys requires browsers to subscribe again. The checked-in
[`collector/.env.example`](../collector/.env.example) is the complete
configuration reference, including admission and delivery limits.

## Deploy

Run the deployment script from a clean checkout as its normal owner:

```bash
scripts/deploy-backend.sh --fresh
scripts/deploy-backend.sh --upgrade
scripts/deploy-backend.sh --reset-db
scripts/deploy-backend.sh --parallel
```

- `--fresh` creates the first installation and removes any existing Slashmon
  state on that host.
- `--upgrade` checkpoints, checks, and backs up the current database before
  installing the checked-out release. Use it only when that release retains the
  exact current schema.
- `--reset-db` archives the existing database, then starts the release with an
  empty current schema. Watches, channels, observations, and scan cursors start
  empty.
- `--parallel` creates or replaces an isolated test backend on
  `127.0.0.1:8791`. It always starts from an empty testing database and does
  not stop or modify the live service.

The live database is `/var/lib/slashmon/slashmon.sqlite`; archived copies are
under `/var/backups/slashmon`. Startup accepts an empty database or exactly the
schema implemented by the running release. A schema change is a database reset,
not an in-process conversion.

To self-host the PWA, run `pnpm build` in the same release and serve `dist/` as
static files. The frontend may be deployed independently of the backend, but
its hosted view must point to this installation's network.

There is deliberately no cross-release API compatibility layer. Deploy a
schema-changing backend with `--reset-db` and the frontend from the same commit
in one maintenance window. The hosted view can be unavailable between those
two steps; the independent L1 view remains backend-free.

## Parallel backend test

Create a private sidecar environment and copy in the same read-only Aztec and
Ethereum connection settings as production:

```bash
sudo install -m 0600 \
  collector/deploy/slashmon-backend-testing.env.example \
  /etc/slashmon-backend-testing.env
sudoedit /etc/slashmon-backend-testing.env
scripts/deploy-backend.sh --parallel
```

The example starts with a 600-block confirmed-log lookback to limit initial L1
RPC load. The sidecar then advances its durable cursor and accumulates later
history for as long as it runs.

The parallel mode is intentionally isolated:

- service: `slashmon-backend-testing.service`;
- release tree: `/opt/slashmon-testing`;
- database: `/var/lib/slashmon-testing/slashmon.sqlite`;
- environment: `/etc/slashmon-backend-testing.env`; and
- listener: `127.0.0.1:8791`, enforced by the deployment script.

Leave notification credentials empty initially. To test delivery, use a
separate Telegram bot and VAPID keypair; two backends must not poll the same
Telegram bot.

Forward the sidecar to the development machine:

```bash
ssh -N -L 8791:127.0.0.1:8791 YOUR_SERVER
```

Point the local Vite proxy at the forwarded listener:

```dotenv
VITE_API_BASE_URL=
SLASHMON_DEV_API_PROXY_TARGET=http://127.0.0.1:8791
```

Then run `fnm use 24` and `pnpm dev`, and open
`http://localhost:5173`. Re-running `--parallel` replaces only the disposable
testing database and preserves the live installation unchanged.

## HTTPS tunnel

Keep the backend on `127.0.0.1:8790` and expose only `/api/*` through HTTPS.
Apply request-body, read, and mutation rate limits at the edge as well as in the
application.

Set `BACKEND_TRUST_PROXY=true` only when cloudflared connects directly to the
loopback listener. In that shape, the backend accepts Cloudflare's canonical
client address. Leave it false for direct access or a non-loopback proxy hop.

Use a restrictive browser policy. A same-origin baseline is:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self'; manifest-src 'self'; worker-src 'self';
connect-src 'self' https://YOUR-L1-RPCS; base-uri 'self';
form-action 'self'; frame-ancestors 'none'
```

Also send HSTS, `X-Content-Type-Options: nosniff`, and a no-referrer policy.
Add the API origin and any selectable independent-view RPC origins to
`connect-src`.

The alert-management token is stored origin-wide. Do not host the alert-enabled
app beside unrelated applications on a shared origin, and do not add
third-party scripts. GitHub Pages can host only an independent-view deployment
unless it uses a dedicated custom origin.

## Verify

After every deploy:

```bash
curl --fail http://127.0.0.1:8790/api/status
curl --fail http://127.0.0.1:8790/api/monitor
journalctl -u slashmon-backend.service --since '10 minutes ago'
```

Confirm that:

- the configured network, chain, Registry, and canonical Rollup are correct;
- Ethereum and Aztec-node freshness advance independently;
- the monitor includes the active and any still-authorized legacy stack, but
  not a pending stack;
- confirmed-log catch-up reaches the head;
- an address watch can be created, updated without losing channels, and
  deleted; and
- configured Telegram and Web Push channels receive a labelled test.

Then compare one case with the independent L1 view. Amounts under
`proposedAmount` are tally requests; only grouped Rollup `Slashed` records are
actual loss.

An upstream outage should degrade source health without presenting stale data
as current. Restarting does not repair a stale node or RPC. Web Push 404/410 is
endpoint-specific; shared authentication failures should degrade channel
health while leaving real incidents retryable.

Delivery is at-least-once. A crash after provider acceptance but before the
success commit can repeat an alert. Compare the stable incident ID before
treating two messages as separate events.

## Operate

- Watch disk use for the SQLite file and backups.
- Review repeated 429 responses before raising an admission limit.
- Keep the backend, cloudflared, and Aztec admin listener bound to their
  intended interfaces.
- Back up the environment file and VAPID keys separately from the database.
- Treat a reorg correction as a new canonical fact; do not delete the original
  message from operator history.
- Do not send historical backfill as fresh incidents after a reset or extended
  outage.

The backend prunes terminal delivery work, expired tokens/tests, and bounded
operational history. It retains the state required for current cases, canonical
scan continuity, watches, and pending delivery.
