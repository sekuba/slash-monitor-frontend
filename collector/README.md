# Slashmon backend

The backend powers the fixed-network live monitor and alerts. The independent
L1 view does not depend on this process.

One Node 24 process supervises four loops:

1. poll one Aztec node for its current local offense observations;
2. scan canonical Ethereum state and Rollup `Slashed` logs;
3. deliver a durable Telegram/Web Push outbox; and
4. long-poll Telegram when that channel is enabled.

SQLite stores current facts, canonical scan checkpoints, watches, and delivery
work. The backend serves one `SLASHMON_NETWORK`; use a separate process and
database for another network.

## Configure and run

```bash
cp .env.example .env
pnpm --dir .. install
pnpm --dir .. dev:backend
```

Required areas are:

| Area | Variables |
| --- | --- |
| Identity | `SLASHMON_NETWORK`, `SLASHMON_PUBLIC_URL` |
| Aztec node | `AZTEC_NODE_URL`, `AZTEC_NODE_API_KEY`, `AZTEC_ADMIN_URL`, `AZTEC_ADMIN_API_KEY` |
| Ethereum | `L1_RPC_URL`; optional `L1_REGISTRY_ADDRESS`, `L1_SLASH_LOG_LOOKBACK_BLOCKS` |
| HTTP | `BACKEND_DATABASE_PATH`, `BACKEND_BIND_HOST`, `BACKEND_PORT`, `BACKEND_CORS_ORIGIN`, `BACKEND_TRUST_PROXY`, `BACKEND_LOG_LEVEL` |
| Telegram | optional `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` |
| Web Push | optional `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |

[`collector/.env.example`](.env.example) documents the limits and optional tuning
values. `L1_RPC_URL` accepts comma-separated HTTP(S) URLs for whole-scan
failover. The selected network fixes the expected chain and default Registry.
The database is bound to that identity and cannot be reused for another one.

The public and admin endpoints must describe the same Aztec node. Before
accepting local offenses, the backend verifies the node's chain, Registry, and
canonical Rollup against its independent L1 view. A disappearing offense is
resolved only after a fresh, non-regressing node cursor advances past its
relevant slot or epoch.

Telegram is enabled only when both Telegram values are present. Web Push is
enabled only when all VAPID values are present. Generate a stable VAPID keypair
with:

```bash
pnpm exec web-push generate-vapid-keys
```

## What is recorded

Node offenses remain source-labelled local observations. They are not attached
to an L1 case as its cause.

The L1 scanner reads the active and any still-authorized legacy slashing stack;
a pending stack is not executable and is excluded. It retains raw tally actions
but groups repeated actions for the same validator into one proposed amount and
action count. A case phase is `voting`, `review`, `ready`, `paused`, or
`closed`; closed outcomes are `vetoed`, `executed`, `expired`,
`stack-retired`, or `no-consensus`. A current-payload veto remains provisional
while voting can still change the exact payload.

Actual loss comes only from canonical Rollup `Slashed` logs. Logs are grouped
by chain, block hash, transaction hash, and validator; their amounts are summed
and their count retained. Overlapping reads, durable checkpoints, and bounded
rewind handle reorgs. A correction is recorded when a previously reported log
leaves the canonical chain.

Only meaningful new transitions enter the notification outbox: a first node
observation, first quorum-backed candidate, newly executable candidate, exact
payload veto or expiry, grouped confirmed loss, and canonical correction.
Unchanged polls, individual votes, ordinary payload refreshes, execution
without confirmed loss, and historical backfill do not alert.

## HTTP API

The current contract is rooted at `/api` and has no network query parameter:

- `GET /api/config`
- `GET /api/status`
- `GET /api/monitor`
- `GET /api/validators/:address`
- `POST /api/watchlists`
- `GET`, `PATCH`, or `DELETE /api/watchlists/:id`
- `PUT` or `DELETE /api/watchlists/:id/channels/web-push`
- `POST /api/watchlists/:id/channels/web-push/verify`
- `POST` or `DELETE /api/watchlists/:id/channels/telegram`
- `POST /api/watchlists/:id/test`

Responses are direct JSON resources without a version or `data` wrapper.
`GET /api/config` advertises the fixed network, watch-address limit, and
channel availability. There is no network field in mutations, network query
parameter, or alternate API surface.

`GET /api/monitor` returns separate case-state and slash-log coverage
checkpoints, protocol timing, compact slashing cases, and independently bounded
confirmed and reorg-removed slashes. The validator endpoint filters those facts
to one address and adds its current node observations. `GET /api/status`
reports Ethereum, Aztec-node, delivery backlog, and per-channel notification
health separately.

Creating a watch returns its management token once. Every later request for
that watch requires `Authorization: Bearer …`. `PATCH` replaces its normalized
address set without disconnecting its channels. Deleting it removes its channels
and prevents future delivery. Public monitor and validator responses never
expose watches, tokens, endpoints, or delivery state.

## Storage and delivery

Startup creates the current schema in an empty database and otherwise requires
that exact schema. When the schema changes, archive and reset the database.

Incident creation, watched-address matching, and outbox insertion are
transactional. Delivery is at-least-once: stable incident IDs suppress normal
duplicates, but a crash after provider acceptance and before the success commit
can repeat one message.

Run backend checks with:

```bash
pnpm --dir .. test:backend
pnpm --dir .. check:backend
```

See [the architecture](../docs/architecture.md) for evidence semantics and
[the runbook](../docs/runbook.md) for production operation.
