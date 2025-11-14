# Slashing Mechanism & Duration Breakdown

## Overview

Aztec's slashing mechanism uses a multi-stage process with several time-based safeguards to ensure fair, reviewable validator penalties.

---

## Core Smart Contract Durations

### 1. **EXECUTION_DELAY_IN_ROUNDS** (TallySlashingProposer)
- **What it is**: Mandatory waiting period before a quorum-reached round can be executed
- **When it starts**: From the END of the voting round
- **Purpose**: Gives the community time to review and veto unjust slashing decisions
- **Formula**: Round R becomes executable at slot `(R + 1 + EXECUTION_DELAY_IN_ROUNDS) × ROUND_SIZE`

### 2. **LIFETIME_IN_ROUNDS** (TallySlashingProposer)
- **What it is**: Total lifespan of a slashing round from completion to expiration
- **When it starts**: From the END of the voting round
- **Purpose**: Limits how long a slashing decision can be executed
- **Formula**: Round R expires at slot `(R + 1 + LIFETIME_IN_ROUNDS) × ROUND_SIZE`

### 3. **SLASHING_DISABLE_DURATION** (Slasher)
- **What it is**: Duration of an emergency slashing halt (in seconds, not rounds!)
- **When it starts**: When `Slasher.setSlashingEnabled(false)` is called
- **Purpose**: Temporarily blocks ALL slashing execution to address systemic issues
- **Formula**: Slashing re-enables at timestamp `slashingDisabledUntil = now + SLASHING_DISABLE_DURATION`

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

## Emergency Slashing Halt: The "Shift Effect"

### Why Individual Round Timers ≠ Halt Duration

**The Confusion**: A round might show "EXECUTABLE IN 2d 22h" while the emergency halt shows "3d 1h remaining" and is listed in "Group 3 Post-Pause Executable Rounds."

**The Explanation**:

1. **"EXECUTABLE IN X"** = Time until the round's EXECUTION_DELAY_IN_ROUNDS expires
   - This countdown is INDEPENDENT of whether slashing is enabled
   - Shows when the round becomes **technically** executable
   - Does NOT mean it can actually be executed if slashing is paused

2. **Emergency Halt Duration** = SLASHING_DISABLE_DURATION (measured in seconds, not rounds)
   - Blocks ALL execution regardless of round status
   - Measured from when halt was activated

3. **The Shift Effect**: Due to EXECUTION_DELAY_IN_ROUNDS, the halt creates THREE groups:

---

## The Three Groups During Emergency Halt

### 🔵 Group 1: Pre-Pause Rounds (PROTECTED)
- **Voting Period**: BEFORE pause started
- **Execution Delay Finishes**: DURING pause
- **Result**: ✅ PROTECTED from slashing
- **Why**: Their execution delay finishes while slashing is disabled

**Formula**:
```
roundWhenPauseStarted = slotWhenPauseStarted / ROUND_SIZE
firstGroup1Round = roundWhenPauseStarted - EXECUTION_DELAY_IN_ROUNDS
lastGroup1Round = roundWhenPauseStarted - 1
```

### 🔵 Group 2: Full-Pause Rounds (PROTECTED)
- **Voting Period**: DURING pause
- **Execution Delay Finishes**: DURING pause (while still paused)
- **Result**: ✅ PROTECTED from slashing
- **Why**: Their execution delay finishes before slashing re-enables

**Formula**:
```
roundWhenReEnabled = slotWhenReEnabled / ROUND_SIZE
firstGroup2Round = roundWhenPauseStarted
lastGroup2Round = roundWhenReEnabled - EXECUTION_DELAY_IN_ROUNDS - 2
```

### 🔴 Group 3: Post-Pause Executable Rounds (SLASHABLE!)
- **Voting Period**: LATE in the pause
- **Execution Delay Finishes**: AFTER pause ends
- **Result**: ⚠️ CAN BE SLASHED
- **Why**: When pause ends, these rounds are already executable

**Formula**:
```
firstGroup3Round = lastGroup2Round + 1
lastGroup3Round = roundWhenReEnabled - 1
```

---

## Example: Round 81 Timeline

Assuming current state:
- Round 81: "EXECUTABLE IN 2d 22h 41m 24s"
- Emergency Halt: "Time Remaining 3d 1h"
- Group 3: "Rounds 81 → 109"

