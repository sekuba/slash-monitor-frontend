# Aztec Slashing Monitor - Codebase Refactoring Plan

**Version:** 1.0
**Created:** 2025-11-13
**Target:** Complete modernization and cleanup while maintaining all functionality

---

## Executive Summary

This codebase is **well-architected** with excellent modern practices, but requires targeted improvements for maintainability and code quality. The refactoring focuses on:

1. **Eliminating dead code** and unused functionality
2. **Simplifying complex functions** (some >300 lines)
3. **Standardizing patterns** across the codebase
4. **Adding minimal testing** infrastructure
5. **Modernizing tooling** (ESLint, Prettier)
6. **No functional changes** - only improvements to code quality

**Current State:** ~4,100 LOC TypeScript/React
**Current Grade:** B+
**Target Grade:** A

---

## Guiding Principles

✅ **DO:**
- Remove unnecessary comments (keep only complex logic explanations)
- Consolidate related code without excessive file splitting
- Use modern, lean dependencies
- Fix inconsistencies and simplify where possible
- Make code self-documenting through clear naming
- Add minimal testing for critical business logic

❌ **DON'T:**
- Change any functionality or behavior
- Over-split files into micro-modules
- Add unnecessary dependencies
- Add verbose documentation comments
- Create new features

---

## Phase 1: Foundation & Tooling (1-2 hours)

**Goal:** Establish testing infrastructure and modernize tooling for confident refactoring

### Task 1.1: Add Prettier for Code Formatting

**Files to create/modify:**
- Create `.prettierrc.json`
- Update `package.json`

**Actions:**
```bash
# Install Prettier
npm install -D prettier eslint-config-prettier

# Create .prettierrc.json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "avoid"
}

# Add to package.json scripts
"format": "prettier --write \"src/**/*.{ts,tsx}\"",
"format:check": "prettier --check \"src/**/*.{ts,tsx}\""

# Add .prettierignore
dist
node_modules
.env
```

**Verification:** Run `npm run format:check` - should pass

---

### Task 1.2: Upgrade ESLint Ecosystem

**Files to modify:**
- `package.json`

**Actions:**
```bash
# Upgrade to latest ESLint v8 + TypeScript ESLint v8
npm install -D eslint@^8.57.0 \
  @typescript-eslint/eslint-plugin@^8.0.0 \
  @typescript-eslint/parser@^8.0.0

# Add Prettier ESLint config to prevent conflicts
npm install -D eslint-config-prettier
```

**Update ESLint config** (create `eslint.config.js` for flat config if desired, or keep existing):
- Add `eslint-config-prettier` to extends array
- Ensure no conflicts with Prettier

**Verification:** Run `npm run lint` - should pass

---

### Task 1.3: Add Minimal Testing Infrastructure

**Files to create/modify:**
- Create `vitest.config.ts`
- Update `package.json`
- Create test files

**Actions:**
```bash
# Install Vitest + React Testing Library
npm install -D vitest @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event jsdom
```

**Create `vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

**Create `src/test/setup.ts`:**
```typescript
import '@testing-library/jest-dom'
```

**Add to `package.json` scripts:**
```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui",
"coverage": "vitest run --coverage"
```

**Verification:** Run `npm test` - should pass (even with no tests)

---

### Task 1.4: Create Basic Tests for Pure Functions

**Files to create:**
- `src/lib/utils.test.ts`
- `src/lib/immutableCache.test.ts`

**Priority test targets:**

1. **`src/lib/utils.ts`** - Pure formatter functions:
   - `formatAddress()`
   - `formatEther()`
   - `formatTimeRemaining()`
   - `formatNumber()`
   - `getStatusColor()`
   - `getPhaseInfo()`

2. **`src/lib/immutableCache.ts`** - Cache logic:
   - `get()` with TTL
   - `set()` with immutability flag
   - `clear()`
   - TTL expiration

**Example test structure:**
```typescript
// src/lib/utils.test.ts
import { describe, it, expect } from 'vitest'
import { formatAddress, formatEther, formatTimeRemaining } from './utils'

describe('formatAddress', () => {
  it('should format Ethereum addresses correctly', () => {
    expect(formatAddress('0x1234567890123456789012345678901234567890'))
      .toBe('0x1234...7890')
  })
})

