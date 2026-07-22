# Slashmon v2 backend

This is the always-awake half of Slashmon. It watches one private Aztec node for
early offense signals, watches Ethereum for canonical slashing payloads, keeps a
durable SQLite event/outbox journal, and delivers matching alerts through
Telegram or Web Push.

It is intentionally one process and one database. There is less machinery to
trust, fewer moving parts to page you at 03:00, and a clean migration from the
old offense collector.

## Trust boundaries

The Aztec source calls only:

```text
aztec_getNodeInfo()
aztec_isReady()
aztec_getSyncedL1Timestamp()
aztec_getSyncedL2SlotNumber()
aztec_getSyncedL2EpochNumber()
aztecAdmin_getSlashOffenses("all")
```

It never proxies caller-selected admin methods. Keep the admin endpoint and API
key private. Before accepting an offense snapshot, Slashmon requires the node's
reported L1 chain and Registry to match its configured identity. Once the L1
scanner has resolved a canonical Rollup, that address must match too. Its
results are labelled **pending / node-local**: they describe what this node
currently believes, not finalized public truth.

`AZTEC_NODE_URL` and `AZTEC_ADMIN_URL` must terminate at the same Aztec node.
That co-location is an explicit operator trust invariant: the supplied API
reference describes `aztecAdmin_getConfig()` as an opaque config object and
does not promise stable chain, Registry, or Rollup identity fields to
cross-check. Slashmon therefore does not guess at that schema or add the broad
admin call to its allowlist.

Positive evidence is cheap; negative evidence is not. Slashmon will record a
new offense from an otherwise identified node even when its sync cursor is
degraded, but an absent offense gains a missed-poll count only when the node is
ready, its synced L1 timestamp is fresh, and its L1/L2 cursors have not
regressed. Repeated HTTP polls at one cursor do not create repeated misses:
slot offenses require a new fully synced slot and epoch offenses require a new
fully synced epoch. A stalled or stale cursor retains every prior active warning
and degrades source health.

On a fresh database, pending offenses remain disabled until the independent L1
scanner has resolved the canonical Rollup. The node must report that exact
Rollup on every later poll. This closes the startup window where a correctly
labelled chain and Registry could still front the wrong Rollup.

The L1 source resolves contracts through the configured canonical Registry,
checks their relationships and bytecode, and reads slash state at a pinned,
confirmed Ethereum block. Those events are labelled **L1 verified**. A partial
scan never becomes a confirmed transition. Active, queued-pending, and still
authorized legacy slashing stacks remain distinct in the stored event data.

Actual stake loss has a second, durable lane. `IStakingCore.Slashed(address,uint256)`
is emitted from the Rollup address because the staking library runs in the
Rollup's execution context. Slashmon resolves that emitter history only from
the configured Registry's indexed `CanonicalRollupUpdated(address,uint256)`
events, then scans confirmed ranges in bounded chunks. Every range's end block
number and hash are committed in the same SQLite transaction as its target
events and outbox jobs. An outage can therefore outlive a proposer round
without hiding the eventual slash: restart resumes from the persisted log
cursor, with overlap deduplicated by `(blockHash, transactionHash, logIndex)`.

The first v2 run intentionally searches `L1_SLASH_LOG_LOOKBACK_BLOCKS` of
confirmed history. Matching old losses still produce critical notifications—
silently ignoring a real slash is the worse failure—but their title/body and
event data say **historical / backfilled**. Pick the lookback before launch with
that one-time behavior in mind. After the cursor exists, it is never replaced
by a rolling lifetime window.

The checkpoint hash is checked before advancing and again after each range. If
it no longer belongs to the canonical chain, Slashmon rewinds a bounded tail,
invalidates unsent orphan-log deliveries, and sends watched addresses a
correction for any previously reported log that does not return. The log lane
has an absolute per-poll time budget, so catching up cannot starve the next
fresh round-state snapshot. Log-source failure or staleness degrades the public
L1 health even when state reads are still healthy.

A timing-executable round is not necessarily callable. Each Slasher has its own
global pause gate, and Slashmon keeps that gate separate from the proposer's
round status:

