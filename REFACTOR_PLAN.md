# Aztec Slashing Monitor - Codebase Refactoring Plan

## Overview
This document provides a comprehensive, session-independent refactoring plan for the Aztec Slashing Monitor codebase. Each task is designed to be completed independently while maintaining full functionality.

**Project Type:** React + TypeScript blockchain monitoring application
**Stack:** React 18, Viem 2.7, Zustand 4.4, Tailwind CSS 3.4, Vite 5.0
**Main Purpose:** Real-time monitoring of Aztec blockchain slashing proposals with veto support

---

## Refactoring Priorities

1. **Lean Code**: Remove unnecessary comments, avoid excessive file splitting
2. **Readability**: Improve maintainability and code clarity
3. **Modern Dependencies**: Keep dependencies minimal and up-to-date (already good)
4. **Consistency**: Fix inconsistencies without changing core functionality
5. **Documentation**: Clear tracking for multi-session work

---

## Phase 1: Remove Duplicate Code (High Priority)

### Task 1.1: Remove Duplicate Batch Method in L1Monitor
**File:** `src/lib/l1Monitor.ts`
**Lines:** 281-323

**Issue:** Two nearly identical methods exist:
- `batchGetPayloadAddressesAndVetoStatus()` (lines 281-323) - **UNUSED**
- `batchGetPayloadAddressesAndVetoStatusOptimized()` (lines 324-366) - **USED**

**Action:**
1. Verify that only the "Optimized" version is called (search codebase)
2. Delete `batchGetPayloadAddressesAndVetoStatus()` entirely (lines 281-323)
3. Rename `batchGetPayloadAddressesAndVetoStatusOptimized()` to `batchGetPayloadAddressesAndVetoStatus()`
4. Update any imports if needed
5. Test that slashing detection still works

**Verification:**
```bash
npm run build
npm run lint
# Manual test: Check that rounds are detected and payload addresses load
```

---

### Task 1.2: Consolidate Status Calculation Logic
**Files:** `src/lib/slashingDetector.ts`

**Issue:** Status calculation logic appears in multiple places:
- `calculateRoundStatus()` method (lines 40-72)
- Inline within `detectExecutableRounds()` (line 211)

Both use identical logic to determine round status.

**Action:**
1. Keep `calculateRoundStatus()` as the single source of truth
2. In `detectExecutableRounds()` line 211, ensure it calls `calculateRoundStatus()` instead of duplicating logic
3. Review all status calculations to use the centralized method

**Verification:**
```bash
npm run build
# Check that status badges show correctly in UI
```

---

### Task 1.3: Reduce Round Enrichment Duplication in SlashingDetector
**File:** `src/lib/slashingDetector.ts`

**Issue:** Lines 228-249 and 292-316 contain very similar logic for enriching rounds with details.

**Action:**
1. Extract a private method: `enrichRoundWithDetails(round, roundInfo, status, cachedDetails, currentSlot)`
2. This method should:
   - Calculate executable/expiry slots
   - Calculate seconds until executable/expires
   - Calculate total slash amount
   - Get target epochs
   - Return enriched DetectedSlashing object
3. Replace duplicated blocks with calls to this method
4. Ensure executed rounds scanning (lines 355-372, 418-435) also uses this

**Verification:**
```bash
npm run build
# Test that round details load correctly for active and executed rounds
```

---

## Phase 2: Reorganize Utility Functions (Medium Priority)

### Task 2.1: Split utils.ts into Focused Modules
**File:** `src/lib/utils.ts` (152 lines)

**Issue:** Single file mixes concerns - formatting, status, offense handling.

**Action:**
1. Create `src/lib/formatters.ts` with:
   - `formatAddress()` (lines 4-6)
   - `formatEther()` (lines 7-10)
   - `formatTimeRemaining()` (lines 11-31)
   - `formatNumber()` (lines 32-34)

2. Create `src/lib/statusUtils.ts` with:
   - `isActionableStatus()` (lines 35-39)
   - `getStatusColor()` (lines 40-57)
   - `getStatusText()` (lines 58-75)

3. Create `src/lib/offenseUtils.ts` with:
   - `getOffenseTypeName()` (lines 76-96)
   - `getOffenseTypeColor()` (lines 97-117)
   - `findOffenseForValidator()` (lines 118-151)

