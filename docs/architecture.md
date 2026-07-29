# Monitor architecture

slashveto.me watches and links protocol evidence. Its product goal is to give
an Aztec operator:

- the earliest defensible warning that one of their sequencers may be moving
  toward a slash;
- a realtime, per-sequencer position on the Slashing Timeline;
- the next known transition and its deadline;
- the evidence and certainty behind a possible offense reason; and
- an aggregate feed of active network slashing and offense health.

The primary user object is therefore a **slashing case**, not an isolated
event. Observations are evidence used to build a case. V3 implements this model
as a clean break: the old event feed, schema, API, adapters, and screens do not
exist alongside it.

## Two deliberately redundant surfaces

```text
                         per-sequencer cases
                                  ▲
                                  │
Monitor ── browser ── public Ethereum RPCs
   │
   └── independent when backend or Aztec node is unavailable

PINGME ── browser ── slashveto.me backend ─┬─ one Aztec node + admin RPC
                                      ├─ public Ethereum RPCs
                                      ├─ case store + durable outbox
                                      └─ Telegram / Web Push
```

### Monitor

Monitor runs entirely in the browser. Starting from the network Registry, it
resolves and verifies the canonical Rollup, Slasher, and SlashingProposer at a
pinned L1 block. It reads public votes, tallies, candidate action sets,
predicted payload addresses, vetoes, pauses, execution windows, executions,
and actual `Slashed` logs.

It does not call the slashveto.me API, depend on a backend snapshot, or possess
notification credentials. A user can enter their addresses again and recover
the L1 portion of each case when the backend is unavailable.

Execution history is progressive and RPC-aware. Monitor reads present contract
state first, then scans `RoundExecuted` logs newest-to-oldest within the useful
execution window. It starts with small ranges, grows fast successful ranges,
shrinks provider-rejected ranges, and pauses on rate limits while retaining
completed work for the page session. Each refresh scans only new blocks plus a
small reorg overlap. A cooperative RPC/time budget inserts a short yield between
scan batches; it does not defer unfinished history to the normal three-minute
state refresh.
The page displays exact coverage. Until a receipt is inspected, the case says
that its outcome is still being scanned; it never treats missing coverage as
proof that no `Slashed` log exists. A stronger user-supplied RPC can complete
the same bounded scan faster without changing case semantics.

Switching to PINGME pauses Monitor without making background RPC requests. Its
in-memory scanner, coverage cursor, and projected evidence remain available for
10 minutes. Returning within that window refreshes the L1 head and continues
incrementally. Expiry, an RPC change, a network change, or a deployment change
starts a clean scanner session. This cache is never persisted to browser
storage.

Its unavoidable limitations are visible:

- an L1-only case starts at voting; it cannot see duty misses or node
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

### Shared presentation, separate availability

The routes share their visual language: network health, the case feed,
address cards, abbreviated case path, Slashing Timeline, and evidence
details are the same components. Their collectors stay separate. This avoids
coupling backend availability to the browser collector or starting the
browser scanner merely because PINGME is unavailable.

### Links and capabilities

A watchlist link serializes only normalized public sequencer addresses. It
works on Monitor or PINGME and never contains a backend watch ID, management
token, notification endpoint, or Telegram association. Opening a PINGME
watchlist link is read-only; the recipient must explicitly adopt it before
their private watch or notifications change.

Every case also has a compact copy-link action. Case links retain the exact
case ID for notifications and investigations, but the watchlist remains the
primary shareable user context. A missing or obsolete private watch capability
does not suppress the public network feed.

## The slashing-case model

A case is a slashveto.me projection, not an Aztec onchain object. It groups facts
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
2. A node offense links to duty evidence only for the same address and
   compatible exact epoch or slot. The raw observations remain independently
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
  → duty miss
  → node offense
  → awaiting target round
  → L1 mention
  → candidate
  → execution delay
  → executable
  → executed
  → stake removed
  → ejected / exiting