- **blocked now** means the Slasher currently rejects execution;
- **protected through scheduled expiry** means the current pause is due to last
  until that round has expired; and
- a blocked round that expires later than the pause is only delayed and remains
  a serious early-warning condition.

The vetoer can end a pause early, so scheduled protection is conditional rather
than final. Slashmon surfaces a window opening behind a pause without claiming
that slashing is currently callable, then raises the urgency if the pause lifts
while the round is still live. It also records a pause beginning on an already
actionable round as a real state change; it does not pretend the payload or its
votes vanished.

See [the architecture notes](../docs/architecture.md) for the full model.

## Requirements

- Node.js 24
- pnpm through Corepack
- an Ethereum execution RPC
- an Aztec node API, normally `http://127.0.0.1:8080`
- an Aztec node admin API, normally `http://127.0.0.1:8880`
- `SENTINEL_ENABLED=true` on the Aztec node if inactivity offenses are wanted
- HTTPS in front of the API for production Web Push

SQLite comes from Node's built-in `node:sqlite`. Runtime JavaScript dependencies
are `viem` and `web-push`, installed through the root pnpm workspace.

## Run locally

From the repository root:

```bash
corepack pnpm install
cp collector/.env.example collector/.env
set -a
. ./collector/.env
set +a
pnpm dev:backend
```

The API listens on `http://127.0.0.1:8790`. The default frontend origin is
`http://localhost:5173`; CORS accepts that exact origin.

Telegram stays disabled unless both `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_BOT_USERNAME` are present. Web Push stays disabled unless all three
VAPID values are present. The source scanners and read API still work when
either delivery channel is disabled.

Configuration alone does not make Telegram linkable. The API publishes the bot
username and issues one-time links only after `getMe` proves the token belongs
to that exact username and webhook delivery has been disabled.

## HTTP API

### Process and source health

- `GET /live` reports process liveness only.
- `GET /health` reports source freshness and delivery state. Upstream trouble
  degrades health without throwing away the last good snapshot.

Do not make an upstream-dependent health response a systemd restart trigger.
Restarts do not repair an unavailable node and can interrupt useful work from
the other source.

### Public v2 reads

- `GET /api/v2/config` returns enabled channels, the VAPID public key, Telegram
  bot username, and public limits. No secrets are returned.
- `GET /api/v2/status?network=mainnet` returns source/delivery freshness and
  up to 1,000 active offenses from Slashmon's Aztec node, labelled pending.
- `GET /api/v2/events?network=mainnet&address=0x...&limit=40&cursor=...`
  returns the combined node-local and L1 event journal, optionally filtered to
  one sequencer. Node-local events are labelled pending.
- `GET /api/v2/events/:id?network=mainnet` resolves a notification deep link
  for a public node-local or L1 event after it has fallen out of the first feed
  page.

Big integers cross the API as decimal strings. Addresses are normalized to
lowercase for matching. The configured `SLASHMON_NETWORK` is the only accepted
network namespace for a backend instance. `mainnet` is pinned to Ethereum
chain ID 1 and `testnet` to Sepolia chain ID 11155111; the process refuses to
publish observations under a mismatched network label.

### Watch lists and channels

```text
POST   /api/v2/subscriptions
GET    /api/v2/subscriptions/:id
PATCH  /api/v2/subscriptions/:id
DELETE /api/v2/subscriptions/:id
GET    /api/v2/subscriptions/:id/status
GET    /api/v2/subscriptions/:id/events
GET    /api/v2/subscriptions/:id/events/:eventId
PUT    /api/v2/subscriptions/:id/channels/web-push
DELETE /api/v2/subscriptions/:id/channels/web-push
POST   /api/v2/subscriptions/:id/channels/telegram-link
POST   /api/v2/subscriptions/:id/test
```

Creating a watch list accepts a network and sequencer address array, then
returns a management token once. Every subsequent operation on that watch list
requires `Authorization: Bearer <token>`. The token is a bearer secret; never
put it in a URL or log it.

