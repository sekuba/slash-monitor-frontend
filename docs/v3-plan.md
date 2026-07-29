# Slashmon v3 plan

## Product decision

V3 is a clean rewrite around one user question:

> Where is each of my sequencers on the slashing path, why might it be there,
> and what happens next?

Slashmon is an educational early-warning product, not an event explorer. Its
primary object is a per-sequencer **slashing case** with a plain-language
headline, protocol timeline, next transition, and evidence provenance.

V3 has no backwards-compatibility requirement. It will use a new API and an
empty database. Existing subscriptions are recreated. There will be no schema
migrations, v2 adapters, dual writes, legacy response shapes, or feature flags
for the old UI.

## Five architectural decisions

1. **Cases replace events as the product model.** Raw observations remain
   inspectable evidence; users navigate addresses and cases.
2. **One pure protocol engine serves both pages.** It interprets discovered
   contract lineages and owns timing, tallying, case linking, stages, urgency,
   and allowed claims.
3. **Two data adapters remain operationally independent.**
   - Monitor builds L1-only cases in the browser from one user-selected RPC.
   - PINGME loads richer cases from the backend.
4. **Monitor is the only fallback.** If PINGME is unavailable or stale, it says
   so and links to Monitor. It does not silently switch RPCs, run a client
   collector, or present cached data as current.
5. **Education precedes detail.** Every screen explains the current stage and
   next step before exposing votes, calldata, raw events, or contract addresses.

## Target product

### PINGME

The default screen is the user's address list. Each address has one calm status
card with:

- a plain-language headline and its most urgent active case;
- the next transition and countdown; and
- source freshness and notification state.

Opening a case shows the shared protocol path:

```text
duty issue → node offense → target round → L1 support → candidate
           → delayed → executable → executed → stake removed → ejection
```

Completed stages show evidence, the current stage explains why it matters, and
stopped branches explain why the case did not progress. Reasons always say
`node evidence`; L1-only cases say `reason unknown on L1`.

The network view summarizes current cases, not event volume: local precursors
and offenses, L1 support, stake at risk, execution windows, actual deductions,
ejections, and source health.

### Monitor

Monitor keeps the same timeline and terminology but starts at the first
observable L1 stage. It needs only a public RPC and locally entered addresses.
It never calls the backend.

The two pages share source code and fixtures, not runtime dependencies.

## Minimal domain

The protocol package exposes four types:

| Type | Meaning |
| --- | --- |
| `Observation` | Immutable node, Sentinel, or L1 evidence with exact provenance |
| `SlashingCase` | Address + contract lineage + target epoch, with all matching evidence |
| `CaseState` | Current stage, terminal branch, urgency, next transition, and allowed headline |
| `ProtocolSnapshot` | Canonical contracts, parameters, slot/epoch/round, and source block |

The canonical case key is:

```text
network / contract-lineage / sequencer / target-epoch
```

Slot offenses map to their exact epoch. Multiple local offenses remain separate
evidence inside one case because L1 can aggregate them into one penalty unit.
A `Slashed` log joins through its execution transaction and round. Approximate
time is never a join key.

The engine is a pure TypeScript reducer:

```text
protocol snapshot + ordered observations → cases + transitions
```

It performs no I/O. Golden fixtures cover every offense, lifecycle branch,
contract rotation, and reorg correction.

## Backend

The v3 backend is one TypeScript process with a direct pipeline:

```text
Aztec node ─┐
Sentinel ───┼→ observations → case projector → SQLite → API
Ethereum ───┘                         └────────→ outbox → channels
```

Use one configured Aztec node and one configured L1 RPC. A failed source becomes
unhealthy; there is no provider failover tree. Fixed polling and bounded retry
are sufficient.

SQLite contains only:

- source cursors and health;
- immutable observations;
- materialized cases and case transitions;
- watches and channel endpoints; and
- notification outbox/delivery results.

A transaction inserts observations, recomputes affected cases, records genuine
state transitions, and enqueues matching alerts. Repeated polls update source
freshness without producing transitions.

