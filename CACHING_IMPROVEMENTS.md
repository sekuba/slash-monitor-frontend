# Caching Improvements Summary

This document summarizes the caching architecture improvements made to optimize performance and reduce RPC calls.

## What Changed

### 1. **Immutability-Aware Caching** 🎯

**Old Approach:**
- All data cached with fixed TTL (30s for rounds, 5min for details)
- Executed rounds re-fetched repeatedly even though they never change
- Wasted RPC calls on immutable blockchain data

**New Approach:**
- **Executed rounds = Cached FOREVER** (immutable)
- **Active rounds = Cached with TTL** (mutable, need periodic refresh)
- Automatic promotion to permanent cache when `isExecuted` becomes true

**Implementation:**
- Created `ImmutableAwareCache<K, V>` utility class (`src/lib/immutableCache.ts`)
- Separates mutable and immutable caches internally
- Tracks cache hits, misses, and promotions for monitoring

### 2. **React Query Removal** 📦

**Why:**
- React Query was imported but never actually used
- Added ~50KB to bundle with zero benefit
- Custom caching better suited for blockchain data

**Impact:**
- Smaller bundle size
- Simpler architecture
- No change to functionality (it wasn't being used anyway!)

### 3. **Optimized Polling Intervals** ⏱️

**Changes:**
```
Old: Poll every 2 minutes (15 polls per 30min round)
New: Poll every 3 minutes (10 polls per 30min round)
```

**Rationale:**
- Rounds are 30 minutes long
- Vote counts update frequently but don't need real-time tracking
- 3min latency is acceptable for monitoring use case
- **33% fewer RPC calls** from polling alone

### 4. **Increased Historical Display** 📊

**Changes:**
```
Old: Show 2 most recent executed rounds
New: Show 10 most recent executed rounds (~5 hours of history)
```

**Why It Works:**
- Executed rounds are now cached forever (one-time RPC cost)
- No performance penalty for showing more history
- Users get more context about recent slashing activity

### 5. **Cache Statistics Logging** 📈

**New Feature:**
- Logs cache stats during polls (respects `consoleLogProbability`)
- Shows: cache size, hit rate, promotions (mutable → immutable)
- Example output:
  ```
  [L1Monitor] Cache: 45 entries (30 immutable, 15 mutable) | Hit rate: 87.3% | Promotions: 12
  [SlashingDetector] Cache: 28 entries (18 immutable, 10 mutable) | Hit rate: 82.1% | Promotions: 8
  ```

### 6. **Cache Size Limits** 🔒

**Protection Against Memory Leaks:**
- L1 round cache: Max 100 mutable entries (~3 hours of rounds)
- Details cache: Max 50 mutable entries (covers all active rounds)
- Immutable cache: Unlimited (executed rounds, negligible memory)
- Total memory: ~1-2MB worst case

## Performance Impact

### RPC Call Reduction

**Before:**
```
26 rounds × 5 calls each × 30 polls/hour = ~3,900 calls/hour
- Rounds: 26 × 30 = 780 calls/hour
- Details: 26 × 4 = 104 × 30 = 3,120 calls/hour
```

**After:**
```
~5 active rounds × 5 calls × 20 polls/hour = ~500 calls/hour
- Executed rounds: Cached forever (one-time cost)
- Active rounds: Only these get re-fetched
```

**Result: ~87% reduction in RPC calls!** 🎉

### Expected Behavior

#### First Poll (Cold Cache)
```
- Fetches ~26 rounds (current + executable + historical)
- All data fetched from RPC
- ~130 RPC calls
- Cache empty
```

#### Second Poll (Warm Cache)
```
- Executed rounds: Cache hit (0 RPC calls)
- Active rounds: Cache hit if within TTL
- Only new/changed rounds fetched
- ~10-20 RPC calls
- Cache: ~20 immutable, ~6 mutable
```

#### After 1 Hour (Steady State)
```
- Most historical data cached permanently
- Only active rounds re-fetched
- ~5-10 RPC calls per poll
- Cache: ~30 immutable, ~5 mutable
- Hit rate: ~90%+
```

## Configuration Reference

### Environment Variables (.env)

```bash
# Polling (3 minutes = ~10 polls per 30min round)
VITE_L2_POLL_INTERVAL=180000

# Cache TTL (only for mutable rounds, executed rounds cached forever)
VITE_L1_ROUND_CACHE_TTL=120000        # 2 minutes
VITE_DETAILS_CACHE_TTL=300000         # 5 minutes

# History Display
VITE_MAX_EXECUTED_ROUNDS_TO_SHOW=10   # Show last 10 executed
VITE_MAX_ROUNDS_TO_SCAN_FOR_HISTORY=20 # Scan back 20 rounds
```

### Default Values (App.tsx)

All configuration has sensible defaults if environment variables are omitted:
- Poll interval: 3 minutes
- Round cache TTL: 2 minutes (mutable only)
- Details cache TTL: 5 minutes (mutable only)
- History display: 10 executed rounds
- History scan: 20 rounds back

## Code Changes

### New Files
- `src/lib/immutableCache.ts` - Immutability-aware cache utility

### Modified Files
- `src/lib/l1Monitor.ts` - Uses ImmutableAwareCache, added cache stats
- `src/lib/slashingDetector.ts` - Uses ImmutableAwareCache, added cache stats
- `src/hooks/useSlashingMonitor.ts` - Added cache stats logging
- `src/App.tsx` - Removed React Query, updated config defaults
- `.env.example` - Updated documentation and defaults
- `package.json` - Removed @tanstack/react-query dependency

## Testing the Improvements

### Verify Cache Effectiveness

1. **Check Console Logs:**
   ```
   [L1Monitor] Cache: X entries (Y immutable, Z mutable) | Hit rate: W% | Promotions: N
   ```

2. **Expected Patterns:**
   - Hit rate should increase from ~0% to 80-90% after a few polls
   - Immutable cache size grows as rounds execute, then stabilizes
   - Mutable cache size stays small (~5-10 entries)
   - Promotions occur when rounds transition from voting → executed

3. **Monitor RPC Calls:**
   - Use browser DevTools Network tab
   - Filter for RPC endpoint
   - Should see 100+ calls on first load, then <20 per subsequent poll

### Verify Behavior

1. **Historical Rounds:**
   - Should now see 10 executed rounds (vs 2 previously)
   - Scrolling through history should be instant (all cached)

2. **Active Rounds:**
   - Vote counts update periodically (every 3 min)
   - Status changes reflected appropriately
   - Execution transitions work correctly

3. **Cache Invalidation:**
   - New votes → cache invalidated, fresh data fetched
   - Round execution → promoted to immutable cache

## Benefits Summary

✅ **87% fewer RPC calls** - Rate limit protection
✅ **Faster UI** - Executed rounds load instantly
✅ **More history** - 10 rounds vs 2 (5 hours vs 1 hour)
✅ **Smaller bundle** - Removed unused React Query (~50KB)
✅ **Better caching** - Leverages blockchain immutability
✅ **Observable** - Cache stats for monitoring effectiveness
✅ **Protected** - Cache size limits prevent memory leaks

## Why This Works for Blockchain Data

Blockchain data has predictable mutation patterns:

1. **Executed rounds = Immutable forever**
   - Once `isExecuted = true`, data NEVER changes
   - Can cache forever with zero risk of stale data

2. **Voting rounds = Temporarily mutable**
   - Vote counts increase during voting period
   - Cache with TTL, invalidate on vote count change

3. **Status transitions = One-way**
   - voting → quorum-reached → executable → executed
   - Never goes backwards, only forwards

This architecture exploits these patterns for maximum efficiency while ensuring data freshness where it matters.

## Future Optimization Ideas

1. **WebSocket for Real-Time Updates** - Replace polling with events
2. **IndexedDB Persistence** - Cache across page reloads
3. **Predictive Prefetching** - Fetch likely-needed rounds proactively
4. **Differential Updates** - Only fetch changed fields, not full rounds

But the current implementation already achieves ~90% of possible gains with minimal complexity!

---

**Questions?** Check the implementation in:
- `src/lib/immutableCache.ts` - Core caching logic
- `src/lib/l1Monitor.ts` - L1 round caching
- `src/lib/slashingDetector.ts` - Details caching