The capability-scoped status and event reads intersect node-local offenses and
journal events with that watch list's sequencer addresses. They let the PWA
show the same public signals as a focused watch-list view while keeping watch
management and the address association behind the bearer capability.

The Telegram-link route returns a short-lived, single-use deep link. Opening it
and sending `/start` binds that chat without placing the watched addresses in
Telegram's URL. Web Push subscriptions are restricted to recognized browser
push services so the delivery worker cannot be turned into an arbitrary HTTPS
request proxy.

A new Web Push endpoint is **checking**, not armed. It can receive only its
private wire-check notification until the push provider accepts that delivery.
Slashmon then marks the endpoint verified and queues a catch-up of matching
current incidents before it reports **alerts armed**. Failed or abandoned
unverified endpoints are removed after 24 hours. Telegram links are armed only
after the configured bot has passed an exact `getMe` username check and disabled
webhook delivery, so a typo cannot route alerts through the wrong bot.

The old public `/api/v1/*` offense routes return HTTP 410. The v2 status and
event feeds replace their legacy response shapes and clearly distinguish
pending node-local proposals from confirmed L1 observations.

## Persistence and restart behavior

SQLite is the continuity boundary:

- failed source polls retain their last good snapshots;
- offense withdrawal requires several successful omissions;
- reappearing offenses reactivate with their history intact;
- source checkpoints survive process and machine restarts;
- event creation and delivery fanout are transactional; and
- delivery leases are reclaimed after an interrupted worker.

Hourly maintenance removes abandoned channel-less watch lists after 24 hours,
unverified endpoints after 24 hours,
terminal-only test alerts after 7 days, terminal endpoint-scoped catch-up events
and sent/failed delivery rows after 30 days, and expired or consumed Telegram
link tokens after 24 hours. Pending, retrying, or leased alerts are never
pruned. A hard cap plus tighter per-client/global creation limits bounds the
anonymous pre-channel pool; the reverse proxy still needs public rate limits.

Delivery is at-least-once. A provider may accept a message immediately before a
crash prevents Slashmon recording success, so a rare duplicate is possible.
Stable event IDs make that visible; silently losing the warning would be worse.

Transient delivery failures are bounded by alert usefulness, not one blunt
attempt count: critical alerts retry for seven days and warnings for 24 hours.
`DELIVERY_MAX_ATTEMPTS` remains the ceiling for low-value info and test traffic.
Provider `Retry-After` guidance is honored within those windows; permanent dead
endpoints are disabled immediately and remain visible in recent delivery health.
Due work is selected critical-first and fairly across endpoints, then sent with
bounded parallelism. `DELIVERY_CONCURRENCY` controls the simultaneous provider
request limit; the default is eight. `DELIVERY_BATCH_SIZE` remains the maximum
work handled in one worker pass. Each concurrency-sized wave is claimed fresh,
so leases are never parked behind earlier sends and newly arrived critical work
can jump ahead of lower-priority backlog. The delivery lease must cover the
provider timeout plus one poll interval.

On first v2 startup, schema v2 from the offense collector is migrated in place.
The database is then permanently bound to its configured network, chain ID, and
Registry. Reusing it under another identity is refused instead of relabelling
old alerts.
Production deliberately keeps the existing path:

```text
/var/lib/slashmon-offense-collector/offenses.sqlite
```

Follow [the runbook](../docs/runbook.md) and back it up before migration.

## Configuration

The complete, executable defaults live in [`.env.example`](.env.example).
Production starts from
[`deploy/slashmon-backend.env.example`](deploy/slashmon-backend.env.example).
The main groups are:

