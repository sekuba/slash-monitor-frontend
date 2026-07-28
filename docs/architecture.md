# Architecture

Slashmon is a monitor, not an oracle. Its two views overlap deliberately but
have different availability and evidence.

```text
Independent L1 check ── public Ethereum RPC ── Registry → Rollup
                                                   └── Slasher → SlashingProposer

Live monitor ── HTTPS API ── fixed-network backend ┬── the same L1 contracts
                                                   ├── one Aztec node
                                                   ├── SQLite + durable outbox
                                                   └── Telegram / Web Push
```

## Evidence boundaries

| Evidence | What Slashmon may claim | What it must not claim |
| --- | --- | --- |
| Node observation | This Aztec node recorded an offense for a validator. | That Ethereum voters agreed, or that a slash will happen. |
| L1 vote and tally | A designated proposer cast a slot vote; the current tally requests concrete actions after quorum. | That the node observation caused the vote, or that every vote supports the displayed target. |
| Predicted payload | The current action list deterministically maps to this exact payload address. | That a payload contract already exists before execution, or that the list cannot change while voting is open. |
| Slasher controls | This exact payload address is vetoed, or execution is globally paused until a timestamp. | That every future payload is blocked. A different payload is different, and the pause can be changed. |
| Rollup `Slashed` log | This amount was actually removed from this validator in this canonical transaction. | That an executed round necessarily removed the tally's full proposed amount. |

A node offense is mutable local evidence. Aztec watchers can add and clear
offenses, and the local store expires them. The hosted view therefore labels
their source and resolution instead of merging them into an L1 case. Any amount
is the node-configured penalty for that offense type, not an L1 tally or
confirmed loss. Relevant
implementations are
[`slash_offenses_collector.ts`][slash-offenses-collector],
[`offenses_store.ts`][offenses-store], and [`types.ts`][slashing-types].

On L1, the current checkpoint proposer may submit at most one encoded vote per
slot. Each committee position has two bits for zero to three slash units. Votes
for a larger unit count also count toward smaller amounts. `VoteCast` identifies
the round, slot, and proposer but not its targets; the contract's tally over the
encoded votes and target committees is the target-level evidence. See
[`SlashingProposer.sol`][slashing-proposer].
The round's `voteCount` is submitted slot votes, not unique voters or support
for a particular validator.

After tallying, `getPayloadAddress` predicts the CREATE2 address for the exact
round and action list. The clone is deployed only inside `executeRound`, then
immediately passed to the Slasher. A veto in
[`Slasher.sol`][slasher]
is permanent for that exact address, but voting can still produce a different
address. The global pause is temporary and can be cleared or extended by the
vetoer. Neither mechanism extends the round's execution lifetime.

The authoritative loss is the canonical Rollup's `Slashed(attester, amount)`
log, defined by
[`IStaking.sol`][staking-interface].
The Rollup can cap a requested amount to the remaining stake, and an action can
complete without producing a slash when the validator is no longer slashable.
The Slasher also accepts governance calls, so Slashmon does not assign a loss
to a round without same-transaction evidence. An executed tally and an actual
loss are therefore separate records. See
[`StakingLib.sol`][staking-lib].

Aztec's operator documentation provides the protocol overview:

