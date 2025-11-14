# Slashing Mechanism & Duration Breakdown

## Overview

Aztec's slashing mechanism uses a multi-stage process with several time-based safeguards to ensure fair, reviewable validator penalties.

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
│ Veto Window     │  Status: 'in-veto-window' (first executable round)
└────────┬────────┘  ⚠️  CRITICAL: Last chance to veto
         │
         v
┌─────────────────┐
│ Executable      │  Duration: (LIFETIME - EXECUTION_DELAY) rounds
│ Window          │  Can execute at any time during this period
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

### TallySlashingProposer
- `EXECUTION_DELAY_IN_ROUNDS` - Rounds to wait (constant)
- `LIFETIME_IN_ROUNDS` - Total lifetime (constant)
- `SLASH_OFFSET_IN_ROUNDS` - Voting offset (constant)
- `ROUND_SIZE` - Slots per round (constant)
- `ROUND_SIZE_IN_EPOCHS` - Epochs per round (constant)
- `QUORUM` - Votes needed (constant)

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
- **Effect**: Permanently blocks a specific round's execution
- **Timing**: Can be called any time before execution
- **Window**: Most critical during 'in-veto-window' status (first executable round)

### Emergency Halt
- **Function**: `Slasher.setSlashingEnabled(false)`
- **Effect**: Pauses ALL slashing execution for SLASHING_DISABLE_DURATION
- **Does NOT**: Block voting (voting continues normally)
- **Does NOT**: Veto individual rounds (they can still be executed after halt ends)