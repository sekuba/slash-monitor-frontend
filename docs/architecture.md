# Monitor architecture

Slashmon is a watcher, not an oracle. Its product goal is to give an Aztec
operator:

- the earliest defensible warning that one of their sequencers may be moving
  toward a slash;
- a realtime, per-sequencer position on the slashing protocol path;
- the next known transition and its deadline;
- the evidence and certainty behind a possible offense reason; and
- an aggregate view of network slashing and offense health.

The primary user object is therefore a **slashing case**, not an isolated
event. Events are evidence used to build a case.

This is the target conceptual architecture for the refactor. The current
journal already retains much of the evidence, but case projection and exact
case deep links can be introduced incrementally without changing the source
truth rules below.

## Two deliberately redundant surfaces

```text
                         per-sequencer cases
                                  ▲
                                  │
Monitor ── browser ── public Ethereum RPCs
   │
   └── independent when backend or Aztec node is unavailable

PINGME ── browser ── Slashmon backend ─┬─ one Aztec node + admin RPC
                                      ├─ public Ethereum RPCs
                                      ├─ case journal + durable outbox
                                      └─ Telegram / Web Push
```

### Monitor

Monitor runs entirely in the browser. Starting from the network Registry, it
resolves and verifies the canonical Rollup, Slasher, and SlashingProposer at a
pinned L1 block. It reads public votes, tallies, candidate action sets,
predicted payload addresses, vetoes, pauses, execution windows, executions,
and actual `Slashed` logs.

It does not call the Slashmon API, depend on a backend snapshot, or possess
notification credentials. A user can enter their addresses again and recover
the L1 portion of each case when the backend is unavailable.

Its unavoidable limitations are visible:

- an L1-only case starts at voting; it cannot see duty precursors or node
  offenses;
- it cannot state an offense reason because the vote does not encode one;
- public RPC history, log limits, latency, and outages constrain its view; and
- it cannot deliver reliable alerts after the browser closes.

### PINGME

PINGME adds continuity and earlier evidence. The backend polls one Aztec node's
offense feed and Sentinel duty history, independently reads L1, persists a
journal, constructs the richer case history, and delivers alerts while the
browser is offline.

Its limitations must also remain visible:

- positive node evidence is the attached node's observation, not network
  consensus;
- absence of evidence is useful only when that node is healthy, synced, and
  its cursor covers the relevant period;
- the backend can be stale or unavailable; and
- its Sentinel coverage is one node's view of public duties, even when it
  covers every L1 committee member.

## The slashing-case model

A case is a Slashmon projection, not an Aztec onchain object. It groups facts
about one sequencer and one protocol exposure while retaining their original
source records.

Each case needs:

| Field | Purpose |
| --- | --- |
| Sequencer and network | The watched validator identity, normalized exactly once |
| Contract lineage | Rollup, Slasher, and SlashingProposer responsible for the L1 facts |
| Protocol scope | Exact offense slot or epoch, target epoch, and slashing round when known |
| Local evidence | Duty misses, inactive-epoch progression, node offense types, penalties, and observation times |
| L1 state | Votes and support, candidate action, predicted payload, timing, veto/pause, execution, and `Slashed` logs |
| Current stage | Furthest supported live state or terminal branch |
| Next transition | Expected vote round, execution start, expiry, or withdrawal time |
| Provenance | Source, pinned block/cursor, observation time, health, and certainty for every claim |

The operator view should show a timeline with completed stages, the current
stage, stopped branches, and remaining time. Useful summaries include:

- “1 of 2 qualifying inactive epochs observed; no node offense yet.”
- “Node registered duplicate proposal in slot 12,345; target vote round starts
  in 41 minutes.”
- “Candidate 2,000 AZTEC slash; executable in 2 days. This node observed
  inactivity in target epoch 123.”
- “Round executed, but no canonical `Slashed` log was emitted for this
  address.”
- “2,000 AZTEC removed; remaining stake is still at the ejection threshold.”

“Reason: inactivity” must always carry a provenance badge such as “node
evidence.” L1-only cases say “reason unknown on L1.”

### Linking rules

Linking must be deterministic and conservative:

1. Node duty records link to an inactivity progression only for the same
   address and exact epoch. Consecutive status follows the node's own
   committee-participation rules and coverage generation; unknown gaps never
   extend a streak.
2. A node offense links to precursor evidence only for the same address and
   compatible exact epoch or slot. The raw events remain independently
   inspectable.
3. Node evidence may be attached to an L1 action only for the same address and
   exact target epoch, when the observation predates the L1 transition.
4. L1 vote, tally, candidate, and execution records link by contract lineage,
   slashing round, target epoch, and address—not by payload address alone.
5. An actual slash links through the canonical execution transaction and
   Rollup `Slashed` log. The emitted amount replaces no earlier value; requested
   and actual amounts remain separate fields.
6. L1 reorgs invalidate affected observations and recompute the case. A
   correction remains in history rather than silently rewriting an alert.

