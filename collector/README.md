# slashveto.me v3 backend

This process powers PINGME. It combines three explicitly labelled evidence
sources into per-sequencer slashing cases:

1. Sentinel duty performance from one Aztec node;
2. that node's admin offense feed; and
3. a canonical Ethereum view of votes, payloads, execution, `Slashed` logs,
   and ejection state.

The browser-only Monitor is independent and never calls this backend.

Read [the protocol model](../docs/protocol.md),
[slashing rules](../docs/slashing.md), and
[architecture](../docs/architecture.md) before changing collector semantics.

## Run

```bash
cp .env.example .env
pnpm --dir .. install
pnpm --dir .. dev:backend
```

Node 24 is required. The main settings are:

| Area | Variables |
| --- | --- |
| Identity | `SLASHMON_NETWORK`, `SLASHMON_PUBLIC_URL` |
| Aztec node | `AZTEC_NODE_URL`, `AZTEC_NODE_API_KEY`, `AZTEC_ADMIN_URL`, `AZTEC_ADMIN_API_KEY` |
| Ethereum | one `L1_RPC_URL`; optional Registry and log-lookback overrides |
| Notifications | optional complete VAPID keypair and/or Telegram bot |
| Process | database path, bind host/port, exact CORS origin, proxy trust, log level |

The public and admin URLs must belong to the same node. Before accepting node
evidence, slashveto.me verifies its chain, Registry, and Rollup against L1. Missing
offenses are withdrawn only after a fresh, non-regressing sync cursor advances
past them.

Sentinel indexing is committee-scoped and epoch-gated. Unknown coverage gaps
start a new generation and cannot extend an inactivity streak.

## Case API

The only API is `/api/v3`:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/config` | Network, watch limit, available channels |
| `GET` | `/status` | Protocol snapshot and source freshness |
| `GET` | `/network` | Current network summary and cases |
| `GET` | `/sequencers/:address` | Cases for one public address |
| `GET` | `/cases/:id` | One exact case with transitions |
| `POST` | `/watches` | Create an address watch and one-time management token |
| `GET/PATCH/DELETE` | `/watches/:id` | Capability-authenticated watch management |
| `PUT/DELETE` | `/watches/:id/channels/web_push` | Web Push enrollment |
| `POST` | `/watches/:id/channels/telegram-link` | One-time Telegram link |
| `POST` | `/watches/:id/channels/test` | Queue a test alert |

`GET /live` reports process liveness. `GET /health` reports whether the three
required evidence views are current. There is no v2 API or compatibility
adapter.

Watch membership, endpoints, management tokens, and delivery state are never
public. Mutations require the bearer management token returned once at watch
creation.

## Storage and delivery

V3 accepts only an empty database or its current schema. It never migrates a
v2 database.

SQLite atomically stores observations, projects affected cases, records stable
case transitions, matches watched addresses, and queues deliveries. L1 round
replacements and log reorgs mark prior evidence noncanonical and recompute the
same case. A `Slashed` log attaches only through its receipt's
`RoundExecuted` event and exact action order; address plus time is never
accepted as a correlation key.

Delivery is at-least-once. Stable transition IDs suppress ordinary duplicates,
but a crash after provider acceptance can repeat an alert.

Generate VAPID keys with:

```bash
pnpm exec web-push generate-vapid-keys
```

Run verification with:

```bash
pnpm --dir .. test:backend
pnpm --dir .. check:backend
```

See the [production runbook](../docs/runbook.md) for deployment.