4. Update all imports across the codebase:
   - `src/components/RoundCard.tsx`
   - `src/components/Dashboard.tsx`
   - `src/components/StatsPanel.tsx`
   - Any other files importing from utils

5. Delete `src/lib/utils.ts`

**Verification:**
```bash
npm run build
npm run lint
# Check all components render correctly
```

---

### Task 2.2: Consolidate Time Formatting Functions
**Files:** `src/lib/formatters.ts` (after Task 2.1), `src/components/SlashingTimeline.tsx`

**Issue:** `formatTimeRemaining()` exists in utils, but SlashingTimeline has inline `formatSlotToTime()` (lines 65-82).

**Action:**
1. Review both functions' behavior
2. If `formatSlotToTime()` is similar enough, update it to use `formatTimeRemaining()`
3. If they serve different purposes, rename for clarity:
   - `formatTimeRemaining()` → `formatSecondsRemaining()`
   - `formatSlotToTime()` → `formatSlotDurationFromNow()`
4. Document the difference if both are kept

**Verification:**
```bash
npm run build
# Test timeline shows correct time estimates
```

---

## Phase 3: Simplify Large Components (Medium Priority)

### Task 3.1: Extract StatusBadge Component from RoundCard
**File:** `src/components/RoundCard.tsx` (199 lines)

**Issue:** Status badge rendering logic is inline (lines 60-62) and repeated styling.

**Action:**
1. Create `src/components/StatusBadge.tsx`:
```typescript
interface StatusBadgeProps {
  status: RoundStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <div className={`px-4 py-2 border-3 text-sm font-black uppercase tracking-wider ${getStatusColor(status)}`}>
      {getStatusText(status)}
    </div>
  );
}
```
2. Replace inline badge in RoundCard with `<StatusBadge status={slashing.status} />`
3. Consider using in Dashboard and other components if they show status

**Verification:**
```bash
npm run build
# Check status badges render correctly
```

---

### Task 3.2: Extract AlertBanner Component from RoundCard
**File:** `src/components/RoundCard.tsx`

**Issue:** Lines 88-129 contain complex alert banner logic (3 types: countdown, expiry, veto status).

**Action:**
1. Create `src/components/AlertBanner.tsx`:
```typescript
interface AlertBannerProps {
  type: 'countdown' | 'expiry' | 'vetoed' | 'veto-available';
  timeRemaining?: number;
  // ... other props
}
```
2. Extract the 3 banner types (countdown, expiry, veto) into this component
3. Replace lines 88-129 in RoundCard with clean component calls

**Verification:**
```bash
npm run build
# Test that alert banners show correctly for different round states
```

---

### Task 3.3: Break Down SlashingTimeline Component
**File:** `src/components/SlashingTimeline.tsx` (406 lines)

**Issue:** Component is very long, contains massive inline emergency halt calculation (lines 192-403).

**Action:**
1. Extract emergency halt UI into `src/components/EmergencyHaltBanner.tsx`
2. Move the complex calculation logic (lines 192-260) into a custom hook:
   - Create `src/hooks/useEmergencyHaltInfo.ts`
   - Returns: `{ isInHalt, haltEndTime, affectedRounds, ... }`
3. In SlashingTimeline, call the hook and pass data to EmergencyHaltBanner
4. Extract `formatSlotToTime()` to a utility or keep as local function with clear purpose

**Verification:**
```bash
npm run build
# Test emergency halt banner shows when slashing is disabled
```

---

## Phase 4: Configuration & Constants (Low Priority)

### Task 4.1: Group Configuration Parameters
**File:** `src/types/slashing.ts` (SlashingMonitorConfig interface)

**Issue:** 26 config parameters in flat structure - hard to understand relationships.

