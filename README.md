# Slashmon v2

Slashmon is an early-warning watchtower for Aztec sequencers, built by and for
the [Slash Veto Council](https://github.com/aztec-slash-veto/council/) and the
wider Aztec community.

It watches two things that should never be confused:

- **pending, node-local offenses** from a private Aztec node admin API; and
- **L1-verified slashing payloads** resolved from Aztec's canonical Registry on
  Ethereum.

The first can warn you earlier. The second is the public chain state. Slashmon
labels both, keeps their history in SQLite, matches events to watched sequencer
addresses, and delivers alerts through Telegram or PWA Web Push.

The PWA is enough for browser push; there are no native mobile apps to install
or maintain. Signal is not a supported v2 delivery channel. The dashboard needs
a live network connection and never dresses cached data up as fresh consensus.

Notification watches carry an origin-wide bearer capability in browser
storage. Give production Slashmon its own domain or subdomain. A project path
on `name.github.io` is fine for the public L1 monitor, but the UI deliberately
refuses to create private watches there because sibling Pages projects share
the same browser origin.

## Repository map

- `src/` — React/Vite PWA and independent public L1 view.
- `collector/` — the Slashmon v2 backend: Aztec/L1 sources, SQLite journal,
  subscriptions, Telegram long polling, and Web Push delivery.
- `docs/architecture.md` — trust boundaries and the event/outbox design.
- `docs/privacy.md` — what notification delivery reveals and to whom.
- `docs/runbook.md` — single-host deployment, migration, backup, and recovery.

The ignored `apiReference.md` and `onchainSources.md` files are research inputs,
not runtime dependencies. Anything the application needs from them must be
committed as a small ABI, fixture, or test.

## Local development

Use Node 24 and the pnpm version pinned in `package.json`:

```bash
corepack enable
pnpm install
cp .env.example .env
cp collector/.env.example collector/.env
```

Run the frontend and backend in separate terminals:

```bash
pnpm dev
pnpm dev:backend
```

The browser API defaults to the same origin. For two local processes, set
`VITE_API_BASE_URL=http://127.0.0.1:8790` and set the backend CORS origin to
`http://localhost:5173`. To test against a production backend without weakening
its exact CORS policy, leave `VITE_API_BASE_URL` empty and set the development-
only `SLASHMON_DEV_API_PROXY_TARGET=https://api.slashveto.me`; Vite will proxy
`/api` server-side while the browser remains same-origin with localhost.

Run the whole gate before committing:

```bash
pnpm check
```

That lints, runs frontend and backend tests, syntax-checks every backend module,
and builds the PWA.

## A small but important trust note

The Aztec admin endpoint describes what one node currently believes is
slashable. It is public in Slashmon's node-local feed, but it is not consensus
and is always labelled pending. L1 payloads are read at a pinned Ethereum block
and can be independently checked by anyone. Notification providers are
best-effort transports, so serious operators should keep the dashboard and
source-health checks in their routine instead of treating one push message as
an oracle.

Production setup lives in [the runbook](docs/runbook.md). Keep secrets out of
`VITE_*`: those values are shipped to every browser.
