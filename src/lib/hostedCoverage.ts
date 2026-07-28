import type { SlashDatasetCoverage } from '@/types/api';

export function formatHostedSlashCoverage(coverage: SlashDatasetCoverage): string {
    if (!coverage.observedAt || !coverage.blockNumber) {
        return 'The hosted confirmed-loss scanner has not completed its first successful block range.';
    }

    const observed = new Date(coverage.observedAt).toLocaleString();
    const range = coverage.fromBlock
        ? `across L1 blocks ${coverage.fromBlock}–${coverage.blockNumber}`
        : `through L1 block ${coverage.blockNumber}`;
    if (coverage.complete) {
        return `Canonical Rollup logs checked ${range}. Scanner caught up ${observed}.`;
    }

    const target = coverage.confirmedBlockNumber
        ? ` of confirmed head ${coverage.confirmedBlockNumber}`
        : '';
    return `Hosted log catch-up is incomplete: checked ${range}${target}. Last successful chunk ${observed}.`;
}
