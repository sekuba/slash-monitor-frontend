# Slashing Mechanism & Duration Breakdown

## Overview

Aztec's slashing mechanism uses a multi-stage process with several time-based safeguards to ensure fair, reviewable sequencer penalties.

---

## Slashing Round Lifecycle

```
┌─────────────────┐
│  Round R Voting │  Committee votes on offenses from R - SLASH_OFFSET_IN_ROUNDS
└────────┬────────┘
         │
         ├─ Round ends at slot: (R + 1) × ROUND_SIZE - 1
         │
         v
┌─────────────────┐
│ Waiting Period  │  Duration: EXECUTION_DELAY_IN_ROUNDS rounds
└────────┬────────┘  (Cannot execute yet - gives time for veto)
         │
         ├─ Executable slot: (R + 1 + EXECUTION_DELAY_IN_ROUNDS) × ROUND_SIZE
         │
         v
┌─────────────────┐
│ Newly Executable│  Status: 'newly-executable' (first executable round)
└────────┬────────┘  Permissionless only while Slasher is enabled and not vetoed
         │
         v
┌─────────────────┐
│ Executable      │  Duration: (LIFETIME - EXECUTION_DELAY) rounds
│ Window          │  Callable only while Slasher is enabled and not vetoed
└────────┬────────┘
         │
         ├─ Expiry slot: (R + 1 + LIFETIME_IN_ROUNDS) × ROUND_SIZE
         │
         v
┌─────────────────┐
│    Expired      │  Status: 'expired' (can no longer execute)
└─────────────────┘
```

---

## Smart Contract State Variables

### SlashingProposer
- `EXECUTION_DELAY_IN_ROUNDS` - Rounds to wait (constant)
- `LIFETIME_IN_ROUNDS` - Total lifetime (constant)
- `SLASH_OFFSET_IN_ROUNDS` - Voting offset (constant)
- `ROUND_SIZE` - Slots per round (constant)
- `ROUND_SIZE_IN_EPOCHS` - Epochs per round (constant)
- `QUORUM` - Matching ballots needed per validator (constant)

### Slasher
- `SLASHING_DISABLE_DURATION` - Halt duration in seconds (constant)
- `slashingDisabledUntil` - Unix timestamp when halt ends (state variable)
- `vetoedPayloads(address)` - Mapping of vetoed payloads (state mapping)

### Rollup
- `slotDuration` - Seconds per slot (constant)
- `epochDuration` - Slots per epoch (constant)

---

## Veto Mechanics

### Individual Round Veto
- **Function**: `Slasher.vetoPayload(payloadAddress)`
- **Effect**: Permanently blocks that exact payload address and action set
- **Changing tally**: A changed action set produces a new payload address that must be reviewed separately
- **Timing**: Can be called any time after the payload is known and before that payload executes
- **Window**: Veto as early as possible; after the executable slot, execution is permissionless only while the Slasher's global gate is enabled

### Emergency Halt
- **Function**: `Slasher.setSlashingEnabled(false)`
- **Effect**: Pauses ALL slashing execution for SLASHING_DISABLE_DURATION
- **Does NOT**: Block voting (voting continues normally)
- **Does NOT**: Veto individual rounds (a still-live round can execute after the halt ends)
- **Expiry interaction**: A round whose expiry arrives during the scheduled halt is protected under that schedule; a later-expiring round is delayed, not safe

The vetoer can lift a halt early. Slashmon therefore reports the timing window,
the current global gate, and scheduled protection separately. See
[`docs/architecture.md`](docs/architecture.md) for the exact monitoring model.
