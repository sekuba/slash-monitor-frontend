# Slashmon v2 architecture

Slashmon is a small watchtower, not an oracle. It watches two different signal
planes, writes what it saw to one durable journal, and tries hard to wake the
people whose sequencers are in the blast radius.

```text
Aztec node + admin APIs ─ pending / node-local signal ─┐
                                                     ├─ SQLite event journal
Ethereum L1 RPC ───── verified slashing state ──────┘          │
                                                               ├─ Telegram
                                                               └─ PWA Web Push
```

## Two signals, two confidence levels

An offense returned by `aztecAdmin_getSlashOffenses("all")` is an early warning
from the particular Aztec node Slashmon is attached to. It may disappear, be
withdrawn, or disagree with another node. The UI and messages call this
**pending / node-local**. It is useful precisely because it arrives early; it is
not L1 proof.

That signal is still pinned to an identity. Every offense poll first calls
`aztec_getNodeInfo()` on the node API and checks its L1 chain and Registry
against backend configuration. After the independent L1 scanner has resolved
the canonical Rollup, the node must report that same Rollup too. A mismatch
fails closed and retains the last good snapshot. The SQLite journal itself is
bound on first startup to one `(network, chain ID, Registry)` tuple, so an env
mistake cannot quietly relabel historical events.

The public-node and admin URLs are separate ports but must belong to the same
Aztec node. This is a deployment trust invariant, not something the current
documented admin wire format can prove: `aztecAdmin_getConfig()` returns an
opaque config type with no promised chain/Registry/Rollup fields. Slashmon keeps
that call outside its fixed allowlist rather than depending on guessed fields.

The canonical Rollup is a startup prerequisite for node-local persistence, not
an eventual consistency check. Once it exists, Slashmon samples the fixed
`aztec_isReady`, synced-L1-timestamp, synced-L2-slot, and synced-L2-epoch RPCs
with every offense snapshot. A newly reported offense remains useful positive
evidence even during a sync wobble. Disappearance is held to a higher bar: the
cursor must be ready, fresh, non-regressing, and newer for the offense's time
unit. Thus a fast polling loop cannot withdraw an epoch offense three times
while the node is still looking at one epoch, and a rolled-back or stalled node
cannot erase an earlier warning.

The L1 scanner resolves the canonical Rollup, Slasher, and SlashingProposer from
the Registry, validates their links, and reads the slashing rounds at a pinned
Ethereum block. It decodes each new two-bit vote against the target committees,
so a watched address can be warned from the first onchain vote instead of
waiting for quorum. A payload and its target list are called **L1 verified**
only after those reads complete coherently. During a slasher rotation, pending
state is surfaced and authorized legacy rounds remain visible until their drain
window closes; every event keeps the stack role that produced it.

The proposer's execution window and the Slasher's global switch are separate
pieces of state. A round can reach its timing-based execution window while its
Slasher is paused. That round is **blocked right now**, not currently callable.
It is only **protected through the scheduled pause** when the round expires no
later than the pause is due to end. A later-expiring round is merely delayed: it
can become slashable when the scheduled pause ends. The vetoer can also lift a
pause early, so even “protected through expiry” describes the current schedule,
not an irreversible promise.

Notifications keep that distinction intact. Opening an execution window behind
a pause is still worth an early warning, especially when the round outlives the
pause. If the pause lifts while the round remains live, the newly actionable
state deserves an urgent follow-up even though the proposer's timing status did
not change. A pause beginning on an already-actionable round is a separate,
lower-risk state transition rather than evidence that the payload disappeared.
Pause state belongs to each active, pending, or legacy Slasher stack; it is not
silently treated as one network-wide boolean.

Tally action amounts are the amounts proposed by the round. An executed-round
alert proves that the round executed, but the staking contract can cap the
amount actually removed to the sequencer's remaining stake. Slashmon therefore
does not relabel the proposed amount as realized loss. A separate confirmed-log
lane ingests the Rollup-emitted `Slashed(attester, amount)` event and reports
that event's actual capped amount.