**Action:**
1. Refactor config into logical groups:
```typescript
export interface SlashingMonitorConfig {
  // Contract Addresses
  contracts: {
    l1RpcUrl: string | string[];
    tallySlashingProposerAddress: Address;
    slasherAddress: Address;
    rollupAddress: Address;
  };

  // Node Connection (optional)
  nodeAdminUrl: string;

  // Protocol Parameters (loaded from contracts)
  protocol: {
    slashingRoundSize: number;
    slashingRoundSizeInEpochs: number;
    executionDelayInRounds: number;
    lifetimeInRounds: number;
    slashOffsetInRounds: number;
    quorum: number;
    committeeSize: number;
    slotDuration: number;
    epochDuration: number;
  };

  // Polling & Performance
  polling: {
    l2PollInterval: number;
    realtimeCountdownInterval: number;
  };

  // Caching
  caching: {
    l1RoundCacheTTL: number;
    detailsCacheTTL: number;
    maxMutableRoundCacheSize: number;
    maxMutableDetailsCacheSize: number;
  };

  // UI Behavior
  ui: {
    maxExecutedRoundsToShow: number;
    maxRoundsToScanForHistory: number;
    copyFeedbackDuration: number;
    hoursThresholdForDayDisplay: number;
  };

  // Debug
  debug: {
    consoleLogProbability: number;
  };
}
```

2. Update all usages across the codebase:
   - `src/lib/l1Monitor.ts`
   - `src/lib/slashingDetector.ts`
   - `src/hooks/useSlashingMonitor.ts`
   - `src/App.tsx` (config initialization)
   - All components using config

**Note:** This is a larger change - consider doing it last or skipping if time-constrained.

**Verification:**
```bash
npm run build
npm run lint
# Full manual test of all features
```

---

### Task 4.2: Move Magic Numbers to Config
**Files:** `src/lib/l1Monitor.ts`, `src/lib/slashingDetector.ts`

**Issue:** Hardcoded cache sizes:
- L1Monitor line 16: `maxMutableSize: 100`
- SlashingDetector line 22: `maxMutableSize: 50`

**Action:**
1. If Task 4.1 was completed, add to `caching` config group
2. Otherwise, add to root config: `maxMutableRoundCacheSize: 100`, `maxMutableDetailsCacheSize: 50`
3. Replace hardcoded values with config references
4. Update config initialization in `src/App.tsx` with these defaults

**Verification:**
```bash
npm run build
# Test caching still works
```

---

## Phase 5: Type Safety Improvements (Low Priority)

### Task 5.1: Remove `any` Types in Multicall
**File:** `src/lib/l1Monitor.ts`

**Issue:** Lines 189, 204 use `as any[]` for action mapping.

**Action:**
1. Create proper type in `src/types/slashing.ts`:
```typescript
export interface ContractSlashAction {
  validator: Address;
  slashAmount: bigint;
}
```
2. Replace `as any[]` with proper typing:
```typescript
return (actions as ContractSlashAction[]).map((action) => ({
  validator: action.validator,
  slashAmount: action.slashAmount,
}));
```
3. Apply same fix to line 204

**Verification:**
```bash
npm run build
npm run lint
```

---

### Task 5.2: Type Multicall Results Properly
**File:** `src/lib/multicall.ts`

**Issue:** Line 88 may have type safety gaps.

**Action:**
1. Review multicall.ts implementation
2. Ensure return types are properly typed based on ABI
3. Add proper type guards where needed
4. Document any unavoidable `any` types with comments explaining why

**Verification:**
```bash
npm run build
npm run lint
```

---

## Phase 6: Error Handling & Logging (Low Priority)

### Task 6.1: Establish Consistent Error Handling Pattern
**Files:** `src/lib/l1Monitor.ts`, `src/lib/slashingDetector.ts`, `src/hooks/useSlashingMonitor.ts`

**Issue:** Inconsistent error handling - some use try-catch with console.error, others let errors propagate.

**Action:**
1. Decide on pattern:
   - **Recommended:** Create `src/lib/errorHandler.ts` with:
     - `handleError(error: unknown, context: string): void` - logs and optionally notifies
     - `isCriticalError(error: unknown): boolean` - determines if app should fail
2. Apply pattern consistently:
   - Network errors: log but continue (non-critical)
   - Contract read errors: log and retry logic
   - Initialization errors: critical, should fail initialization
3. Wrap critical sections with proper error boundaries

**Verification:**
```bash
npm run build
# Test with network disconnected - should handle gracefully
```

---

### Task 6.2: Create Logging Abstraction
**Files:** All files using `console.log` / `console.error`

**Issue:** Console logging scattered throughout, probabilistic logging in hook.

