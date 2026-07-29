# Slashing and ejection

Aztec v5 slashing is not one event. It is a path from local observations,
through delayed L1 voting, to an optional stake deduction:

```text
duty miss ──→ node offense ──→ target vote round ──→ L1 mention
   │               │                 │                    │
   └─ resolved     └─ withdrawn      └─ no support        ↓
          candidate action ──→ delay ──→ executable ──→ execution
                  │              │            │               │
                  └─ changes     ├─ veto       ├─ expires      ↓
                                 └─ pause                Slashed log
                                                              │
                                                              └─ ejection?
```

slashveto.me's main job is to place each watched sequencer at the furthest
supported point on this path, show the time to the next transition, and retain
the evidence behind every earlier step. A duty miss may end before L1 voting,
and an executed round may complete without removing stake.

## The lifecycle

### 1. A node observes evidence

Aztec nodes watch P2P messages, checkpoint data, attestations, and local duty
history. Sentinel is the node component that records whether selected
validators fulfilled their proposer or committee duties.

A first missed duty or one inactive epoch is a **duty miss**. It can justify an
early operator warning without being a slash offense. Each node applies its own
configured threshold, consecutive-epoch requirement, grace period, penalties,
and exemptions before registering an offense.

Node evidence is useful but local:

- another node may not have observed the same P2P messages;
- a transient offense can later disappear from the admin feed;
- a configured penalty can be zero even though detection is enabled; and
- a local allow/deny policy can add or suppress a vote.

The backend therefore labels these observations as node evidence, never as
network consensus.

### Local policy gates

Before constructing a ballot, the reference client applies controls that are
not enforced by the L1 SlashingProposer:

- the reference mainnet preset ignores offenses during the first 8,400 L2
  slots after a newly canonical Rollup was registered (seven days at
  72-second slots);
- configured `always` and `never` address lists can add or remove local
  choices;
- unless self-slashing is explicitly enabled, a node adds its own validator
  addresses to its `never` list; and
- local offenses expire and ballot construction has a configured size bound.

These controls change one node's evidence feed or ballot. They do not grant
onchain immunity: other selected proposers apply their own policies. slashveto.me
should surface the relevant runtime policy without treating it as a network
rule.

### 2. Selected proposers vote on older epochs

During slashing round `R`, each selected checkpoint proposer can cast at most
one slash vote per slot. The vote targets the committees from an older group of
epochs:

```text
first target epoch = (R - offset) × epochs per slashing round
```

With the mainnet snapshot below, round `R` targets the four epochs belonging to
round `R - 2`. This offset gives nodes time to gather and assess evidence.

For every committee position in every target epoch, a vote contains a two-bit
penalty unit:

| Unit | Meaning at the active deployment |
| --- | --- |
| `0` | no slash |
| `1` | small slash, 2,000 AZTEC |
| `2` | medium slash, 5,000 AZTEC |
| `3` | large slash, 5,000 AZTEC |

The vote does **not** contain an offense type, evidence hash, or human-readable
reason. The standard node adds its locally configured penalties for a
validator within a target epoch and maps the total to one of these units.

There are two vote counts worth distinguishing:

- total round participation is the number of slot ballots cast, up to 128 in
  this deployment; and
- a particular validator action needs 65 of those ballots at or above a
  penalty level.

The contract does not require a separate round-wide quorum to mark a matured
round executed. “Round quorum” is only useful shorthand for enough total
ballots to make any validator action mathematically possible; it does not
guarantee an action.

Tallying is cumulative. A unit-3 vote also supports units 2 and 1. The contract
chooses the highest level whose cumulative support reaches quorum. The same
address may occupy committee positions in several target epochs and can
therefore have more than one action in a round.

### 3. The tally produces candidate actions

As votes arrive, anyone can calculate the current action list and its
deterministic payload address. This is a **candidate**. During the voting
round its actions, amounts, and predicted address can still change.

No payload contract has been deployed at this point. “Payload proposed” is
misleading terminology. The monitor should say:

- candidate action set;
- predicted payload address; and
- current validator support.

After the round closes, the vote tally is stable. A candidate can still be
blocked by the execution delay, a veto, the Slasher's global pause, expiry, or
the absence of a willing future proposer.

### 4. Delay, veto, pause, and expiry