| Group | Variables |
| --- | --- |
| Identity | `SLASHMON_NETWORK`, `SLASHMON_PUBLIC_URL` |
| Aztec | `AZTEC_NODE_URL`, `AZTEC_NODE_API_KEY`, `AZTEC_ADMIN_URL`, `AZTEC_ADMIN_API_KEY`, `AZTEC_SYNC_*`, `COLLECTOR_*` polling and defensive limits |
| Ethereum | `L1_RPC_URL`, `L1_CHAIN_ID`, `L1_REGISTRY_ADDRESS`, `L1_CONFIRMATIONS`, `L1_*` timing/freshness and `L1_SLASH_LOG_*` backfill limits |
| HTTP | `COLLECTOR_BIND_HOST`, `COLLECTOR_PORT`, `COLLECTOR_CORS_ORIGIN`, `API_*`, `MAX_SEQUENCERS_PER_WATCHLIST` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_POLL_TIMEOUT_SECONDS`, `TELEGRAM_LINK_TTL_MS` |
| Web Push | `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| Delivery | `DELIVERY_POLL_INTERVAL_MS`, `DELIVERY_BATCH_SIZE`, `DELIVERY_CONCURRENCY`, `DELIVERY_MAX_ATTEMPTS`, `DELIVERY_LEASE_MS`, `DELIVERY_REQUEST_TIMEOUT_MS` |

`L1_RPC_URL` accepts a comma-separated list. A coherent scan uses one endpoint;
failover restarts the scan instead of mixing provider views inside one snapshot.
RPC URLs often contain credentials, so logs must redact them.

`L1_MAX_HEAD_STALL_MS` is the no-progress tripwire after Slashmon has already
seen a confirmed height. The two-minute default leaves room for ordinary missed
Ethereum slots, but does not let a frozen RPC look healthy for the much wider
`L1_MAX_HEAD_AGE_MS` absolute-startup window. A repeated height beyond the
tripwire rejects that provider's scan and tries the next configured RPC.

For the log lane, `L1_SLASH_LOG_CHUNK_SIZE` bounds each `eth_getLogs` range and
must exceed `L1_SLASH_LOG_OVERLAP_BLOCKS`. The overlap handles ordinary repeated
reads; `L1_SLASH_LOG_REORG_REWIND_BLOCKS` is the deeper recovery bound after a
checkpoint mismatch. `L1_SLASH_LOG_MAX_CHUNKS_PER_POLL` is a work cap, while
`L1_SLASH_LOG_MAX_RUN_MS` is the hard wall-clock yield back to state scanning.
`L1_SLASH_LOG_PROVIDER_TIMEOUT_MS` must be smaller than that run budget. It
gives a hanging RPC a short slice so a healthy failover endpoint can still be
tried in the same poll; if the global deadline wins first, the next poll starts
with the following provider rather than feeding the same black hole forever.

`AZTEC_SYNC_MAX_L1_AGE_MS` limits how old the node's synced L1 timestamp may be
before absences become untrustworthy. `AZTEC_SYNC_MAX_L2_STALL_MS` limits how
long a ready node may report the same synced L2 slot before source health is
degraded. Neither knob makes repeated observations of one slot or epoch count
as separate withdrawal evidence.

`SLASHMON_PUBLIC_URL` is the full installed PWA base URL and may include a path.
Notification watches must use a dedicated origin such as
`https://slashmon.example/`; a shared `name.github.io/slashmon/` project path is
public-monitor-only because sibling Pages projects share origin-wide browser
storage. `COLLECTOR_CORS_ORIGIN` is the PWA origin only.
For the documented one-host proxy, `API_TRUST_LOOPBACK_PROXY=true` separates
the in-process mutation buckets by the client address supplied by that local
proxy. It ignores those headers from non-loopback peers; the proxy must still
overwrite them and enforce the public abuse limits.

## systemd

[`deploy/slashmon-backend.service`](deploy/slashmon-backend.service) uses a
`DynamicUser`, the existing persistent state directory, automatic restart, and
filesystem/kernel hardening. It binds only to loopback and expects an immutable
release at `/opt/slashmon/current`.

The unit uses `/usr/bin/node`; make sure that is Node 24 or edit the unit to an
equally stable system-wide path. Home-directory `nvm`/`fnm` paths are hidden by
`ProtectHome=yes` and are unsuitable here.

## Development checks

From the repository root:

```bash
pnpm test:backend
pnpm check:backend
pnpm check
```

The final command also lints, tests, and builds the PWA. Backend integration
tests use temporary SQLite databases and loopback test servers; CI must permit
binding to `127.0.0.1`.
