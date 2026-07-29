# Aztec protocol model for slashveto.me

This document defines the protocol vocabulary that the monitor and its alerts
must use. It focuses on the parts of Aztec v5 that determine a sequencer's
duties and slashing exposure.

## Roles and time

A staked validator can be selected for two distinct roles:

- the **proposer** builds blocks for a slot and submits their checkpoint to L1;
- a **committee member** validates the proposed blocks and signs one
  checkpoint attestation for the slot.

The same validator can perform either role in different slots. Selection uses
Ethereum RANDAO-derived randomness and the active validator set.

| Unit | Meaning | Active-mainnet example on 2026-07-29 |
| --- | --- | --- |
| Slot | Fixed protocol interval with one selected proposer | 72 seconds |
| Block | One L2 state transition; a slot may contain several blocks | Variable count |
| Checkpoint | All blocks built in one slot, committed together to L1 | At most one per slot |
| Epoch | Committee and proving interval | 32 slots, 38m 24s |
| Slashing round | Window in which selected proposers cast slash votes | 128 slots / 4 epochs, 2h 33m 36s |

These values describe the active deployment at the research date, not permanent
network constants. slashveto.me must display values read from the canonical
contracts.

## The sequencing path

Aztec pipelines work for a future slot so the L1 checkpoint transaction can
land near that slot's beginning:

1. The selected proposer obtains transactions, builds one or more L2 blocks,
   and broadcasts them over P2P.
2. Committee members validate and re-execute the blocks. They do **not** attest
   individual blocks.
3. The proposer assembles the slot checkpoint. Its header commits to the
   blocks, resulting archive root, data, fees, and other slot state.
4. Committee members validate the complete checkpoint and sign its checkpoint
   attestation. Each validator may sign only one checkpoint for a slot.
5. The proposer publishes the checkpoint, blob data, and collected attestations
   to the Rollup contract on Ethereum.

The normal checkpoint needs the protocol's attestation threshold, described by
Aztec as two thirds of the committee plus one. A checkpoint that is malformed,
contains invalid attestations, or descends from certain invalid checkpoint
state can itself create slashable evidence.

### Four different chain tips

“Proposed” and “final” are not interchangeable:

| Tip | What it establishes |
| --- | --- |
| Proposed | A block was broadcast on the L2 P2P network. It can still be replaced. |
| Checkpointed | Its enclosing checkpoint was published to the Rollup contract on L1. It is still on the pending, unproven chain. |
| Proven | An accepted proof covers the checkpoint on L1. |
| Finalized | The L1 transaction that established the proof has reached Ethereum finality. |

For slashveto.me, a local P2P or node observation is therefore an early signal, not
canonical L1 truth. Conversely, L1 can prove that a checkpoint, vote, or slash
transaction occurred without revealing everything a node saw on P2P.

## Proving

Provers start work as checkpoints appear on L1 and eventually submit a root
proof for a complete epoch. Epoch proofs must extend the previously proven tip
in order. If an epoch misses its proof deadline, the pending unproven chain can
be pruned and its transactions proposed again.

At the research snapshot, `proofSubmissionEpochs` is `1`: epoch `E` expires at
the start of epoch `E + 2`. The UI should read this value and distinguish
checkpointed, proven, and finalized health rather than treating an L1
checkpoint proposal as final.

Failure to prove is a network-health concern, but it is not itself an offense
name carried in a slash vote. Data-withholding detection and other node
watchers can observe facts related to the affected checkpoint independently.

## Three overloaded actions that must remain separate

A sequencer's L1 transaction can bundle several protocol actions, but they have
different state machines:

1. **Checkpoint proposal:** publishes the slot's L2 checkpoint to the Rollup.
2. **Governance signal:** supports a governance payload in the separate
   governance-proposer round. A winning signal later becomes a formal
   governance proposal; it is not a slash vote.
3. **Slashing vote or execution:** votes penalty units for validators in older
   target epochs, or executes a matured slashing round.

The designated proposer is able to perform these actions because it owns the
slot. A UI label such as “proposal” or “payload” without its checkpoint,
governance, or slashing qualifier is ambiguous.

### Governance signaling, briefly

Governance signaling is a nomination phase, not token voting and not slashing.
The selected checkpoint proposer can signal one governance payload for its
slot. Signals accumulate within a governance-proposer round; after the round, a
quorum-backed winner can be submitted during that mechanism's own delay and
lifetime and becomes a formal Governance proposal. Token holders then follow
the separate Governance lifecycle.

At the research snapshot the mainnet governance-proposer round is 1,000 slots
with quorum 600. As with slashing parameters, those values belong to the
responsible deployed contract. slashveto.me does not need to turn general
governance into a slashing case; it does need to decode a bundled sequencer
transaction without mistaking its governance signal for a slash vote.

## Exceptional slots and epochs

Aztec's rollup censorship-resistance escape hatch has designated windows that
bypass normal committee sequencing. The reference node does not create normal
Sentinel inactivity entries for those duties, and the SlashingProposer omits
slash actions for target epochs whose escape hatch was open. slashveto.me must not
present those epochs as ordinary missed committee duty.

Contract upgrades also create active, pending, and legacy slashing stacks. A
historical event remains tied to the Rollup, Slasher, and SlashingProposer that
authorized it; current canonical addresses must not be retroactively attached
to old rounds.

## What this means for monitoring

The desired per-sequencer view combines facts from different observation
planes without flattening their certainty:

```text
local duty/P2P observation
        ↓
node offense policy and local evidence
        ↓
L1 slashing vote and tally
        ↓
L1 execution and actual stake outcome
```

- Node and Sentinel data can explain an early warning and supply a possible
  reason.
- L1 is authoritative for contract identity, votes, timing, vetoes, execution,
  and emitted stake deductions.
- No single source proves the entire path. The monitor links evidence under
  explicit rules and keeps its provenance visible.

The complete slashing state machine and those linking rules are documented in
[Slashing and ejection](slashing.md) and
[Monitor architecture](architecture.md).

## Primary references

- [Aztec blocks and checkpoints](https://docs.aztec.network/participate/basics/blocks)
- [Aztec v5 slashing and offenses](https://docs.aztec.network/operate/operators/sequencer-management/slashing_and_offenses)
- [Governance proposal creation and signaling](https://docs.aztec.network/participate/governance/creating-and-voting-on-proposals)
- [`sequencer-client` architecture](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/sequencer-client/README.md)
- [`validator-client` architecture](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/validator-client/README.md)
- [`prover-node` architecture](https://github.com/AztecProtocol/aztec-packages/blob/def7152aa13dc0f880f24e45ce39442908170878/yarn-project/prover-node/README.md)
