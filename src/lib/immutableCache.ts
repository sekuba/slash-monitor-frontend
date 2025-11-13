export class ImmutableAwareCache<K, V> {
    private immutableCache = new Map<string, V>();
    private mutableCache = new Map<string, {
        data: V;
        timestamp: number;
        ttl: number;
    }>();
    private maxMutableSize: number;
    private hits = 0;
    private misses = 0;
    private promotions = 0;
    constructor(private keySerializer: (key: K) => string, private isImmutable: (value: V) => boolean, options?: {
        maxMutableSize?: number;
    }) {
        this.maxMutableSize = options?.maxMutableSize ?? 1000;
    }
    get(key: K): V | null {
        const keyStr = this.keySerializer(key);
        if (this.immutableCache.has(keyStr)) {
            this.hits++;
            return this.immutableCache.get(keyStr)!;
        }
        const cached = this.mutableCache.get(keyStr);
        if (!cached) {
            this.misses++;
            return null;
        }
        if (Date.now() - cached.timestamp > cached.ttl) {
            this.mutableCache.delete(keyStr);
            this.misses++;
            return null;
        }
        this.hits++;
        return cached.data;
    }
    set(key: K, value: V, ttl: number): void {
        const keyStr = this.keySerializer(key);
        if (this.isImmutable(value)) {
            this.immutableCache.set(keyStr, value);
            if (this.mutableCache.delete(keyStr)) {
                this.promotions++;
            }
        }
        else {
            if (this.mutableCache.size >= this.maxMutableSize && !this.mutableCache.has(keyStr)) {
                const firstKey = this.mutableCache.keys().next().value;
                if (firstKey) {
                    this.mutableCache.delete(firstKey);
                }
            }
            this.mutableCache.set(keyStr, {
                data: value,
                timestamp: Date.now(),
                ttl,
            });
        }
    }
    delete(key: K): boolean {
        const keyStr = this.keySerializer(key);
        const deletedImmutable = this.immutableCache.delete(keyStr);
        const deletedMutable = this.mutableCache.delete(keyStr);
        return deletedImmutable || deletedMutable;
    }
    clear(): void {
        this.immutableCache.clear();
        this.mutableCache.clear();
        this.hits = 0;
        this.misses = 0;
        this.promotions = 0;
    }
    clearMutable(): void {
        this.mutableCache.clear();
    }
    getStats() {
        const totalRequests = this.hits + this.misses;
        return {
            immutableSize: this.immutableCache.size,
            mutableSize: this.mutableCache.size,
            totalSize: this.immutableCache.size + this.mutableCache.size,
            hits: this.hits,
            misses: this.misses,
            promotions: this.promotions,
            hitRate: totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0,
        };
    }
    getStatsString(): string {
        const stats = this.getStats();
        return `Cache: ${stats.totalSize} entries (${stats.immutableSize} immutable, ${stats.mutableSize} mutable) | Hit rate: ${stats.hitRate.toFixed(1)}% | Promotions: ${stats.promotions}`;
    }
}
