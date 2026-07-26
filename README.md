# Slashmon

Slashmon watches Aztec slashing and has two deliberately separate parts:

- **Monitor** is a browser-only view of public Ethereum state. It resolves the
  canonical Aztec contracts and checks slashing rounds directly through public
  L1 RPCs. Its on-page details panel can select a browser-local RPC and inspect
  the resolved deployment metadata.
- **PINGME** is the alerting UI for the backend. The backend journals per-duty
  inactivity precursors and registered offenses from one Aztec node, verifies
  L1 slashing state, and sends matched alerts through Telegram or Web Push.

Node-local offenses are early warnings, not consensus. Slashmon labels them
`pending`. Ethereum observations are labelled `confirmed`. The backend never
turns one node's opinion into L1 truth.

## Repository

- `src/` — React/Vite PWA containing Monitor and PINGME
- `collector/` — Node backend, SQLite journal, and notification delivery
- [`docs/architecture.md`](docs/architecture.md) — data flow and trust boundaries
- [`docs/runbook.md`](docs/runbook.md) — production deployment and operations
- [`docs/privacy.md`](docs/privacy.md) — stored data and provider exposure

The ignored `apiReference.md` and `onchainSources.md` files are research
material. Runtime behavior must live in committed code, ABIs, and tests.

## Development

Use Node 24 and the pinned pnpm release:

```bash
corepack enable
pnpm install
cp .env.example .env
cp collector/.env.example collector/.env
```

Run the two processes in separate terminals:

```bash
pnpm dev
pnpm dev:backend
```

For local cross-origin development, set
`VITE_API_BASE_URL=http://127.0.0.1:8790`; the backend example already allows
`http://localhost:5173`. Alternatively leave `VITE_API_BASE_URL` empty and set
`SLASHMON_DEV_API_PROXY_TARGET` for Vite's same-origin development proxy.

Run the complete quality gate with:

```bash
pnpm check
```

All `VITE_*` values are public browser configuration. Backend RPC credentials,
Telegram tokens, and VAPID private keys belong only in `collector/.env` or the
production environment file.

Notification watches use a bearer capability stored by browser origin. Host a
production PINGME installation on a dedicated origin and do not add third-party
scripts. A shared GitHub Pages origin is suitable only for the public Monitor.

Production backend deployments use `scripts/deploy-backend.sh`: `--fresh`
resets all state, while `--upgrade` preserves and backs up the current database.
