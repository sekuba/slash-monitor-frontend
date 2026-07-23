# Architecture

Slashmon is a watcher, not an oracle. Its two product surfaces have different
availability and trust models.

```text
Monitor (browser) ── public Ethereum RPC ── canonical Aztec contracts

PINGME (browser) ── HTTP API ── backend ┬─ Aztec node + admin RPC
                                       ├─ Ethereum RPC
                                       ├─ SQLite duty index + journal + outbox
                                       └─ Telegram / Web Push
```

## Monitor

Monitor runs entirely in the browser. Starting from the configured Registry,
it resolves the current Rollup, Slasher, and SlashingProposer, validates their
links, and reads round state at pinned L1 blocks. It derives votes, quorum,
payload targets, vetoes, pauses, execution windows, and rotations from public
contract state.

Monitor does not use backend snapshots or notification credentials. Reloading
it reconstructs the current view from L1. RPC failures remain visible instead
of being replaced with cached data presented as fresh.

## PINGME and backend

PINGME manages address watches and displays the backend event journal. The
backend owns alert continuity because a browser may sleep or be closed.

There are three event sources:

- `aztec_node` events are early, node-local offense observations. They are
  useful positive signals but are always `pending`.
- `aztec_sentinel` events are bounded precursor signals: the first observed
  miss in an epoch and a completed duty-bearing epoch above the configured
  inactivity target. The database keeps every duty, while alert volume stays
  bounded to at most these two transitions per sequencer and epoch.
- `ethereum_l1` events come from coherently pinned canonical contract reads or
  confirmed `Slashed` logs. They are `confirmed`.

The backend checks node chain, Registry, and Rollup identity before trusting
admin results. It retains prior state when a source fails. An offense can
disappear only after a ready, fresh, non-regressing node cursor advances past
that offense's slot or epoch.

Sentinel collection is forward-first and epoch-gated. Minute polls check node
sync, but make no stats or committee calls until an epoch is ready after both
the node's two-slot processing lag and configured epoch-end buffer. The
collector then resolves that epoch's committee at its already-confirmed L1
block and issues bounded exact-range `aztec_getValidatorStats` calls only for
those members. Thus work scales with committee size, not the registered
validator set.

The same three-epoch default window bounds L1 committee lookup and Aztec node
history lookup on initial start or after a cursor gap. Committee membership is
persisted even for zero-duty members; every returned node aggregate is checked
against its exact slot history. A gap beyond the window starts a new coverage
generation so unknown epochs cannot extend a precursor streak. The admin
offense feed remains authoritative for actual offense registration.

The L1 scanner resolves active, pending, and still-authorized legacy slashing
stacks. It distinguishes a round's timing window from the Slasher's global
pause: delayed, protected-through-scheduled-expiry, vetoed, and currently
executable are not interchangeable states. Actual stake removed is reported
from confirmed `Slashed(attester, amount)` logs, not inferred from a proposed
payload amount.

L1 vote words allocate two bits per target to slash units; they do not encode
offense type. When an L1 round mentions an address, the journal therefore
attaches separately labelled node evidence only when the address and target
epoch match exactly and the node observation predates the L1 event. Multiple
offenses or precursor records can be retained for one target.

Confirmed-log scanning uses a durable block/hash checkpoint, bounded initial
lookback, overlapping reads, and reorg rewind. Orphaned unsent alerts are
cancelled and target-scoped correction events are created. Backfill work is
time-bounded so fresh round snapshots are not starved.

## Journal and outbox

SQLite is the backend's consistency boundary. In one transaction it:

1. records a stable event and its target addresses;
2. matches enabled, verified endpoints on the same network; and
3. inserts unique delivery jobs.

Workers lease jobs and retry according to severity. Delivery is at-least-once:
a provider may accept a message immediately before the backend crashes, causing
one duplicate after restart. Avoiding that narrow duplicate would require
risking a silent miss.

Web Push endpoints receive a private verification message before real alerts.
Telegram verifies the configured bot identity before advertising links or
sending incidents. One-time Telegram links are hashed, expiring, and consumed
atomically. The bot uses durable long-poll offsets, so no public webhook is
needed.

## Security boundaries

- Frontend `VITE_*` settings are public. All RPC secrets and provider tokens
  stay in the backend environment.
- The subscription management token is a bearer capability stored in
  origin-wide browser storage. Production PINGME needs a dedicated origin with
  no third-party JavaScript.
- The Aztec admin endpoint stays private. Only the HTTPS API is proxied from the
  backend's loopback listener.
- The public journal exposes public-address observations, not watches,
  endpoints, tokens, or delivery state. Capability-scoped journal reads reveal
  only events matching that watch.
- The database is bound to one network, chain, and Registry.

## Deployment model

The supported shape is one Node 24 process, one SQLite file, one local reverse
proxy, one Aztec node, and one or more Ethereum RPCs. Running two backend
processes against the same identity is unsupported because Telegram polling and
provider delivery would race even if SQLite serialized writes.
