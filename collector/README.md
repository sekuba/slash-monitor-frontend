# Slashmon backend

The backend powers PINGME. It runs as one Node 24 process with five independent
loops:

1. poll one Aztec node's public and admin RPCs for pending offenses;
2. index each completed epoch's L1 committee and fetch exact-range Sentinel
   stats only for those validators;
3. scan canonical Ethereum contracts for slashing state and confirmed
   `Slashed` logs;
4. deliver the durable outbox through Telegram and Web Push; and
5. long-poll Telegram when that channel is configured.

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
| Aztec node | `AZTEC_NODE_URL`, `AZTEC_NODE_API_KEY`, `AZTEC_ADMIN_URL`, `AZTEC_ADMIN_API_KEY`; optional `AZTEC_SENTINEL_POLL_INTERVAL_MS`, `AZTEC_SENTINEL_LOOKBACK_EPOCHS`, `AZTEC_SENTINEL_EPOCH_END_BUFFER_SLOTS`, `AZTEC_SENTINEL_VALIDATOR_CONCURRENCY`, `AZTEC_SENTINEL_VALIDATOR_MAX_RESPONSE_BYTES` |
| Ethereum | `L1_RPC_URL`, optional `L1_REGISTRY_ADDRESS`, `L1_SLASH_LOG_LOOKBACK_BLOCKS` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` |
| Web Push | `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| Process | `BACKEND_DATABASE_PATH`, `BACKEND_BIND_HOST`, `BACKEND_PORT`, `BACKEND_CORS_ORIGIN`, `BACKEND_TRUST_PROXY`, `BACKEND_LOG_LEVEL` |
| Abuse controls | `BACKEND_*_RATE_LIMIT_*`, `BACKEND_SUBSCRIPTION_CREATE_*`, `BACKEND_NOTIFICATION_TEST_*`, `BACKEND_WEB_PUSH_ENROLLMENT_*`, `TELEGRAM_SEND_MAX_PER_SECOND`, `TELEGRAM_LOW_PRIORITY_SEND_MAX_PER_SECOND`, `TELEGRAM_CHAT_SEND_INTERVAL_MS` |

`L1_RPC_URL` accepts comma-separated HTTP(S) URLs for whole-scan failover. The
selected network fixes the expected chain and default Registry. The backend
binds a new database to that identity and refuses later reuse under another
network, chain, or Registry.

The public node and admin endpoints must belong to the same Aztec node. Before
accepting offenses, the backend checks the node's chain, Registry, and canonical
Rollup against its independent L1 view. Missing offenses are acted on only when
the node's relevant L2 cursor advanced safely; positive warnings can still be
recorded during a sync wobble.

The Sentinel indexer is epoch-gated. A normal minute with no newly closable
epoch performs only the node sync check. For each new epoch it resolves
`getEpochCommittee(epoch)` at the exact confirmed L1 block already accepted by
the L1 collector, then calls
`aztec_getValidatorStats(address, epochStart, epochEnd)` for those committee
members with bounded concurrency. On mainnet this is normally 48 targeted node
calls per 32-slot epoch, independent of the roughly 3,200 registered
sequencers.

Each exact-range history is checked against the node's persisted all-time epoch
aggregate. L1 membership supplies explicit `0/0` rows for selected validators
with no recorded status, so zero-duty epochs remain visible and break
inactivity streaks exactly as they do in the node. The first start quietly
indexes the latest three complete epochs by default. If downtime exceeds that
window, both L1 committee reads and Aztec history reads resume at the same
three-epoch boundary and start a new coverage generation, preventing an
unknown gap from extending an inactivity streak.

The authoritative registered offense remains
`aztecAdmin_getSlashOffenses`; its offense type and first-seen time are retained
after it is withdrawn.

Telegram is enabled only when both Telegram variables are present. Web Push is
enabled only when all VAPID variables are present. Generate a stable keypair
with:

```bash
pnpm exec web-push generate-vapid-keys
```

## HTTP API

The current contract is rooted at `/api/v2`:

- `GET /config`, `/status`, `/events`, `/events/:id`
- `GET /sequencers/:address/record`
- `POST /subscriptions`
- `GET`, `PATCH`, or `DELETE /subscriptions/:id`
- `GET /subscriptions/:id/events` and `/events/:eventId`
- `PUT` or `DELETE /subscriptions/:id/channels/web-push`
- `POST /subscriptions/:id/channels/telegram-link`
- `POST /subscriptions/:id/test`

Subscription creation returns a management token once. All later subscription
requests require it as `Authorization: Bearer …`. A PATCH replaces the address
list; deleting a subscription removes the watch and its channels.

The checked-in environment example documents every abuse-control default.
Client and watch-list request buckets are in memory. Global watch-list,
notification-test, and new Web Push enrollment budgets are journal-backed and
therefore survive restarts. Re-registering the same Push endpoint does not
consume another enrollment slot.

`GET /live` reports process liveness. `GET /health` reports operational source
and delivery health. Public events include node-local, Sentinel, and L1
observations but never watch/address associations, provider endpoints, or
delivery metadata. Catch-up and notification-test events remain
endpoint-scoped. For an L1 round, `data.nodeEvidence` contains every earlier
node offense or completed inactive epoch matching both the target address and
one of the round's target epochs. This is explicitly correlated node evidence:
L1 votes and payloads do not encode an offense type.

The sequencer record paginates every public journal event targeting one
address. It also returns the latest active Slasher parameters, current
slot/epoch/round, scheduled pause, and node-reported inactivity thresholds.
If no complete L1 snapshot is available, `protocol` is `null` while the event
history remains readable.

## Storage and delivery

Startup creates the current schema only in an empty database. Databases from
older implementations are rejected rather than migrated. Production deploys
use `scripts/deploy-backend.sh --upgrade` for compatible releases or
`--reset-db` to verify and archive the old database before starting empty.

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
