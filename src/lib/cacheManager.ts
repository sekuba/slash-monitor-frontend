/**
 * Centralized cache management utilities
 */

/**
 * Clear all localStorage data
 */
export function clearAllCaches(): void {
    localStorage.clear();
    console.log('All caches cleared');
}

/**
 * Clear only slashing-related caches
 */
export function clearSlashingCaches(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('cache') || key.includes('slashing'))) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log(`Cleared ${keysToRemove.length} slashing cache entries`);
}

/**
 * Clear all caches and reload the page
 */
export function reloadWithCacheClear(): void {
    clearAllCaches();
    console.log('Reloading page...');
    window.location.reload();
}

/**
 * Update RPC URL and reload with cache clear
 */
export function updateRpcUrl(url: string): void {
    localStorage.setItem('customL1RpcUrl', url);
    // Clear specific cache entries related to RPC data
    localStorage.removeItem('l1RoundCache');
    localStorage.removeItem('slashingDetailsCache');
    console.log('RPC URL updated. Reloading page to apply changes...');
    window.location.reload();
}