// Add ~10-15 tests total for critical utils
```

**Verification:** Run `npm test` - all tests pass

---

## Phase 2: Dead Code Removal (30 minutes)

**Goal:** Remove unused code to reduce maintenance burden

### Task 2.1: Remove Unused Function `isRoundReadyToExecute`

**File:** `src/lib/l1Monitor.ts`
**Lines:** 239-248

**Verification:**
- Grep for usage: `grep -r "isRoundReadyToExecute" src/` - should only find definition
- Remove the entire function

**Before:**
```typescript
async isRoundReadyToExecute(round: bigint, slot?: bigint): Promise<boolean> {
  const currentSlot = slot ?? (await this.getCurrentSlot())
  const ready = await this.publicClient.readContract({
    address: this.config.tallySlashingProposerAddress,
    abi: tallySlashingProposerAbi,
    functionName: 'isRoundReadyToExecute',
    args: [round, currentSlot],
  })
  return ready as boolean
}
```

**After:** Deleted

---

### Task 2.2: Remove Non-Optimized Batch Method

**File:** `src/lib/l1Monitor.ts`
**Lines:** 422-486

**Function to remove:** `batchGetPayloadAddressesAndVetoStatus()`

**Verification:**
- Only `batchGetPayloadAddressesAndVetoStatusOptimized()` should remain
- Grep to ensure old method not called: `grep -r "batchGetPayloadAddressesAndVetoStatus(" src/`

---

### Task 2.3: Remove Unused VetoInstructions Component

**File:** `src/components/VetoInstructions.tsx`

**Actions:**
1. Verify component is not rendered anywhere: `grep -r "VetoInstructions" src/`
2. If unused, delete the entire file
3. Remove any imports

**Verification:** Build succeeds, app works normally

---

### Task 2.4: Clean Up Unused Imports

**All files**

**Actions:**
- Run ESLint auto-fix: `npm run lint -- --fix`
- Manually review any remaining unused imports
- TypeScript compiler will catch most: `tsc --noEmit`

**Verification:** `npm run lint` passes with 0 warnings

---

## Phase 3: Code Simplification & Refactoring (3-4 hours)

**Goal:** Break down complex functions, improve readability

### Task 3.1: Refactor `detectExecutableRounds` - Extract Helper Functions

**File:** `src/lib/slashingDetector.ts`
**Lines:** 314-669 (356 lines - TOO COMPLEX)

**Current structure:**
```typescript
async detectExecutableRounds(currentRound: bigint, currentSlot: bigint): Promise<DetectedSlashing[]> {
  // 356 lines of complex logic
}
```

**Target structure:**
```typescript
// Extract these private helper methods:

private calculateRoundRanges(currentRound: bigint): {
  earlyWarning: { start: bigint; end: bigint }
  executable: { start: bigint; end: bigint }
} {
  // Lines 315-346 - Calculate which rounds to check
}

private async fetchRoundInfoBatch(rounds: bigint[]): Promise<Map<bigint, RoundInfo>> {
  // Lines 348-350 - Batch fetch round info
}

private categorizeRoundsByStatus(
  roundsToCheck: bigint[],
  roundInfoMap: Map<bigint, RoundInfo>,
  currentRound: bigint
): RoundToProcess[] {
  // Lines 352-400 - First pass categorization
}

private async fetchRoundDetails(
  roundsNeedingDetails: bigint[]
): Promise<Map<bigint, DetailedRoundInfo>> {
  // Lines 410-550 - Batch fetch details
}

private buildDetectedSlashings(
  processedRounds: RoundToProcess[],
  detailsMap: Map<bigint, DetailedRoundInfo>
): DetectedSlashing[] {
  // Lines 560-669 - Build final result objects
}

// Main function becomes orchestration:
async detectExecutableRounds(currentRound: bigint, currentSlot: bigint): Promise<DetectedSlashing[]> {
  const ranges = this.calculateRoundRanges(currentRound)
  const roundsToCheck = this.getRoundsInRanges(ranges)
  const roundInfoMap = await this.fetchRoundInfoBatch(roundsToCheck)
  const categorized = this.categorizeRoundsByStatus(roundsToCheck, roundInfoMap, currentRound)
  const roundsNeedingDetails = categorized.filter(/* ... */).map(r => r.round)
  const detailsMap = await this.fetchRoundDetails(roundsNeedingDetails)
  return this.buildDetectedSlashings(categorized, detailsMap)
}
```

**Benefits:**
- Main function ~30 lines (was 356)
- Each helper is testable independently
- Clear separation of concerns
- Easier to understand and maintain

**Verification:**
- All tests pass
- App functionality unchanged
- No regression in behavior

---

### Task 3.2: Split `useSlashingMonitor` Hook into Smaller Hooks

**File:** `src/hooks/useSlashingMonitor.ts`
**Lines:** 1-250 (DOES TOO MUCH)

**Current:** Single 250-line hook handling:
- Initialization
- Polling
- State management
- Notifications

**Target structure:**
```typescript
// Create new file: src/hooks/useMonitorInitialization.ts
export function useMonitorInitialization(config: MonitorConfig) {
  // Lines 30-90 - Initialization logic only
  return { isInitialized, error, initialize }
}