For a voting round `R`:

```text
first executable slot = (R + execution delay + 1) × round size
expiry slot           = (R + lifetime + 1) × round size
```

At the mainnet snapshot, execution starts in round `R + 29` and remains
possible through round `R + 34`. That is a 28-round delay after voting ends
(about 2d 23h 41m), followed by a six-round execution window (about 15h 22m).

The safeguards have different effects:

- **Veto:** the vetoer can permanently veto one exact predicted payload
  address. If the candidate address changes while voting is open, the old veto
  does not automatically cover the replacement.
- **Pause:** the vetoer can disable Slasher execution globally for its fixed
  duration. Voting and tallying continue. “Pause protected” is justified only
  if the pause lasts through the candidate's remaining execution window.
- **Expiry:** after the lifetime ends, that round can no longer execute.
- **Escape-hatch target:** the tally omits an epoch in which the Rollup's
  censorship-resistance escape hatch was open.

The monitor must show scheduled start and expiry separately from the current
pause state.

### 5. Execution and actual stake removal

A later selected proposer normally includes `executeRound` in its L1 action,
although the contract permits anyone to call it. The call verifies the
historical committees and marks the round executed. If the tally contains
actions, it then deploys the deterministic payload and invokes it through the
Slasher in the same atomic transaction. A veto or active pause reverts that
operation.

`RoundExecuted` confirms contract execution and reports the number of action
entries. It does not prove that every requested amount was deducted: an action
can find a validator no longer slashable. The canonical Rollup
`Slashed(attester, amount)` log is the source of truth for actual stake
removed. slashveto.me should correlate those logs to the execution transaction and
never substitute the candidate amount.

## The ten v5 offense types

These are node evidence categories. Whether a node detects them, assigns a
nonzero penalty, or votes for them is node policy; the L1 vote does not disclose
the category.

| Offense | Attributed to | Evidence meaning | Reference mainnet penalty |
| --- | --- | --- | --- |
| Inactivity | Proposer or committee member | The validator missed enough expected duties under the observing node's epoch policy. | 2,000 AZTEC |
| Data withholding | Checkpoint attester | After a checkpoint reached L1, expected transaction data was not available to the observing node within its tolerance. | `0` |
| Broadcast invalid block proposal | Block proposer | The proposer sent an invalid block over P2P, for example one that fails structure, signature, transaction, parent, or re-execution checks. | 2,000 AZTEC |
| Broadcast invalid checkpoint proposal | Checkpoint proposer | The proposer broadcast a malformed or inconsistent final checkpoint proposal. | 2,000 AZTEC |
| Proposed insufficient attestations | L1 checkpoint proposer | The checkpoint published to L1 did not carry the required attestation count. | 2,000 AZTEC |
| Proposed incorrect attestations | L1 checkpoint proposer | The published checkpoint carried invalid signatures or attestations from the wrong committee. | 2,000 AZTEC |
| Proposed descendant of checkpoint with invalid attestations | L1 checkpoint proposer | The proposer published a later checkpoint descending from a checkpoint known to have insufficient or invalid attestations. | `0` |
| Attested invalid checkpoint proposal | Committee member | The validator signed a checkpoint that covers a block the observer found invalid. | `0` |
| Duplicate proposal | Proposer | The proposer signed conflicting block or checkpoint proposals for the same protocol position. | 5,000 AZTEC |
| Duplicate attestation | Committee member | The validator signed conflicting checkpoint archives for the same slot. | 5,000 AZTEC |

The last column is the `mainnet` preset in the researched reference-client
commit. It is neither an L1 rule nor proof of an operator's runtime
configuration. `0` means detection can exist without the standard client voting
a penalty. PINGME should show the attached node's reported penalty and policy
snapshot; static documentation must not infer it from the offense name.

### Inactivity in detail

Inactivity is evaluated over actual duty-bearing observations, not wall-clock
presence:

- for a valid canonical checkpoint, missing committee signatures count against
  the absent attesters;
- for a missed or invalid checkpoint, the proposer is the party attributed as
  inactive;
- `missed / total` is compared with the node's configured target;
- the target must be met for the configured number of consecutive
  committee-participating inactive epochs; and
- non-committee epochs are skipped, while an epoch with no qualifying missed
  ratio does not extend the streak.