That lane follows historical Rollup emitters through the Registry's
`CanonicalRollupUpdated` log, scans bounded confirmed block ranges, and commits
each block/hash cursor atomically with target events and delivery jobs. It
resumes after arbitrarily long process outages; the initial history window is
the only bounded lookback. Overlapping reads are deduplicated by block hash,
transaction hash, and log index. A checkpoint mismatch rewinds a configured
tail, cancels unsent work from orphaned logs, and creates target-scoped
corrections. Catch-up has a strict wall-clock budget per L1 poll so snapshot
early warnings remain fresh while old log ranges drain over later polls.
Emitter history is resolved again for every canonical range; an address seen
only on an orphaned fork is never carried forward as a trusted log source.

Source loops fail independently. A rebooting Aztec node must not stop L1 scans,
and an unhappy Ethereum RPC must not erase the last good pending snapshot.
An RPC that repeatedly serves one confirmed height is treated as failed after
a missed-slot grace window and triggers whole-scan failover; a fresh HTTP 200
is not evidence that the chain view is moving.

## Durable state before delivery

SQLite is the continuity boundary. Source observations become stable events,
events are matched against normalized `(network, sequencer address)` watches,
and delivery jobs are inserted in the same transaction. Restarting the process
must not reconstruct this state from browser memory.

Delivery is at-least-once. Telegram and browser push services do not offer a
portable idempotency key, so a crash after a provider accepted a message but
before SQLite recorded success can produce a duplicate. Stable event IDs and a
unique event/destination outbox constraint prevent ordinary duplicates; the
remaining crash-window duplicate is preferable to a silent miss.

The database stays at
`/var/lib/slashmon-offense-collector/offenses.sqlite` for the v1-to-v2
migration. The old name is ugly but losing continuity is uglier.

## Notification channels

Telegram uses official Bot API long polling. There is one poller, its update
position is durable, and command processing is idempotent. No public Telegram
webhook is required. A separate serverless bot layer would not remove the
always-on collector that already needs the private Aztec admin API and L1 RPC;
it would only add another trust and failure boundary.

The PWA uses standards-based Web Push. The service worker can display a pushed
alert while the page is closed, subject to the browser and operating system's
best-effort delivery rules. The dashboard still needs a network connection;
Slashmon does not present cached monitoring data as fresh truth.

Push setup has an explicit delivery handshake. An endpoint begins unverified
and is eligible only for a private wire check. Provider acceptance arms it and
transactionally queues a catch-up of matching current state; real incident
deliveries cannot race ahead of verification. Unverified endpoints expire, so
anonymous subscriptions cannot grow into permanent fanout state.

Telegram startup verifies the token's bot username with `getMe` and removes any
webhook before polling. Telegram incident delivery remains gated until that
identity check succeeds; the API neither advertises Telegram nor issues a link
before then. Random private chat messages receive no bot response; only a valid
one-time `/start` capability can establish a channel.

There are no native Android/iOS apps in v2. Signal is not a supported v2
channel. Both can be revisited later without changing the journal/outbox model.

## Browser and backend responsibilities

The backend is authoritative for alert delivery because browsers sleep. The
browser remains useful as an independent reader of public L1 state and clearly
shows source freshness and confidence. A backend alert should always lead to a
view that a user can verify, not demand blind trust in the alerting server.

Frontend build variables are public. Only the public API origin and public L1
configuration belong in `VITE_*`; Aztec admin credentials, RPC secrets,
Telegram tokens, Web Push subscription keys, and the VAPID private key stay in
the backend environment and database.

The watch-list management key lives in origin-wide browser storage. Production
therefore gives Slashmon a dedicated domain/subdomain. A project path on a
shared `name.github.io` origin remains useful for the public monitor, but the
PWA refuses to create notification watches there; service-worker path scope is
not a storage security boundary.

Public HTTP reads expose source health, the latest active offenses proposed by
Slashmon's Aztec node, and the combined node-local and Ethereum L1 event feed.
Node-local items are explicitly labelled pending because they represent one
node's early view rather than consensus. Bearer-capability watch-list reads
intersect the same feeds with the list's addresses; the capability protects
watch management and address associations, not the underlying public signal.

## Deployment shape

The supported small deployment is intentionally boring:

- one Node 24 backend process under systemd;
- one SQLite database on persistent local storage;
- one private Aztec node endpoint and one private admin endpoint;
- one Ethereum execution RPC, with optional whole-scan failover;
- one HTTPS reverse proxy in front of the loopback API; and
- a static PWA, either same-origin or configured with its public API origin.

That shape is easy to inspect, back up, and recover. If Slashmon eventually
needs active/active workers, SQLite ownership and Telegram polling must be
revisited before adding a second process.