**Action:**
1. Create `src/lib/logger.ts`:
```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private probability: number;

  constructor(probability: number = 1.0) {
    this.probability = probability;
  }

  debug(message: string, data?: any): void {
    if (Math.random() < this.probability) {
      console.log(`[DEBUG] ${message}`, data);
    }
  }

  info(message: string, data?: any): void {
    console.log(`[INFO] ${message}`, data);
  }

  warn(message: string, data?: any): void {
    console.warn(`[WARN] ${message}`, data);
  }

  error(message: string, error?: any): void {
    console.error(`[ERROR] ${message}`, error);
  }
}

export const logger = new Logger();
export const setLogProbability = (prob: number) => {
  logger['probability'] = prob;
};
```

2. Replace all `console.log` with `logger.debug()` or `logger.info()`
3. Replace all `console.error` with `logger.error()`
4. In useSlashingMonitor, call `setLogProbability(config.consoleLogProbability)` on init
5. Remove probabilistic logging logic from useSlashingMonitor (line 107)

**Verification:**
```bash
npm run build
# Check logs appear correctly
```

---

## Phase 7: Dead Code & Cleanup (Low Priority)

### Task 7.1: Handle VetoInstructions Component
**File:** `src/components/VetoInstructions.tsx`

**Issue:** Component exists but is never imported or used.

**Action:**
1. Search codebase for imports of `VetoInstructions`
2. If truly unused, **delete the file**
3. If it was meant to be used, investigate where it should be integrated
4. Based on component code, it seems like it might have been replaced by inline veto UI in RoundCard

**Verification:**
```bash
npm run build
npm run lint
# Search: rg "VetoInstructions" --type ts --type tsx
```

---

### Task 7.2: Remove Unnecessary Comments
**Files:** All TypeScript/TSX files

**Issue:** Code should be self-documenting; remove redundant comments.

**Action:**
1. Review all files for comments
2. Remove comments that just restate the code:
   - ❌ `// Set initialized to true`
   - ✅ Keep comments explaining complex logic or non-obvious behavior
3. Keep JSDoc comments for public API functions
4. Remove commented-out code blocks

**Verification:**
```bash
npm run lint
```

---

## Phase 8: Style & UI Improvements (Low Priority)

### Task 8.1: Extract Common Tailwind Patterns
**Files:** All component files

**Issue:** Repeated Tailwind class combinations like:
- Border + shadow patterns: `border-5 border-aqua shadow-brutal-aqua`
- Status card patterns: `bg-brand-black border-3 border-whisper-white px-4 py-3`

**Action:**
1. Create `src/styles/components.css` (or extend `index.css`):
```css
/* Card Variants */
.card-brutal {
  @apply border-5 border-brand-black shadow-brutal;
}

.card-brutal-aqua {
  @apply border-5 border-aqua shadow-brutal-aqua;
}

.card-brutal-vermillion {
  @apply border-5 border-vermillion shadow-brutal-vermillion;
}

/* Status Cards */
.stat-card {
  @apply bg-brand-black border-3 border-whisper-white px-4 py-3;
}

/* Interactive Elements */
.brutal-button {
  @apply border-3 border-brand-black hover:translate-x-1 hover:-translate-y-1 transition-transform shadow-brutal;
}
```

2. Replace repeated patterns in components with utility classes
3. Keep component-specific styles inline

**Note:** This is optional - Tailwind inline classes are acceptable. Only do if it significantly improves readability.

**Verification:**
```bash
npm run build
# Visual test - ensure all components look identical
```

---

## Phase 9: Dependencies Audit (Final Step)

### Task 9.1: Check for Unused Dependencies
**File:** `package.json`

**Action:**
1. Install `depcheck`:
```bash
npx depcheck
```

2. Review report for unused dependencies
3. Remove any truly unused packages
4. Document any false positives

**Current dependencies are very lean:**
- ✅ `react`, `react-dom` - core
- ✅ `viem` - blockchain interaction
- ✅ `zustand` - state management
- ✅ `date-fns` - check if used (search codebase)
- All dev dependencies appear necessary

**Verification:**
```bash
npm run build
npm run lint
```

---

### Task 9.2: Update Dependencies to Latest Stable
**File:** `package.json`

**Action:**
1. Check for updates:
```bash
npm outdated
```

2. Update to latest stable versions:
   - React: Check if 18.3.x is available
   - Viem: Check for 2.x updates
   - TypeScript: Check for 5.x updates
   - Build tools: Vite, etc.