// Create new file: src/hooks/useMonitorPolling.ts
export function useMonitorPolling(l1Monitor: L1Monitor | null, detector: SlashingDetector | null) {
  // Lines 95-180 - Polling logic only
  return { isPolling, startPolling, stopPolling }
}

// Create new file: src/hooks/useSlashingNotifications.ts
export function useSlashingNotifications(slashings: DetectedSlashing[]) {
  // Lines 185-240 - Notification logic only
  return { lastNotification }
}

// Main hook becomes composition:
// src/hooks/useSlashingMonitor.ts
export function useSlashingMonitor(config: MonitorConfig) {
  const { isInitialized, error, initialize } = useMonitorInitialization(config)
  const { isPolling, startPolling, stopPolling } = useMonitorPolling(/* ... */)
  const { lastNotification } = useSlashingNotifications(/* ... */)

  return {
    isInitialized,
    isPolling,
    error,
    lastNotification,
    initialize,
    startPolling,
    stopPolling,
  }
}
```

**Benefits:**
- Each hook has single responsibility
- Easier to test independently
- More reusable
- Clearer dependencies

**Verification:**
- All components using the hook still work
- No functional changes
- Tests pass

---

### Task 3.3: Extract Countdown Logic to Custom Hook

**Files affected:**
- `src/components/RoundCard.tsx` (lines 29-44, 115-160)
- `src/components/SlashingTimeline.tsx` (lines 247-488)

**Create:** `src/hooks/useCountdown.ts`

**Target:**
```typescript
// src/hooks/useCountdown.ts
export function useCountdown(targetSlot: bigint, config: MonitorConfig) {
  const [timeRemaining, setTimeRemaining] = useState<number>(0)
  const [isExpired, setIsExpired] = useState(false)

  useEffect(() => {
    // Extract all countdown calculation logic here
  }, [targetSlot, config])

  return { timeRemaining, isExpired, formattedTime: formatTimeRemaining(timeRemaining) }
}

// Usage in components:
const { timeRemaining, isExpired, formattedTime } = useCountdown(targetSlot, config)
```

**Benefits:**
- DRY - no duplication between RoundCard and SlashingTimeline
- Testable countdown logic
- Simpler component code

**Verification:**
- Countdown timers work identically
- No visual changes
- Tests pass

---

### Task 3.4: Simplify SlashingTimeline Component

**File:** `src/components/SlashingTimeline.tsx`
**Lines:** 1-491 (TOO LARGE)

**Extract sub-components:**

1. **Create `src/components/PhaseCard.tsx`:**
```typescript
// Extract the phase card rendering logic (lines 270-380)
export function PhaseCard({
  phase,
  isActive,
  isComplete,
  config
}: PhaseCardProps) {
  // Render individual phase card
}
```

2. **Create `src/components/EmergencyHaltIndicator.tsx`:**
```typescript
// Extract emergency halt calculation and display (lines 247-268)
export function EmergencyHaltIndicator({
  currentSlot,
  config
}: EmergencyHaltIndicatorProps) {
  // Calculate and display emergency halt status
}
```

**Target `SlashingTimeline.tsx` structure:**
```typescript
export function SlashingTimeline({ slashing, config }: SlashingTimelineProps) {
  // Main timeline logic (now ~150 lines)
  return (
    <div>
      <EmergencyHaltIndicator currentSlot={currentSlot} config={config} />
      {phases.map(phase => (
        <PhaseCard key={phase.name} phase={phase} isActive={...} isComplete={...} />
      ))}
    </div>
  )
}
```

**Benefits:**
- Main component ~150 lines (was 491)
- Sub-components are reusable
- Easier to understand
- Maintains same functionality

**Verification:**
- Timeline displays identically
- All interactions work
- Tests pass

---

### Task 3.5: Simplify RoundCard Component

**File:** `src/components/RoundCard.tsx`
**Lines:** 1-288

**Extract:** `src/components/ValidatorList.tsx`

```typescript
// Lines 180-250 - Validator list rendering
export function ValidatorList({
  validators,
  isExpanded,
  onToggle
}: ValidatorListProps) {
  // Render validator list with expand/collapse
}
```

**Target `RoundCard.tsx`:**
```typescript
export function RoundCard({ slashing }: RoundCardProps) {
  // Main card logic (~200 lines)
  return (
    <div>
      {/* Round metadata */}
      <ValidatorList validators={slashing.validators} />
    </div>
  )
}
```

**Benefits:**
- ~80-line reduction
- Validator list is reusable
- Clearer component structure

**Verification:**
- Round cards display identically
- Expand/collapse works
- Tests pass

---

## Phase 4: Consistency & Standardization (2 hours)

**Goal:** Standardize patterns across codebase for easier maintenance

### Task 4.1: Standardize Error Handling Pattern

**Files affected:** Multiple

**Current inconsistency:**
```typescript
// Pattern 1: Throw (some files)
throw new Error('Something failed')