This makes “1 of 2 inactive epochs” a valuable warning state. It is earlier and
more actionable than a registered offense, and it must not be labelled as “one
of two offenses.” The relevant ratio and threshold come from the observed node,
not an L1 constant.

The researched reference mainnet preset is a 70% missed-duty target across two
committee-participating epochs. On 2026-07-29, the node attached to the
slashveto.me backend reported an 80% target and the same two-epoch requirement.
That legitimate override is why the UI must display the runtime policy beside
the progression.

## Correlating a reason with an L1 slash

An L1 action can be linked reliably to its validator, target epoch, round,
penalty unit, and amount. Its **reason remains unknown on L1**.

slashveto.me may attach a possible reason only as correlated node evidence when:

1. the sequencer address is identical;
2. the evidence belongs to one of the action's exact target epochs (or its
   precise slot within that epoch);
3. the node observed it before the L1 vote or candidate transition being
   explained; and
4. both source timestamps and source health are retained.

The desired wording is “candidate 2,000 AZTEC slash; this node observed
inactivity in target epoch 123,” not “L1 confirmed an inactivity slash.”
Several local offenses in one epoch can be summed into one vote unit, and
different voters can have different reasons. The UI must retain all matching
evidence rather than inventing a one-to-one mapping.

## Ejection

Slashing first deducts the requested amount, capped by the validator's current
balance. The active Rollup then checks the balance that would remain:

```text
remaining balance < local ejection threshold
```

The comparison is strict. Equality does not eject. At the research snapshot:

| Parameter | Active-mainnet value |
| --- | --- |
| Activation stake | 200,000 AZTEC |
| Rollup local ejection threshold | 190,000 AZTEC |
| GSE global ejection threshold | 100,000 AZTEC |
| Validator exit delay | 4 days |

Starting from exactly 200,000 AZTEC, five 2,000-AZTEC deductions leave 190,000
and do not eject; a sixth would cross below the threshold. Two 5,000-AZTEC
deductions likewise leave 190,000; the third would eject. Mixed penalties and
an already changed balance alter this count, so the monitor should calculate
from current stake instead of displaying a fixed “strikes remaining” number.

On ejection, the validator is removed from the active set immediately. The
deducted amount is not returned, while the remaining stake enters the delayed
exit flow. The position is initially a `ZOMBIE` until its withdrawer selects a
recipient and initiates withdrawal, then `EXITING` until the delay has elapsed.
The delay is measured from ejection rather than restarted by that later
initiation. A pending exit can still be reduced by a valid later slash before
it becomes withdrawable.

The monitor should report these separately:

- requested candidate amount;
- actual `Slashed` amount;
- post-slash stake when known;
- active/ejected/exit status; and
- withdrawal eligibility time.

## Active-mainnet timing snapshot

These values were verified against the canonical stack on 2026-07-29:

| Parameter | Value |
| --- | --- |
| Slot / epoch | 72 seconds / 32 slots |
| Committee size | 48 |
| Slashing round | 128 slots / 4 epochs |
| Slashing vote quorum | 65 |
| Target offset | 2 rounds |
| Execution delay | 28 rounds |
| Lifetime | 34 rounds |
| Executable window | 6 rounds |
| Small / medium / large | 2,000 / 5,000 / 5,000 AZTEC |
| Global pause duration | 3 days |

All are deployment-specific. The active, pending, or legacy stack responsible
for an event determines which values apply.

## Primary references

- [Aztec v5 slashing and offenses](https://docs.aztec.network/operate/operators/sequencer-management/slashing_and_offenses)
- [`SlashingProposer.sol`](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/core/slashing/SlashingProposer.sol)
- [`Slasher.sol`](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/core/slashing/Slasher.sol)
- [`StakingLib.sol`](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/core/libraries/rollup/StakingLib.sol)
- [`GSE.sol`](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/l1-contracts/src/governance/GSE.sol)
- [Sentinel duty accounting](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/aztec-node/src/sentinel/README.md)
- [Offense enum](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/stdlib/src/slashing/types.ts)
- [Vote construction](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/stdlib/src/slashing/votes.ts)
- [Reference network presets](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/spartan/environments/network-defaults.yml)

## Slash appeals

[Open the Slash Veto Council repository](https://github.com/aztec-slash-veto/council).