3. Test thoroughly after updates

**Verification:**
```bash
npm run build
npm run lint
npm run dev
# Full manual test
```

---

## Testing Strategy for Each Phase

After completing each task:

1. **Build Check:**
   ```bash
   npm run build
   ```

2. **Linting Check:**
   ```bash
   npm run lint
   ```

3. **Dev Server:**
   ```bash
   npm run dev
   ```

4. **Manual Testing Checklist:**
   - [ ] App loads without errors
   - [ ] Current round displays correctly
   - [ ] Slashing rounds are detected and shown
   - [ ] Round cards expand/collapse
   - [ ] Payload addresses are copyable
   - [ ] Status badges show correct colors
   - [ ] Timeline shows current phase
   - [ ] Stats panel shows correct numbers
   - [ ] Browser notifications work (if applicable)
   - [ ] Emergency halt banner shows when slashing disabled

---

## Priority Order for Multi-Session Work

### Session 1 (High Impact, Low Risk):
- ✅ Task 1.1: Remove duplicate batch method
- ✅ Task 1.2: Consolidate status calculation
- ✅ Task 7.1: Handle VetoInstructions component

### Session 2 (Structural Improvements):
- ✅ Task 2.1: Split utils.ts into focused modules
- ✅ Task 1.3: Reduce round enrichment duplication
- ✅ Task 7.2: Remove unnecessary comments

### Session 3 (Component Simplification):
- ✅ Task 3.1: Extract StatusBadge component
- ✅ Task 3.2: Extract AlertBanner component
- ✅ Task 2.2: Consolidate time formatting

### Session 4 (Large Refactors):
- ✅ Task 3.3: Break down SlashingTimeline component
- ✅ Task 6.2: Create logging abstraction

### Session 5 (Polish & Type Safety):
- ✅ Task 5.1: Remove `any` types in multicall
- ✅ Task 5.2: Type multicall results properly
- ✅ Task 4.2: Move magic numbers to config
- ✅ Task 6.1: Establish error handling pattern

### Session 6 (Optional - Config Restructure):
- ✅ Task 4.1: Group configuration parameters (Large change)

### Session 7 (Final Polish):
- ✅ Task 8.1: Extract common Tailwind patterns (if desired)
- ✅ Task 9.1: Check for unused dependencies
- ✅ Task 9.2: Update dependencies

---

## Key Files Reference

**Core Logic:**
- `src/lib/l1Monitor.ts` - L1 contract interaction, caching
- `src/lib/slashingDetector.ts` - Round detection and status calculation
- `src/lib/multicall.ts` - Batch contract reads
- `src/lib/immutableCache.ts` - Smart caching system

**State Management:**
- `src/store/slashingStore.ts` - Zustand store
- `src/hooks/useSlashingMonitor.ts` - Main orchestration hook

**Components:**
- `src/components/Dashboard.tsx` - Main container
- `src/components/RoundCard.tsx` - Individual round display (199 lines)
- `src/components/SlashingTimeline.tsx` - Timeline visualization (406 lines)
- `src/components/StatsPanel.tsx` - Stats cards
- `src/components/Header.tsx` - Top header

**Types & Utils:**
- `src/types/slashing.ts` - All TypeScript interfaces
- `src/lib/utils.ts` - Utility functions (to be split)

**Config:**
- `src/App.tsx` - Config initialization

---

## Notes for Future Sessions

1. **Functionality is Complete**: Don't add new features, only refactor existing code
2. **Maintain Test Coverage**: After each change, run build + manual tests
3. **Commit Frequently**: Each completed task should be a separate commit
4. **No Breaking Changes**: All refactors must maintain existing behavior
5. **Type Safety First**: Prefer type safety over brevity

---

## Success Criteria

- ✅ All duplicate code removed
- ✅ No files over 250 lines (except generated files)
- ✅ Utils split into logical modules
- ✅ Large components broken down into smaller pieces
- ✅ No unnecessary comments
- ✅ Consistent error handling and logging
- ✅ No dead code
- ✅ Build and lint pass
- ✅ All functionality works identically to before refactor
- ✅ Code is more maintainable and easier to understand

---

**Document Version:** 1.0
**Created:** 2025-11-13
**Project:** Aztec Slashing Monitor
**For:** Multi-session refactoring work