**What's Happening**:

1. **Now** (T=0):
   - Round 81's execution delay finishes in 2d 22h
   - Emergency halt ends in 3d 1h
   - Slashing is currently DISABLED

2. **T = 2d 22h** (Round 81 becomes executable):
   - Round 81 status changes to 'executable'
   - BUT slashing is still disabled (halt has 2h 19m remaining)
   - Cannot actually execute yet

3. **T = 3d 1h** (Emergency halt ends):
   - Slashing re-enables
   - Round 81 is ALREADY executable (became so 2h 19m ago)
   - ⚠️ Round 81 CAN NOW BE SLASHED immediately

4. **Alternative: Without Expiration**:
   - Round 81 remains executable until expiry slot
   - Expiry = `(81 + 1 + LIFETIME_IN_ROUNDS) × ROUND_SIZE`
   - Total execution window = `(LIFETIME - EXECUTION_DELAY) rounds`

---

## Key Insight: Execution Window vs. Pause Duration

**Why "Group 3" rounds can be slashed despite the pause**:

The execution delay (EXECUTION_DELAY_IN_ROUNDS) creates a **time lag** between:
1. When a round is voted on
2. When it can be executed

This lag means:
- Rounds voted LATE in the pause have their execution delay finish AFTER the pause
- By the time slashing re-enables, these rounds are in their executable window
- They can be executed immediately unless individually vetoed

**The expiration duration (LIFETIME_IN_ROUNDS) extends this further**:
- Once executable, a round remains executable for many rounds
- This gives executors a large window to act
- Emergency halt duration might be shorter than this window
- Therefore, rounds that "become executable" during the halt can still be slashed after it ends

---

## Duration Hierarchy

```
LIFETIME_IN_ROUNDS
│
├─ EXECUTION_DELAY_IN_ROUNDS ──┐
│                               │ (Waiting period before execution)
│                               │
│  ┌────────────────────────────┘
│  │
│  └─ Execution Window = LIFETIME - EXECUTION_DELAY rounds
│     (Period when slashing can be executed)
│
└─ Total round lifespan from end to expiration

SLASHING_DISABLE_DURATION (in seconds, independent of rounds)
│
└─ Emergency halt duration
   (Blocks all execution regardless of round status)
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

---

## Monitor Display Logic

### Individual Round Countdowns

**"EXECUTABLE IN X"** (RoundCard.tsx):
```typescript
executableSlot = (round + 1 + EXECUTION_DELAY_IN_ROUNDS) × ROUND_SIZE
secondsUntilExecutable = (executableSlot - currentSlot) × slotDuration
```
- Shows when execution delay expires
- **Independent** of slashing enabled/disabled status
- Real-time countdown with adjustment for elapsed time

**"EXPIRES IN X"** (RoundCard.tsx):
```typescript
expirySlot = (round + 1 + LIFETIME_IN_ROUNDS) × ROUND_SIZE
secondsUntilExpires = (expirySlot - currentSlot) × slotDuration
```
- Shows when round can no longer be executed
- Marks end of execution window

### Emergency Halt Display

**"Time Remaining"** (SlashingTimeline.tsx):
```typescript
now = Math.floor(Date.now() / 1000)
secondsUntilReEnabled = slashingDisabledUntil - now
```
- Shows when emergency halt ends
- Based on SLASHING_DISABLE_DURATION
- **Independent** of individual round timing

---

## Summary

1. **EXECUTION_DELAY_IN_ROUNDS**: Waiting period before slashing can execute (protection window)
2. **LIFETIME_IN_ROUNDS**: Total time a round exists before expiring (defines execution window)
3. **SLASHING_DISABLE_DURATION**: Emergency halt duration in seconds (blocks all execution)

The **apparent contradiction** between individual round timers and halt duration exists because:
- Individual rounds track when they're **technically** executable (based on EXECUTION_DELAY)
- Emergency halt tracks when execution is **actually** allowed (based on SLASHING_DISABLE_DURATION)
- The "Shift Effect" means rounds can become executable DURING the halt but only be slashed AFTER it ends
- The long LIFETIME_IN_ROUNDS gives a wide execution window that often extends beyond the halt

This creates the "Group 3" phenomenon where rounds show as "executable soon" but are listed as "Post-Pause Executable" because their execution delay finishes while slashing is still paused, making them slashable the moment the halt ends.
