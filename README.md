# Slashmon

Slashmon explains Aztec validator slashing without treating every signal as the
same fact. It has two intentionally redundant views:

- **Live monitor & alerts** uses a continuously running backend for one fixed
  network. It combines an Aztec node's local observations with canonical
  Ethereum state, keeps recent confirmed slash outcomes, and notifies watched
  validator addresses.
- **Independent L1 check** runs entirely in the browser against public Ethereum
  RPCs. It does not use the backend, so it remains useful when that service is
  unavailable. It cannot provide node-local offense reasons or notification
  continuity.

Both views use the same case language and the same L1 contracts. Node
observations, L1 votes, a tally's proposed amount, and stake actually removed
are shown as separate facts. See [the architecture](docs/architecture.md) for
the exact trust boundaries.

## Repository

- `src/` — React/Vite PWA for both views
- `collector/` — fixed-network Node backend, SQLite state, and alert delivery
- [`docs/architecture.md`](docs/architecture.md) — protocol model and trust
  boundaries
- [`docs/runbook.md`](docs/runbook.md) — single-host operation
- [`docs/privacy.md`](docs/privacy.md) — stored data and provider exposure

The ignored `apiReference.md` and `onchainSources.md` files are research inputs,
not runtime documentation. Contract behavior used by Slashmon is represented in
committed ABIs, code, and tests.

## Develop

Use Node 24 and the pinned pnpm release:

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

Set `VITE_API_BASE_URL=http://127.0.0.1:8790` for local cross-origin
development, or leave it empty and set `SLASHMON_DEV_API_PROXY_TARGET` for the
Vite proxy. The backend's `BACKEND_CORS_ORIGIN` must exactly match the browser
origin.

Run the complete quality gate with:

```bash
pnpm check
```

Every `VITE_*` value is public. Ethereum RPC credentials, Aztec admin
credentials, Telegram tokens, and VAPID private keys belong only in the backend
environment.

The alert-management token is a bearer capability stored by browser origin.
Use a dedicated production origin without third-party scripts for the hosted
view. The independent view can be hosted separately because it has no alert
credentials.