// Pattern 2: Return null (other files)
catch (error) {
  console.error('Error:', error)
  return null
}

// Pattern 3: Silent fail (some places)
catch (error) {
  console.error('Error:', error)
}
```

**Target pattern:**
```typescript
// Create src/lib/errorHandler.ts
export class ErrorHandler {
  static handle(error: unknown, context: string): never {
    console.error(`[${context}] Error:`, error)
    throw error
  }

  static handleSafe(error: unknown, context: string): void {
    console.error(`[${context}] Error (non-critical):`, error)
  }
}

// Usage:
try {
  await riskyOperation()
} catch (error) {
  ErrorHandler.handle(error, 'L1Monitor.loadContractParameters')
}
```

**Files to update:**
- `src/lib/l1Monitor.ts` - 15+ error handling sites
- `src/lib/slashingDetector.ts` - 10+ error handling sites
- `src/hooks/useSlashingMonitor.ts` - 5+ error handling sites

**Benefits:**
- Consistent error handling
- Easier to add error reporting service later
- Structured error context

**Verification:**
- Errors still logged
- App behavior unchanged
- Tests pass

---

### Task 4.2: Standardize Console Logging

**Files affected:** All files with console.log

**Current inconsistency:**
```typescript
// Some use probability-based logging
if (Math.random() < config.consoleLogProbability) {
  console.log('Message')
}

// Others log unconditionally
console.log('Message')

// Inconsistent prefixes
console.log('[Detection] ...')
console.log('Notification: ...')
```

**Target pattern:**
```typescript
// Create src/lib/logger.ts
export class Logger {
  constructor(private context: string, private probability = 1.0) {}

