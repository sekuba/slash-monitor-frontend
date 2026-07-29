# Slashmon backend

The backend powers PINGME. It combines one Aztec node's early evidence with an
independent Ethereum view, persists the evidence needed for per-sequencer
slashing cases, and delivers alerts while browsers are closed. The browser-only
Monitor does not depend on this process.

One Node 24 process runs these responsibilities:

1. poll the public and admin RPCs of one verified Aztec node for offenses;
2. index completed epochs' committees and exact-range Sentinel duty stats;
3. scan canonical L1 slashing stacks and `Slashed` logs;
4. record the event journal, case links, watches, and durable delivery outbox;
5. deliver through Telegram and Web Push.

The source model is deliberate:

- Sentinel duty records and admin offenses are this node's local evidence;
- L1 votes prove support and amounts but contain no offense reason;
- a candidate has only a predicted payload address until `executeRound`; and
- only a canonical Rollup `Slashed` log proves the amount removed.

See [protocol](../docs/protocol.md),
[slashing](../docs/slashing.md), and
[architecture](../docs/architecture.md) before changing collector semantics.

## Configure and run

```bash
cp .env.example .env
pnpm --dir .. install
pnpm --dir .. dev:backend
```

The required configuration areas are:

| Area | Variables |
| --- | --- |
| Identity | `SLASHMON_NETWORK`, `SLASHMON_PUBLIC_URL` |
| Aztec node | `AZTEC_NODE_URL`, `AZTEC_NODE_API_KEY`, `AZTEC_ADMIN_URL`, `AZTEC_ADMIN_API_KEY` |
| Ethereum | `L1_RPC_URL`; optional Registry and initial log-lookback overrides |
| Delivery | optional Telegram bot or complete VAPID keypair |
| Process | database path, bind host/port, exact CORS origin, proxy trust, log level |

[`collector/.env.example`](.env.example) is the source of truth for optional
Sentinel, retry, rate-limit, and abuse-control settings. `L1_RPC_URL` accepts a
comma-separated failover list. The selected network determines the expected
chain and Registry; a database is permanently bound to that identity.

The public and admin endpoints must belong to the same Aztec node. Before
accepting admin evidence, the collector verifies the node's chain, Registry,
and canonical Rollup against L1. A source failure preserves last-known state.
Absence from the offense feed is acted on only after a fresh, non-regressing
node cursor advances safely past the evidence.

Sentinel collection is epoch-gated and committee-scoped. It resolves the
committee at the already accepted L1 block, then requests exact-range validator
stats only for those members. An unknown catch-up gap starts a new coverage
generation and cannot extend an inactivity streak.

Generate a stable Web Push keypair with:

```bash
pnpm exec web-push generate-vapid-keys
```

Changing it requires browser subscriptions to be recreated.

## HTTP API

The API root is `/api/v2`:

- public configuration, source status, events, event details, and
  address-scoped sequencer records;
- bearer-capability subscription management;
- Web Push and Telegram channel enrollment; and
- notification tests.

Subscription creation returns its management token once. Public responses can
contain public-address node, Sentinel, and L1 observations, but never watch
membership, endpoints, tokens, or delivery state. A sequencer record returns
the linked event history and live protocol snapshot; if L1 is unavailable, its
history remains readable and protocol freshness is explicit.

The complete route list and schemas live in the checked-in server routes and
tests. Treating a prose list as the API contract would duplicate code that
changes during the planned refactor.

`GET /live` reports process liveness and `GET /health` reports source and
delivery health.

## Storage and delivery

SQLite is the consistency boundary. Event creation, target indexing, watch
matching, and outbox insertion happen in one transaction. Confirmed-log scans
resume from a block/hash checkpoint and rewind across reorgs.

Delivery is at-least-once. Stable transition IDs suppress normal duplicates,
but a crash after provider acceptance and before the success commit can repeat
an alert. Startup accepts an empty database or the current schema; unsupported
older schemas are rejected rather than implicitly migrated.

Run backend checks with:

```bash
pnpm --dir .. test:backend
pnpm --dir .. check:backend
```

Production deployment is documented in the [runbook](../docs/runbook.md).
