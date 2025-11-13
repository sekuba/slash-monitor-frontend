/**
 * Immutability-aware cache that permanently stores immutable data
 * and applies TTL only to mutable data.
 *
 * This is optimized for blockchain data where certain states (like executed rounds)
 * never change and can be cached forever, while other states (like voting rounds)
 * need periodic refreshing.
 */
export class ImmutableAwareCache<K, V> {
  private immutableCache = new Map<string, V>()
  private mutableCache = new Map<string, { data: V; timestamp: number; ttl: number }>()
  private maxMutableSize: number

  // Cache statistics
  private hits = 0
  private misses = 0
  private promotions = 0 // Mutable → Immutable promotions

  constructor(
    private keySerializer: (key: K) => string,
    private isImmutable: (value: V) => boolean,
    options?: { maxMutableSize?: number }
  ) {
    this.maxMutableSize = options?.maxMutableSize ?? 1000
  }

  /**
   * Get a value from cache
   * Returns null if not found or expired
   */
  get(key: K): V | null {
    const keyStr = this.keySerializer(key)

    // Check immutable cache first (always valid, no TTL)
    if (this.immutableCache.has(keyStr)) {
      this.hits++
      return this.immutableCache.get(keyStr)!
    }

    // Check mutable cache with TTL validation
    const cached = this.mutableCache.get(keyStr)
    if (!cached) {
      this.misses++
      return null
    }

    // Check if expired
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.mutableCache.delete(keyStr)
      this.misses++
      return null
    }

    this.hits++
    return cached.data
  }

  /**
   * Set a value in cache with TTL
   * Automatically promotes to immutable cache if isImmutable returns true
   */
  set(key: K, value: V, ttl: number): void {
    const keyStr = this.keySerializer(key)

    // Check if data should be in immutable cache
    if (this.isImmutable(value)) {
      // Promote to immutable cache (permanent storage)
      this.immutableCache.set(keyStr, value)

      // Remove from mutable cache if it was there (promotion)
      if (this.mutableCache.delete(keyStr)) {
        this.promotions++
      }
    } else {
      // Store in mutable cache with TTL

      // Evict oldest entries if cache is full
      if (this.mutableCache.size >= this.maxMutableSize && !this.mutableCache.has(keyStr)) {
        const firstKey = this.mutableCache.keys().next().value
        if (firstKey) {
          this.mutableCache.delete(firstKey)
        }
      }

      this.mutableCache.set(keyStr, {
        data: value,
        timestamp: Date.now(),
        ttl,
      })
    }
  }

  /**
   * Delete a specific key from both caches
   */
  delete(key: K): boolean {
    const keyStr = this.keySerializer(key)
    const deletedImmutable = this.immutableCache.delete(keyStr)
    const deletedMutable = this.mutableCache.delete(keyStr)
    return deletedImmutable || deletedMutable
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.immutableCache.clear()
    this.mutableCache.clear()
    this.hits = 0
    this.misses = 0
    this.promotions = 0
  }

  /**
   * Clear only mutable cache (keep immutable data)
   */
  clearMutable(): void {
    this.mutableCache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalRequests = this.hits + this.misses
    return {
      immutableSize: this.immutableCache.size,
      mutableSize: this.mutableCache.size,
      totalSize: this.immutableCache.size + this.mutableCache.size,
      hits: this.hits,
      misses: this.misses,
      promotions: this.promotions,
      hitRate: totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0,
    }
  }

  /**
   * Get human-readable stats string
   */
  getStatsString(): string {
    const stats = this.getStats()
    return `Cache: ${stats.totalSize} entries (${stats.immutableSize} immutable, ${stats.mutableSize} mutable) | Hit rate: ${stats.hitRate.toFixed(1)}% | Promotions: ${stats.promotions}`
  }
}