```

Possible terminal or side states include `resolved locally`, `withdrawn by
node`, `insufficient L1 votes`, `candidate changed`, `vetoed`, `paused`,
`expired`, `execution without deduction`, and `reorged`. “Paused” is not
terminal unless the known pause covers the complete remaining execution
window.

The most urgent active case determines the address-level headline. The full
history remains available because one sequencer can have cases in several
target epochs at once.

Watchlist rows summarize one sequencer before expanding its cases: open-case
count, pending requested amount, confirmed stake removed, and current effective
stake. Stake is sequencer state rather than case evidence: both views batch
`Rollup.getAttesterView` through Multicall at their displayed protocol block
and verify that block's hash before and after the read. The public feed
collapses cases by exact payload address. Cases
without a payload remain separate because shared timing or stage does not prove
that they belong to one L1 action. Payload groups are ordered by descending
slashing round; pre-payload groups follow in most-recent order.

An active case pulses at its current Slashing Timeline stage. Terminal cases
remain still. The feed also derives the current round and current-epoch progress
from the live slot and responsible lineage parameters.
Visible sequencer addresses open the matching mainnet or testnet Dashtec page.

## Evidence and certainty

| Source | What it can establish | What it cannot establish |
| --- | --- | --- |
| Sentinel | This node's per-duty status, completed epoch ratio, and configured inactivity progression | A registered offense or an L1 vote |
| Node admin offense feed | This node registered an offense type and local penalty | Agreement by other nodes or L1 voters |
| SlashingProposer state | Votes, target epochs, support, candidate actions, timing, and predicted address at a pinned block | Offense reason or deployed payload before execution |
| `RoundExecuted` | The round was marked executed; a nonempty action list caused its payload to be deployed and called in that transaction | Any actual deduction; an empty action round deploys no payload |
| Rollup `Slashed` | Actual address and amount deducted in the canonical transaction | Which offense motivated the voters |
| Rollup/GSE stake state | Current balance and validating/ejection/exit state | A historical reason unless linked to retained observations |

The frontend must show source time and freshness independently. “Confirmed”
means an L1 fact observed at the stated block and confirmation policy; it does
not mean Ethereum-finalized unless the block itself is finalized.
For Monitor, receipt coverage is also explicit: `scanning`, `paused`,
`inspected`, and `complete without finding the expected event` are different
states.

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
reads, and reorg rewind. An operator can anchor the journal to an exact L1
block; mainnet v5 starts at block `25533241`. Changing that anchor restarts the
historical pass without deleting existing observations or sending historical
notifications. Log requests remain bounded to 1,000 blocks. When a historical
`Slashed` log refers to a round that has aged out of the live snapshot, the
scanner reads the proposer at that log's exact archive block, decodes the
stored votes and tally, and uses receipt action order to recover the target
epoch. The reconstructed executed-round observation and the actual deduction
are committed together; an address-only match is never accepted. SQLite
atomically records observations, reprojects
affected cases, records stable transitions, matches watches, and inserts
unique delivery jobs. Delivery is at-least-once, so a provider-accepted alert
can repeat after a crash; stable transition IDs identify that duplicate.

## Network-health view

The network overview should aggregate **cases and protocol state**, not raw
event counts:

- sequencers with new duty misses or node offenses, labelled as this node's
  observations;
- target rounds, participation, validator support, and candidate stake at risk;
- candidates in delay, executable, vetoed, paused, expired, or changed;
- executed actions versus actual slash deductions;
- ejections and pending exits; and
- source freshness, chain-tip/proof health, contract rotation, and reorg status.

The public case feed contains every currently active case and a small,
most-recent set of execution outcomes. It omits expired, locally resolved, and
reorg-only history. PINGME includes Sentinel duty misses and node offenses;
Monitor shows the same feed shape starting at independently observed L1
mentions.

The overview must never market one backend node's offense feed as a complete
network consensus feed. L1 aggregates are network facts at their stated block;
local offense aggregates are an observation sample.

## V3 invariants

Implementation work must preserve these constraints:

- Monitor has no runtime dependency on PINGME or its API.
- Both surfaces share protocol vocabulary, decoding rules, fixtures, and case
  semantics even though their availability paths remain independent.
- Every user-facing reason and amount exposes its source.
- Candidate, deployed payload, executed round, and actual deduction remain
  separate states.
- Address plus approximate time is never enough to correlate evidence.
- Current parameters come from the responsible canonical contract lineage.
- Stale or partial sources remain visible and never erase last-known history.
- Public watchlist links contain addresses but never private watch
  capabilities.
- Notification and case-share links open the exact case and evidence, not
  merely a dashboard.

See [Aztec protocol model](protocol.md),
[Slashing and ejection](slashing.md), and the
[notification content contract](notifications.md).