- [Slashing and offenses](https://docs.aztec.network/operate/operators/sequencer-management/slashing_and_offenses)
- [Validator identity model](https://docs.aztec.network/operate/operators/concepts/identity-model)

Slashmon uses **validator** for the staking/attester identity. That same
identity can be selected to propose or sequence; those roles do not imply
different watched addresses.

## Canonical case model

A slashing case belongs to one deployment stack and round. Its phase is one of
`voting`, `review`, `ready`, `paused`, or `closed`; its terminal outcome can be
`vetoed`, `executed`, `expired`, `stack-retired`, or `no-consensus`. Phase,
payload state, node evidence, and actual loss remain separate fields.

The phase is derived from pinned L1 state:

1. **Voting** — the round is still accepting votes. A displayed tally is
   provisional.
2. **Review** — voting has closed and the strict execution delay has not passed.
3. **Ready** — execution is permitted and the round is within its lifetime.
4. **Paused** — the round is otherwise ready, but the Slasher's global pause is
   currently active.
5. **Closed** — the round executed, expired, its final exact payload was vetoed
   after voting closed, or its slashing stack lost Rollup authorization.

A closed round with no quorum-backed actions is “voting closed · no slash
requested.” A round can execute with no matching `Slashed` log, which is
“round executed · no slash recorded,” not a confirmed slash.

### Repeated validator actions

The tally is position-based. The same validator address can occupy positions in
multiple target-epoch committees and produce multiple actions in one round.
Slashmon groups them for the main display:

- `proposedAmount` is the sum of the address's actions;
- `actionCount` preserves how many actions were combined; and
- target epochs stay on the case while raw actions remain internal evidence.

Confirmed loss is grouped independently by chain, block hash, transaction
hash, and validator. Amounts from matching `Slashed` logs are summed and the
log count is retained. Grouping prevents one transaction from appearing as
several incidents without hiding that several onchain actions occurred.

### Slasher rotation

The current Rollup can expose an active, pending, and legacy Slasher:

- the active stack is executable;
- an outgoing legacy stack is executable only through its recorded
  authorization deadline; and
- a pending stack is not yet authorized and is excluded from risk cases.

After the legacy deadline, its open cases become `stack-retired`. The relevant
authorization logic is in
[`StakingLib.sol`][staking-lib]
and the accessors are in
[`Rollup.sol`][rollup].

## Independent L1 check

The browser starts from the configured Registry, resolves the canonical Rollup
and slashing stacks, validates their links, and reads each snapshot at a pinned
Ethereum block two blocks behind the latest head. It reconstructs current cases
after every refresh and stores no server-side state.

It can verify canonical deployment identity, round timing, vote counts,
tallies, predicted addresses, exact vetoes, the global pause, rotations, and
public logs. It cannot recover target bytes from `VoteCast`, identify an
offense reason, inspect P2P evidence, know council intent, or provide a
probability of execution. RPC errors and observation time remain visible.
Its recent-loss check is bounded to the displayed block range and the current
canonical Rollup. The hosted scanner maintains receipt history across Rollup
upgrades.

## Hosted backend

One backend process serves one configured network. Its database is bound to the
network, chain, and Registry; changing identity requires a fresh database. It:

1. checks that the public and admin endpoints describe the expected Aztec node
   and canonical Rollup;
2. records the node's current offense observations;
3. scans the active and still-authorized legacy L1 stacks at pinned blocks;
4. follows canonical Rollup `Slashed` logs with overlap and reorg correction;
5. serves compact monitor and validator records; and
6. matches watched addresses into a durable Telegram/Web Push outbox.

SQLite is the consistency boundary for watch changes, incident creation,
target matching, and delivery jobs. Delivery is at-least-once: a provider can
accept an alert immediately before a crash, causing one repeat after restart.
Stable incident IDs let recipients recognize that narrow duplicate.

## Sparse alert policy

The page may show intermediate detail without turning every refresh into a
notification. A watched validator receives an incident only for a meaningful
transition:

- its first current node observation;
- its first quorum-backed L1 candidate;
- the candidate becoming executable;
- its exact payload being vetoed or its execution window expiring;
- confirmed loss, grouped per transaction and validator; or
- a canonical-chain correction to a previously reported loss.

Slashmon does not alert on every slot vote, unchanged poll, ordinary tally
refresh, round execution without confirmed loss, or historical backfill. A
channel test is clearly labelled as a test rather than an incident.

Every incident names the watched validator, transition, and relevant round or
epoch. It links to the validator view and, when available,
the exact transaction, block, or payload. Operator-facing amounts are formatted
as AZTEC rather than raw 18-decimal integers, and proposed and actual amounts
are never presented as interchangeable. A compact stable incident ID is
included for duplicate recognition.

## Interface constraints

Both views render the same case components and status vocabulary. The frontend
keeps Slashmon's neobrutalist palette, hard borders, and offset shadows, while
meaning always comes from text as well as color. Source, freshness, and manual
refresh stay visible; contract addresses and other advanced evidence stay
available without dominating the first screen.

## Security boundaries

- Every frontend `VITE_*` value is public. Provider credentials stay in the
  backend environment.
- The Aztec admin endpoint remains private. Only the loopback HTTP API is
  exposed through the HTTPS proxy.
- The alert-management token is a bearer capability stored by browser origin.
  It never appears in a URL.
- Public API records contain public protocol observations, not watch
  membership, channel endpoints, tokens, or delivery state.
- One Node 24 process owns one SQLite file. Multiple processes would race
  Telegram polling and external delivery even if SQLite serialized writes.

[slash-offenses-collector]: https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/slasher/src/slash_offenses_collector.ts
[offenses-store]: https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/slasher/src/stores/offenses_store.ts
[slashing-types]: https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/stdlib/src/slashing/types.ts
[slashing-proposer]: https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/core/slashing/SlashingProposer.sol
[slasher]: https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/core/slashing/Slasher.sol
[staking-interface]: https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/core/interfaces/IStaking.sol
[staking-lib]: https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/core/libraries/rollup/StakingLib.sol
[rollup]: https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/core/Rollup.sol
