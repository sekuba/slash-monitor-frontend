# Slashmon backend

The backend powers PINGME. It runs as one Node 24 process with four independent
loops:

1. poll one Aztec node's public and admin RPCs for pending offenses;
2. scan canonical Ethereum contracts for slashing state and confirmed
   `Slashed` logs;
3. deliver the durable outbox through Telegram and Web Push; and
4. long-poll Telegram when that channel is configured.

Every observation, watch, event, and delivery job lives in one SQLite database.
The browser Monitor does not depend on this process.

## Configure and run

```bash
cp .env.example .env
pnpm --dir .. install
pnpm --dir .. dev:backend
```

Configuration is intentionally small:

| Area | Variables |
| --- | --- |
| Identity | `SLASHMON_NETWORK`, `SLASHMON_PUBLIC_URL` |
| Aztec node | `AZTEC_NODE_URL`, `AZTEC_NODE_API_KEY`, `AZTEC_ADMIN_URL`, `AZTEC_ADMIN_API_KEY` |
| Ethereum | `L1_RPC_URL`, optional `L1_REGISTRY_ADDRESS`, `L1_SLASH_LOG_LOOKBACK_BLOCKS` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` |
| Web Push | `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| Process | `BACKEND_DATABASE_PATH`, `BACKEND_BIND_HOST`, `BACKEND_PORT`, `BACKEND_CORS_ORIGIN`, `BACKEND_TRUST_PROXY`, `BACKEND_LOG_LEVEL` |

`L1_RPC_URL` accepts comma-separated HTTP(S) URLs for whole-scan failover. The
selected network fixes the expected chain and default Registry. The backend
binds a new database to that identity and refuses later reuse under another
network, chain, or Registry.

The public node and admin endpoints must belong to the same Aztec node. Before
accepting offenses, the backend checks the node's chain, Registry, and canonical
Rollup against its independent L1 view. Missing offenses are acted on only when
the node's relevant L2 cursor advanced safely; positive warnings can still be
recorded during a sync wobble.

Telegram is enabled only when both Telegram variables are present. Web Push is
enabled only when all VAPID variables are present. Generate a stable keypair
with:

```bash
pnpm exec web-push generate-vapid-keys
```

## HTTP API

The current contract is rooted at `/api/v2`:

- `GET /config`, `/status`, `/events`, `/events/:id`
- `POST /subscriptions`
- `GET`, `PATCH`, or `DELETE /subscriptions/:id`
- `GET /subscriptions/:id/events` and `/events/:eventId`
- `PUT` or `DELETE /subscriptions/:id/channels/web-push`
- `POST /subscriptions/:id/channels/telegram-link`
- `POST /subscriptions/:id/test`

Subscription creation returns a management token once. All later subscription
requests require it as `Authorization: Bearer …`. A PATCH replaces the address
list; deleting a subscription removes the watch and its channels.

`GET /live` reports process liveness. `GET /health` reports operational source
and delivery health. Public events include node-local and L1 observations but never
watch/address associations, provider endpoints, or delivery metadata.

## Storage and delivery

Startup creates the current schema only in an empty database. Databases from
older implementations are rejected rather than migrated. Back up or archive an
old file, then start with a new path.

Event creation, target matching, and outbox insertion are one transaction.
Delivery is at-least-once: stable IDs suppress normal duplicates, but a crash
after provider acceptance and before the success commit can repeat a message.
Unverified or expired endpoints and terminal delivery history are pruned; live
work is not.

Run backend checks directly with:

```bash
pnpm --dir .. test:backend
pnpm --dir .. check:backend
```

See [`../docs/runbook.md`](../docs/runbook.md) for the supported single-host
deployment.
