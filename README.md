# slashveto.me

slashveto.me helps Aztec sequencer operators answer two questions:

1. Is one of my sequencers beginning to move through the slashing process?
2. What does confirmed L1 state say about slashing risk across the network?

An operator enters one or more sequencer addresses. For each address,
slashveto.me should show a single, linked Slashing Timeline rather than a collection
of unrelated events:

```text
duty miss → node offense → L1 mention → candidate → execution delay
          → executable → executed → stake removed → ejection
```

That path can stop at any step. Examples include “one inactive epoch observed;
the configured consecutive-epoch threshold has not been met” and “candidate
slash becomes executable in two days; this node observed inactivity in the
target epoch.” The second statement deliberately says **node evidence**:
onchain slash votes contain a validator, target epoch, and penalty unit, but no
offense reason.

## Two independent views

| Surface | Data source | Purpose |
| --- | --- | --- |
| **Monitor** | Public Ethereum RPCs, queried by the browser | Backend-independent view of canonical contracts, rounds, votes, candidate actions, vetoes, execution, and actual slash logs. |
| **PINGME** | slashveto.me backend, one Aztec node, Ethereum RPCs | Earlier node and Sentinel warnings, linked per-sequencer history, realtime status, and Telegram or Web Push delivery. |

The overlap is intentional. Monitor must remain useful when
`api.slashveto.me` or the attached Aztec node is unavailable. PINGME provides
continuity while a browser is closed and evidence that is not published to L1.
Neither view is an oracle: local evidence is an observer's report, while L1
reveals voting and stake outcomes but not the underlying offense.

Both views expose the same case feed and educational Slashing Timeline.
Watchlists can be shared as address-only URLs without exposing PINGME's private
management capability. Individual cases retain a compact copy-link action for
alerts and investigations.

Watchlist rows collapse cases per sequencer and retain a compact stake and
pending-amount summary. The public feed collapses only cases that share an
exact payload address.

## Read this first

- [Aztec protocol model](docs/protocol.md) — slots, blocks, checkpoints,
  committees, proposals, signals, and proofs
- [Slashing and ejection](docs/slashing.md) — all v5 offenses and the exact
  warning-to-stake-removal lifecycle
- [Monitor architecture](docs/architecture.md) — trust boundaries, case
  linking, and requirements for the refactor
- [V3 architecture record](docs/v3-plan.md) — the implemented case-first
  clean break and its acceptance contract
- [Notification contract](docs/notifications.md) — what an alert may claim at
  each stage
- [Privacy](docs/privacy.md) and [production runbook](docs/runbook.md)

The protocol documentation was researched against the active Aztec mainnet
deployment and `aztec-packages` commit
[`def7152a`](https://github.com/AztecProtocol/aztec-packages/tree/def7152aa13dc0f880f24e45ce39442908170878)
on 2026-07-29. Parameters and canonical contracts are upgradeable. Runtime
views must resolve them from the Registry and read their current values rather
than treating the examples in these documents as constants.

## Development

Use Node 24 and the pinned pnpm version:

```bash
corepack enable
pnpm install
cp .env.example .env
cp collector/.env.example collector/.env
pnpm dev
pnpm dev:backend
```

Run `pnpm check` before deployment. All `VITE_*` values are public. RPC
credentials, Telegram tokens, VAPID private keys, and the Aztec admin endpoint
belong only in the backend environment.

The ignored `apiReference.md` and `onchainSources.md` files are research
snapshots, not runtime inputs or committed documentation.