These rules intentionally do not promise one case per offense. Several node
offenses for one validator in one epoch can be summed into a single two-bit L1
vote unit. Different voters may also have different evidence for the same
unit. In that situation the case presents all matching local evidence and says
that the L1 reason is unknown.

An L1 event with no backend evidence still creates a case. A backend event with
no L1 continuation remains a stopped local case instead of disappearing.

### Case stages and terminal branches

The shared vocabulary is:

```text
observing
  → precursor
  → node offense
  → awaiting target round
  → L1 support
  → candidate
  → delayed
  → executable
  → executed
  → stake removed
  → ejected / exiting
```

Possible terminal or side states include `resolved locally`, `withdrawn by
node`, `insufficient L1 support`, `candidate changed`, `vetoed`, `paused`,
`expired`, `execution without deduction`, and `reorged`. “Paused” is not
terminal unless the known pause covers the complete remaining execution
window.

The most urgent active case determines the address-level headline. The full
history remains available because one sequencer can have cases in several
target epochs at once.

## Evidence and certainty

| Source | What it can establish | What it cannot establish |
| --- | --- | --- |
| Sentinel | This node's per-duty status, completed epoch ratio, and configured inactivity progression | A registered offense or an L1 vote |
| Node admin offense feed | This node registered an offense type and local penalty | Agreement by other nodes or L1 voters |
| SlashingProposer state | Votes, target epochs, support, candidate actions, timing, and predicted address at a pinned block | Offense reason or deployed payload before execution |
| `RoundExecuted` | The round was marked executed; a nonempty action list caused its payload to be deployed and called in that transaction | Any actual deduction; an empty action round deploys no payload |
| Rollup `Slashed` | Actual address and amount deducted in the canonical transaction | Which offense motivated the voters |
| Rollup/GSE stake state | Current balance and validating/ejection/exit state | A historical reason unless linked to retained events |

The frontend must show source time and freshness independently. “Confirmed”
means an L1 fact observed at the stated block and confirmation policy; it does
not mean Ethereum-finalized unless the block itself is finalized.

## Canonical contract discovery

Both collectors start from the configured Registry and resolve the canonical
Rollup. From that Rollup they discover the active Slasher and its
SlashingProposer, verify reciprocal links and bytecode, and use a coherent
pinned L1 block for one snapshot.

Upgrades require more than the current stack:

- a pending Rollup or Slasher can already expose future parameters;
- a replaced Slasher can remain authorized to finish old rounds; and
- logs and cases must retain the stack that emitted them.

The scanner therefore follows active, pending, and still-authorized legacy
lineages. It never trusts a hard-coded implementation address as canonical.

## Backend data flow

The backend has three independent observation sources:

- `aztec_sentinel` records bounded early inactivity transitions while retaining
  the underlying duty index;
- `aztec_node` records locally registered offenses; and
- `ethereum_l1` records pinned slashing state and canonical logs.

Before accepting admin data, it checks that public and admin endpoints belong
to the same node and that the node reports the expected chain, Registry, and
Rollup. Prior state is retained during an outage. A missing node offense clears
only after a fresh, non-regressing cursor has advanced safely beyond it.

Sentinel work is epoch-gated and committee-scoped. Once an epoch is ready after
the node's processing buffer, the collector resolves its committee at the
already accepted L1 block and requests exact-range stats for those members.
Unknown catch-up gaps start a new coverage generation so they cannot fabricate
an inactivity streak.

Confirmed-log scanning uses a durable block/hash checkpoint, overlapping
reads, and reorg rewind. SQLite atomically records each stable event, indexes
its target addresses, matches watches, and inserts unique delivery jobs.
Delivery is at-least-once, so a provider-accepted alert can repeat after a
crash; stable event IDs let clients recognize that duplicate.

## Network-health view

The network overview should aggregate **cases and protocol state**, not raw
event counts:

- sequencers with new precursors or node offenses, labelled as this node's
  observations;
- target rounds, participation, validator support, and candidate stake at risk;
- candidates in delay, executable, vetoed, paused, expired, or changed;
- executed actions versus actual slash deductions;
- ejections and pending exits; and
- source freshness, chain-tip/proof health, contract rotation, and reorg status.

The overview must never market one backend node's offense feed as a complete
network consensus feed. L1 aggregates are network facts at their stated block;
local offense aggregates are an observation sample.

## Refactor invariants

Future implementation work should preserve these constraints:

- Monitor has no runtime dependency on PINGME or its API.
- Both surfaces share protocol vocabulary, decoding rules, fixtures, and case
  semantics even though their availability paths remain independent.
- Every user-facing reason and amount exposes its source.
- Candidate, deployed payload, executed round, and actual deduction remain
  separate states.
- Address plus approximate time is never enough to correlate evidence.
- Current parameters come from the responsible canonical contract lineage.
- Stale or partial sources remain visible and never erase last-known history.
- Deep links open the exact case and evidence, not merely a dashboard.

See [Aztec protocol model](protocol.md),
[Slashing and ejection](slashing.md), and the
[notification content contract](notifications.md).