Keep node identity verification, Registry discovery, active/pending/legacy
slashing lineage, pinned L1 reads, confirmations, and reorg correction. These
are correctness invariants, not fallback features.

### API

Create `/api/v3` with a small case-oriented surface:

- `GET /status`
- `GET /network`
- `GET /sequencers/:address`
- `GET /cases/:id`
- create/read/update/delete watch
- add/remove/test notification channel

There is no public generic event feed. Case responses contain typed evidence
and transitions.

Keep Telegram and Web Push as thin delivery adapters over the same formatted
transition. Notification tests never enter protocol history. Use simple
per-client mutation limits and bounded watch sizes; remove durable synthetic
rate-limit events and catch-up/replay artifacts.

## Frontend

Replace the current parallel presentation paths with:

- `AddressList`
- `AddressStatus`
- `CaseTimeline`
- `CaseExplanation`
- `EvidenceDetails`
- `NetworkHealth`
- `SourceStatus`
- `WatchSettings`

PINGME receives projected cases. Monitor feeds browser-collected L1
observations through the same reducer. Raw evidence is progressive disclosure:
users need not understand vote words, round offsets, or payload clones to read
the headline, but those facts remain available and linked to Etherscan.

### Visual and mobile invariants

V3 keeps Slashmon's existing neobrutalist identity. This is a re-architecture,
not a visual rebrand:

- preserve the brand-black and whisper-white base with chartreuse, aqua,
  orchid, vermillion, malachite, lapis, aubergine, and oxblood;
- preserve square corners, heavy keylines, hard unblurred shadows, uppercase
  typography, and physical button motion;
- use the bright colors consistently for source, status, and urgency; and
- do not replace the design with rounded, muted, generic dashboard components.

Every screen is mobile-first. At 320px and above, address cards, case timelines,
evidence, settings, and notification enrollment must work without viewport
overflow. Timelines become vertical, long hashes wrap or use copy controls,
touch targets are at least 44px, overlays respect safe areas, and desktop grids
are progressive enhancement. Test 320px, 375px, 768px, and desktop widths,
keyboard navigation, and reduced motion.

## Delete instead of adapt

V3 removes:

- `/api/v2`, its decoders, and its response types;
- the current database and all migration/compatibility checks;
- the generic event-history UI as primary navigation;
- synthetic catch-up, replay, and notification-test events;
- duplicated frontend/backend event descriptions;
- automatic backend RPC failover and degraded client-side PINGME modes; and
- code whose only purpose is preserving v2 IDs, URLs, storage, or behavior.

Deployment creates a fresh v3 database and replaces v2 atomically. The browser
Monitor remains available throughout.

## Delivery sequence

1. Build and exhaustively test the pure protocol/case package.
2. Build the fresh SQLite schema, three collectors, projector, and v3 read API.
3. Build the address-first PINGME UI with exact case deep links.
4. Connect transition-based notifications.
5. Move Monitor's existing L1 reads behind the shared engine and case UI.
6. Delete v2 code, deploy with an empty database, and require re-enrollment.

Each step ends by deleting the superseded path; no parallel architecture
survives to the next step.

## V3 acceptance criteria

V3 is complete when:

- entering several addresses produces one understandable current status for
  each;
- “1 of 2 inactive epochs” is distinct from an offense;
- a candidate shows exact execution/expiry timing and possible node reasons
  without claiming L1 confirmed them;
- execution and actual stake removal are distinct;
- backend failure produces one clear unavailable state and a Monitor link;
- Monitor remains fully usable with only an L1 RPC;
- every alert opens the exact case transition;
- current contract parameters and evidence provenance are always visible;
- the neobrutalist palette and interaction language remain recognizable on
  fully usable mobile and desktop layouts; and
- no v2 API, schema, adapter, event-first screen, or compatibility code remains.

Protocol semantics remain defined by
[the protocol model](protocol.md),
[slashing rules](slashing.md), and
[architecture invariants](architecture.md).