  log(message: string, ...args: unknown[]): void {
    if (Math.random() < this.probability) {
      console.log(`[${this.context}] ${message}`, ...args)
    }
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[${this.context}] ${message}`, ...args)
  }
}

// Usage:
const logger = new Logger('L1Monitor', config.consoleLogProbability)
logger.log('Loading contract parameters')
```

**Files to update:**
- `src/lib/l1Monitor.ts` - ~10 log statements
- `src/lib/slashingDetector.ts` - ~8 log statements
- `src/hooks/useSlashingMonitor.ts` - ~7 log statements

**Benefits:**
- Consistent logging format
- Easy to disable/enable by context
- Easier to add remote logging later

**Verification:**
- Logs still appear in console
- Probability-based logging works
- Tests pass

---

### Task 4.3: Standardize Boolean Naming

**Files affected:** Multiple

**Current inconsistency:**
```typescript
isSlashingEnabled     // ✓ Good
hasQuorum            // ✓ Good
areNotificationsEnabled()  // ✓ Good
slashingEnabled      // ✗ Missing is/has/are prefix
showNotificationBanner  // ✗ Should be isShowingNotificationBanner or showsBanner
```

**Standardization:**
- All booleans: `is*`, `has*`, `are*`, `should*`, `can*` prefix
- Functions returning booleans: `is*`, `has*`, `check*` prefix

**Files to update:**
- `src/components/Dashboard.tsx` - 3 boolean variables
- `src/components/RoundCard.tsx` - 2 boolean variables
- `src/lib/l1Monitor.ts` - 5 boolean returns

**Example changes:**
```typescript
// Before
const showBanner = notifications.length > 0

// After
const shouldShowBanner = notifications.length > 0
```

**Verification:**
- TypeScript compiles
- No functional changes
- Tests pass

---

### Task 4.4: Consolidate ABI Files

**Files to consolidate:**
- `src/lib/contracts/rollupAbi.ts` (34 lines)
- `src/lib/contracts/slasherAbi.ts` (82 lines)
- `src/lib/contracts/tallySlashingProposerAbi.ts` (201 lines)

**Target:** `src/lib/contracts/abis.ts` (single file)

```typescript
// src/lib/contracts/abis.ts
export const rollupAbi = [
  // ... existing content
] as const

export const slasherAbi = [
  // ... existing content
] as const

export const tallySlashingProposerAbi = [
  // ... existing content
] as const
```

**Update imports across codebase:**
```typescript
// Before
import { rollupAbi } from '@/lib/contracts/rollupAbi'
import { slasherAbi } from '@/lib/contracts/slasherAbi'

// After
import { rollupAbi, slasherAbi } from '@/lib/contracts/abis'
```

**Delete old files:**
- Delete `src/lib/contracts/rollupAbi.ts`
- Delete `src/lib/contracts/slasherAbi.ts`
- Delete `src/lib/contracts/tallySlashingProposerAbi.ts`

**Benefits:**
- Single source of truth for ABIs
- Easier to manage
- Follows "no excessive file splitting" principle

**Verification:**
- TypeScript compiles
- All contract calls work
- Tests pass

---

### Task 4.5: Remove Unnecessary Comments

**All files**

**Guidelines for removal:**
```typescript
// ✗ REMOVE - Obvious
// Transform raw RPC response to our Offense type
const offense = transformOffense(raw)

// ✗ REMOVE - Obvious
// Set loading state
setLoading(true)

// ✓ KEEP - Explains complex logic
// Strategy 1: Exact match by validator + epoch (best match)
const exactMatch = findExactMatch(validator, epoch)

// ✓ KEEP - Explains why
// We batch calls to reduce RPC overhead by ~87%
const batched = await multicall(calls)
```

**Target files:**
- `src/lib/slashingDetector.ts` - ~15 comments to review
- `src/lib/l1Monitor.ts` - ~20 comments to review
- `src/components/*.tsx` - ~10 comments to review

**Keep:**
- Complex algorithm explanations
- Non-obvious business logic
- "Why" comments (not "what")
- Performance optimization notes

**Remove:**
- Obvious code translations
- Redundant type descriptions
- Commented-out code

**Verification:**
- Code remains clear
- Complex logic still documented
- No commented-out code remains

---

## Phase 5: Dependencies & Modernization (30 minutes)

**Goal:** Ensure dependencies are modern and minimal

### Task 5.1: Upgrade TypeScript ESLint (if not done in Phase 1)

**Already covered in Task 1.2** - Skip if completed

---

### Task 5.2: Add Type-Only Import Optimization

**All files**

**Update imports to use `type` keyword where appropriate:**

```typescript
// Before
import { DetectedSlashing, RoundStatus } from '@/types/slashing'

// After
import type { DetectedSlashing, RoundStatus } from '@/types/slashing'

// Or mixed:
import { someFunction } from '@/lib/utils'
import type { SomeType } from '@/lib/utils'
```

**Benefits:**
- Smaller bundle size (types removed at build time)
- Clearer intent
- Faster TypeScript compilation

**Files to update:** All files with type imports (~20 files)

**Verification:**
- `npm run build` succeeds
- Bundle size unchanged or smaller
- Tests pass

---

### Task 5.3: Review and Update package.json Scripts

**File:** `package.json`

**Current scripts:**
```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
}
```

**Add missing scripts:**
```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
  "lint:fix": "npm run lint -- --fix",
  "format": "prettier --write \"src/**/*.{ts,tsx}\"",
  "format:check": "prettier --check \"src/**/*.{ts,tsx}\"",
  "type-check": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui",
  "coverage": "vitest run --coverage",
  "prebuild": "npm run lint && npm run type-check && npm run test",
  "validate": "npm run lint && npm run type-check && npm run test && npm run build"
}
```

**Benefits:**
- Complete CI/CD script coverage
- Easy validation before commits
- Consistent tooling

**Verification:**
- All scripts run successfully
- `npm run validate` passes

---

### Task 5.4: Audit Dependencies for Updates

**File:** `package.json`

**Check for available updates:**
```bash
npx npm-check-updates
```

**Safe updates to consider:**
- React 18.2 → 18.3 (if available)
- TypeScript 5.2 → 5.6 (latest)
- Vite 5.0 → 5.4 (latest)

**Do NOT update if:**
- Breaking changes exist
- Requires code changes
- Not compatible with other deps

**Benefits:**
- Latest features
- Security patches
- Performance improvements

**Verification:**
- `npm run validate` passes
- App works identically
- No console warnings

---

## Phase 6: Final Polish & Validation (1 hour)

**Goal:** Ensure codebase is clean, tested, and production-ready

### Task 6.1: Add Error Boundary Component

**Create:** `src/components/ErrorBoundary.tsx`

```typescript
import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-8 text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">
            Something went wrong
          </h2>
          <p className="text-gray-600 mb-4">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
```

**Update:** `src/App.tsx`

```typescript
import { ErrorBoundary } from '@/components/ErrorBoundary'

function App() {
  return (
    <ErrorBoundary>
      <Dashboard config={config} />
    </ErrorBoundary>
  )
}
```

**Benefits:**
- Prevents full app crashes
- User-friendly error display
- Better debugging

**Verification:**
- Trigger an error to test boundary
- Error displays correctly
- Reload works

---

### Task 6.2: Add Performance Optimizations

**Files to update:**
- `src/components/RoundCard.tsx`
- `src/components/StatsPanel.tsx`
- `src/components/SlashingTimeline.tsx`

**Add React.memo to expensive components:**

```typescript
// src/components/RoundCard.tsx
import { memo } from 'react'

export const RoundCard = memo(({ slashing }: RoundCardProps) => {
  // ... component code
})

// Add display name for debugging
RoundCard.displayName = 'RoundCard'
```

**Add useCallback for event handlers:**

```typescript
// src/components/Dashboard.tsx
const handleNotificationDismiss = useCallback(() => {
  setShowNotificationBanner(false)
}, [])
```

**Benefits:**
- Reduced re-renders
- Better performance with many rounds
- Smoother UI updates

**Verification:**
- React DevTools profiler shows fewer re-renders
- UI feels snappier
- No functional changes

---

### Task 6.3: Run Full Validation Suite

**Actions:**
```bash
# 1. Format all code
npm run format

# 2. Lint and fix
npm run lint:fix

# 3. Type check
npm run type-check

# 4. Run tests
npm test

# 5. Build production
npm run build

# 6. Test production build
npm run preview
```

**Verification checklist:**
- [ ] All formatting consistent
- [ ] Zero ESLint warnings
- [ ] Zero TypeScript errors
- [ ] All tests pass (target: >80% coverage of utils)
- [ ] Production build succeeds
- [ ] App works in preview mode
- [ ] No console errors
- [ ] No console warnings

---

### Task 6.4: Update Documentation

**Files to update:**
- `README.md` - Add testing section, update scripts
- Create `ARCHITECTURE.md` - Document component structure
- Update `.env.example` if needed

**README.md additions:**

```markdown
## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Lint code
- `npm run format` - Format code with Prettier
- `npm run validate` - Run all checks (lint, type-check, test, build)

### Testing

Tests are written using Vitest and React Testing Library. Run tests with:

```bash
npm test
```

### Code Quality

This project uses:
- **TypeScript** with strict mode for type safety
- **ESLint** for code quality
- **Prettier** for consistent formatting
- **Vitest** for testing

Run all quality checks:

```bash
npm run validate
```
```

**ARCHITECTURE.md content:**

```markdown
# Architecture Overview

## Directory Structure

```
src/
├── components/      # React components
├── hooks/          # Custom React hooks
├── lib/            # Business logic & utilities
│   ├── contracts/  # Smart contract ABIs
│   └── ...         # Core monitoring logic
├── store/          # Zustand state management
└── types/          # TypeScript type definitions
```

## Key Components

### Monitoring System
- `L1Monitor` - Interfaces with L1 contracts
- `SlashingDetector` - Detects slashing events
- `ImmutableCache` - Optimized caching (87% RPC reduction)

### UI Components
- `Dashboard` - Main app container
- `SlashingTimeline` - Visual timeline of slashing rounds
- `RoundCard` - Individual round details
- `StatsPanel` - Statistics overview

### Custom Hooks
- `useSlashingMonitor` - Main monitoring orchestration
- `useCountdown` - Countdown timer logic

## Data Flow

1. `useSlashingMonitor` initializes L1Monitor and SlashingDetector
2. Polling interval fetches current round/slot from L1
3. SlashingDetector scans for active/executable rounds
4. Results stored in Zustand store
5. Components subscribe to store and re-render
6. Browser notifications triggered for critical events
```

**Verification:**
- Documentation is clear and accurate
- All scripts documented
- Architecture is explained

---

### Task 6.5: Create Migration Checklist

**Create:** `REFACTORING_CHECKLIST.md`

```markdown
# Refactoring Completion Checklist

Track progress through the refactoring plan.

## Phase 1: Foundation & Tooling
- [ ] Task 1.1: Add Prettier
- [ ] Task 1.2: Upgrade ESLint
- [ ] Task 1.3: Add testing infrastructure
- [ ] Task 1.4: Create basic tests

## Phase 2: Dead Code Removal
- [ ] Task 2.1: Remove `isRoundReadyToExecute`
- [ ] Task 2.2: Remove non-optimized batch method
- [ ] Task 2.3: Remove VetoInstructions
- [ ] Task 2.4: Clean unused imports

## Phase 3: Code Simplification
- [ ] Task 3.1: Refactor `detectExecutableRounds`
- [ ] Task 3.2: Split `useSlashingMonitor`
- [ ] Task 3.3: Extract countdown hook
- [ ] Task 3.4: Simplify SlashingTimeline
- [ ] Task 3.5: Simplify RoundCard

## Phase 4: Consistency & Standardization
- [ ] Task 4.1: Standardize error handling
- [ ] Task 4.2: Standardize logging
- [ ] Task 4.3: Standardize boolean naming
- [ ] Task 4.4: Consolidate ABIs
- [ ] Task 4.5: Remove unnecessary comments

## Phase 5: Dependencies & Modernization
- [ ] Task 5.1: Upgrade TypeScript ESLint
- [ ] Task 5.2: Add type-only imports
- [ ] Task 5.3: Update package.json scripts
- [ ] Task 5.4: Audit dependencies

## Phase 6: Final Polish
- [ ] Task 6.1: Add error boundary
- [ ] Task 6.2: Add performance optimizations
- [ ] Task 6.3: Run full validation
- [ ] Task 6.4: Update documentation
- [ ] Task 6.5: Create migration checklist

## Final Validation
- [ ] All tests pass
- [ ] Zero ESLint warnings
- [ ] Zero TypeScript errors
- [ ] Production build succeeds
- [ ] App functionality unchanged
- [ ] Performance same or better
- [ ] Code coverage >80% for utils
```

---

## Success Criteria

### Quantitative Metrics

**Before Refactoring:**
- Total files: 22
- Total LOC: ~4,100
- Largest file: 670 lines
- Largest function: 356 lines
- Test coverage: 0%
- ESLint warnings: Unknown
- Dependencies: 12

**After Refactoring Target:**
- Total files: ~25-28 (slight increase from extracted components)
- Total LOC: ~3,800-4,000 (10-15% reduction from dead code removal)
- Largest file: <400 lines
- Largest function: <100 lines
- Test coverage: >80% for utils, >50% overall
- ESLint warnings: 0
- Dependencies: 13-14 (only Vitest + testing libs added)

### Qualitative Metrics

- [ ] Code is self-documenting (clear names, minimal comments)
- [ ] No excessive file splitting (pragmatic organization)
- [ ] All functions have single responsibility
- [ ] No code duplication
- [ ] Consistent patterns throughout
- [ ] Modern tooling (ESLint 8, Prettier, Vitest)
- [ ] Production-ready with error boundaries
- [ ] All functionality preserved
- [ ] Performance maintained or improved

---

## Estimated Timeline

**Total: 8-10 hours** (can be split across multiple sessions)

- Phase 1: 1-2 hours
- Phase 2: 30 minutes
- Phase 3: 3-4 hours (largest phase)
- Phase 4: 2 hours
- Phase 5: 30 minutes
- Phase 6: 1 hour

**Recommended approach:**
1. Complete Phase 1 and 2 in first session (foundation + quick wins)
2. Complete one task from Phase 3 per session (incremental refactoring)
3. Complete Phase 4 in dedicated session (consistency)
4. Complete Phase 5 and 6 together (final polish)

---

## Risk Mitigation

### Before Starting

1. **Create a backup branch:**
   ```bash
   git checkout -b refactoring-backup
   git checkout -b refactoring-work
   ```

2. **Document current behavior:**
   - Take screenshots of all UI states
   - Document all console logs
   - Note expected behavior

### During Refactoring

1. **Commit after each task:**
   ```bash
   git add .
   git commit -m "Task X.Y: [Description]"
   ```

2. **Test after each phase:**
   - Run validation suite
   - Manual testing in browser
   - Check for regressions

3. **Use feature flags for risky changes:**
   ```typescript
   const USE_NEW_DETECTOR = false // Toggle for testing
   ```

### If Something Breaks

1. **Identify the breaking commit:**
   ```bash
   git log --oneline
   git diff <commit-hash>
   ```

2. **Revert if needed:**
   ```bash
   git revert <commit-hash>
   ```

3. **Use git bisect for regression hunting:**
   ```bash
   git bisect start
   git bisect bad  # Current broken state
   git bisect good <last-known-good-commit>
   ```

---

## Maintenance After Refactoring

### New Code Standards

1. **Before adding new code:**
   - Add tests first (TDD when possible)
   - Follow established patterns
   - Run `npm run validate` before commit

2. **Component checklist:**
   - [ ] TypeScript strict mode compliant
   - [ ] PropTypes defined
   - [ ] Tests written
   - [ ] React.memo if expensive
   - [ ] Error handling in place

3. **Function checklist:**
   - [ ] Single responsibility
   - [ ] <50 lines (prefer <30)
   - [ ] Proper error handling
   - [ ] Tests written
   - [ ] Type-safe

### CI/CD Integration

Add to GitHub Actions or preferred CI:

```yaml
- name: Validate
  run: npm run validate

- name: Check formatting
  run: npm run format:check
```

---

## Notes for Future Sessions

### Context to Preserve

When starting a new session to continue refactoring:

1. **Read this plan completely** - Understand the full scope
2. **Check `REFACTORING_CHECKLIST.md`** - See what's completed
3. **Review recent commits** - Understand changes made
4. **Run validation suite** - Ensure starting from good state
5. **Pick one task** - Complete it fully before moving on

### Session Template

```markdown
## Refactoring Session [Date]

**Starting task:** Phase X, Task Y
**Goal:** [What this task accomplishes]

**Pre-session checklist:**
- [ ] Read full plan
- [ ] Check progress in REFACTORING_CHECKLIST.md
- [ ] Git pull latest
- [ ] Run `npm run validate` - all pass
- [ ] Understand current codebase state

**Post-session checklist:**
- [ ] Task completed fully
- [ ] Tests added/updated
- [ ] `npm run validate` passes
- [ ] Manual testing completed
- [ ] Committed with clear message
- [ ] Updated REFACTORING_CHECKLIST.md
- [ ] Pushed to remote
```

---

## Quick Reference

### File Size Targets

- Components: <300 lines
- Hooks: <150 lines
- Business logic: <400 lines
- Functions: <100 lines
- Utilities: <50 lines

### Testing Targets

- Pure functions: 100% coverage
- Business logic: >80% coverage
- Components: >60% coverage
- Overall: >50% coverage

### Code Quality Targets

- Zero ESLint warnings
- Zero TypeScript errors
- Zero console warnings in production
- All tests passing

### Commands Reference

```bash
# Development
npm run dev                 # Start dev server
npm run build              # Production build
npm run preview            # Preview build

# Quality
npm run lint               # Check code quality
npm run lint:fix          # Auto-fix issues
npm run format            # Format code
npm run format:check      # Check formatting
npm run type-check        # TypeScript check

# Testing
npm test                   # Run tests once
npm run test:watch        # Run tests in watch mode
npm run coverage          # Generate coverage report

# Full validation
npm run validate          # Run everything
```

---

## Summary

This refactoring plan transforms a **good codebase into an excellent one** by:

✅ Removing dead code and bloat
✅ Simplifying complex functions
✅ Standardizing patterns
✅ Adding testing infrastructure
✅ Modernizing tooling
✅ Improving maintainability

**Without changing any functionality.**

The result is a lean, modern, highly maintainable codebase that follows current best practices and is ready for long-term production use.

---

**Ready to start? Begin with Phase 1, Task 1.1!**
