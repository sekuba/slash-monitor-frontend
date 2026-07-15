import type { Address } from 'viem';
import type { ResolvedMonitorConfig, RoundStatus, DetectedSlashing, TargetedSequencer } from '@/types/slashing';
import { isRoundProtectedByPause } from './pauseProtection';

export type RoundDisplayStatus = RoundStatus | 'vetoed';
export interface RoundDisplayState {
    status: RoundDisplayStatus;
    isActionable: boolean;
    isExpired: boolean;
    secondsUntilExecutable?: number;
    secondsUntilExpires?: number;
}

export interface RoundPresentation extends RoundDisplayState {
    isProtected: boolean;
}
export function formatAddress(address: Address, chars = 6): string {
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
export function formatEther(wei: bigint, decimals = 4): string {
    const ether = Number(wei) / 1e18;
    return ether.toFixed(decimals);
}
/**
 * Formats time duration in seconds to a human-readable string.
 * @param seconds - Duration in seconds
 * @param options - Optional configuration for formatting
 * @returns Formatted time string
 */
export function formatTimeRemaining(
    seconds: number,
    options?: {
        /** If true, uses approximate notation (~) and omits seconds */
        approximate?: boolean;
        /** Hours threshold for showing days instead of just hours (e.g., 24 for 24-hour day) */
        hoursThresholdForDayDisplay?: number;
        /** String to return when seconds <= 0 */
        zeroLabel?: string;
    }
): string {
    const { approximate = false, hoursThresholdForDayDisplay, zeroLabel = 'Expired' } = options ?? {};

    if (seconds <= 0) {
        return approximate ? 'Now' : zeroLabel;
    }

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const prefix = approximate ? '~' : '';

    // Use hoursThresholdForDayDisplay if provided
    if (hoursThresholdForDayDisplay !== undefined) {
        const totalHours = Math.floor(seconds / 3600);
        if (totalHours > hoursThresholdForDayDisplay) {
            const days = Math.floor(totalHours / hoursThresholdForDayDisplay);
            const remainingHours = totalHours % hoursThresholdForDayDisplay;
            return `${prefix}${days}d ${remainingHours}h`;
        }
        if (totalHours > 0) {
            return `${prefix}${totalHours}h ${minutes}m`;
        }
        return `${prefix}${minutes}m`;
    }

    // Standard formatting
    if (approximate) {
        // Approximate mode: omit seconds for cleaner display
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        }
        else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        else if (minutes > 0) {
            return `${minutes}m`;
        }
        else {
            return `${secs}s`;
        }
    } else {
        // Detailed mode: include seconds
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m ${secs}s`;
        }
        else if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        }
        else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        }
        else {
            return `${secs}s`;
        }
    }
}
export function formatSlotDuration(seconds: number): string {
    return `${seconds}s`;
}

export function formatEpochDuration(seconds: number): string {
    const minutes = seconds / 60;
    const isExact = seconds % 60 === 0;
    const rounded = Math.round(minutes);
    return isExact ? `${rounded}m` : `~${rounded}m`;
}

export function formatRoundDuration(seconds: number): string {
    const hours = seconds / 3600;
    const isExact = seconds % 3600 === 0;
    const formatted = hours.toFixed(1);
    return isExact ? `${formatted}h` : `~${formatted}h`;
}

export function formatNumber(num: number | bigint): string {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function isActionableStatus(status: RoundDisplayStatus): boolean {
    return (status === 'quorum-reached' ||
        status === 'newly-executable' ||
        status === 'executable');
}

export function collectTargetedSequencers(slashings: DetectedSlashing[]): TargetedSequencer[] {
    const targetedSequencers = new Map<string, TargetedSequencer>();

    slashings.forEach((slashing) => {
        const uniqueActions = new Map<string, Address>();
        slashing.slashActions?.forEach((action) => {
            const key = action.validator.toLowerCase();
            uniqueActions.set(key, uniqueActions.get(key) ?? action.validator);
        });

        uniqueActions.forEach((address, key) => {
            const existing = targetedSequencers.get(key);

            if (existing) {
                existing.appearances += 1;
                existing.rounds.push(slashing.round);
                return;
            }

            targetedSequencers.set(key, {
                address,
                appearances: 1,
                rounds: [slashing.round],
            });
        });
    });

    return Array.from(targetedSequencers.values())
        .map((sequencer) => ({
            ...sequencer,
            rounds: [...sequencer.rounds].sort((a, b) => Number(a - b)),
        }))
        .sort((a, b) => {
            if (b.appearances !== a.appearances) {
                return b.appearances - a.appearances;
            }

            return a.address.localeCompare(b.address);
        });
}
export function getAdjustedSecondsRemaining(slashing: DetectedSlashing, baseSeconds: number | undefined, now: number): number | undefined {
    if (baseSeconds === undefined || slashing.lastUpdatedTimestamp === undefined) {
        return baseSeconds;
    }
    const elapsedSeconds = Math.floor((now - slashing.lastUpdatedTimestamp) / 1000);
    const adjustedSeconds = baseSeconds - elapsedSeconds;
    return Math.max(0, adjustedSeconds);
}
// Normalize a round's display state for the UI (executed → expired → vetoed → pause-adjusted → base status)
export function deriveRoundDisplayState(slashing: DetectedSlashing, options?: {
    isProtected?: boolean;
    now?: number;
}): RoundDisplayState {
    const now = options?.now ?? Date.now();
    const secondsUntilExecutable = getAdjustedSecondsRemaining(slashing, slashing.secondsUntilExecutable, now);
    const secondsUntilExpires = getAdjustedSecondsRemaining(slashing, slashing.secondsUntilExpires, now);
    const hasExpired = slashing.status === 'expired' || secondsUntilExpires === 0;
    if (slashing.isExecuted || slashing.status === 'executed') {
        return {
            status: 'executed',
            isActionable: false,
            isExpired: false,
            secondsUntilExecutable,
            secondsUntilExpires,
        };
    }
    if (hasExpired) {
        return {
            status: 'expired',
            isActionable: false,
            isExpired: true,
            secondsUntilExecutable,
            secondsUntilExpires,
        };
    }
    if (slashing.isVetoed) {
        return {
            status: 'vetoed',
            isActionable: false,
            isExpired: false,
            secondsUntilExecutable,
            secondsUntilExpires,
        };
    }
    const isProtected = options?.isProtected ?? false;
    const baseStatus: RoundDisplayStatus = (isProtected && (slashing.status === 'executable' || slashing.status === 'newly-executable'))
        ? 'quorum-reached'
        : slashing.status;
    return {
        status: baseStatus,
        isActionable: isActionableStatus(baseStatus) && !isProtected,
        isExpired: false,
        secondsUntilExecutable,
        secondsUntilExpires,
    };
}

export function deriveRoundPresentation(slashing: DetectedSlashing, options: {
    config: ResolvedMonitorConfig | null;
    isSlashingEnabled: boolean;
    pauseStartedAtSlot: bigint | null;
    pauseEndsAtSlot: bigint | null;
    now?: number;
}): RoundPresentation {
    const hasLiveSlashPayload = (slashing.slashActions?.length ?? 0) > 0 &&
        !slashing.isExecuted &&
        !slashing.isVetoed &&
        slashing.status !== 'expired';
    const isProtected = options.config && hasLiveSlashPayload
        ? isRoundProtectedByPause(
            slashing.round,
            options.config,
            options.isSlashingEnabled,
            options.pauseStartedAtSlot,
            options.pauseEndsAtSlot
        )
        : false;

    return {
        ...deriveRoundDisplayState(slashing, {
            isProtected,
            now: options.now,
        }),
        isProtected,
    };
}
const STATUS_COLORS: Record<RoundDisplayStatus, string> = {
    'below-quorum': 'bg-lapis/50 text-aqua border-5 border-aqua/50 shadow-brutal',
    'quorum-reached': 'bg-malachite text-chartreuse border-5 border-chartreuse shadow-brutal-chartreuse',
    'newly-executable': 'bg-oxblood text-vermillion border-5 border-vermillion shadow-brutal-vermillion',
    'executable': 'bg-oxblood text-vermillion border-5 border-vermillion shadow-brutal-vermillion',
    'executed': 'bg-oxblood/50 text-vermillion border-5 border-vermillion/50 shadow-brutal',
    'expired': 'bg-malachite/30 text-whisper-white/60 border-5 border-brand-black shadow-brutal',
    'vetoed': 'bg-lapis text-aqua border-5 border-aqua shadow-brutal-aqua',
};

export function getStatusColor(status: RoundDisplayStatus): string {
    return STATUS_COLORS[status] ?? STATUS_COLORS['quorum-reached'];
}

const STATUS_TEXT: Record<RoundDisplayStatus, string> = {
    'below-quorum': 'No Target at Quorum',
    'quorum-reached': 'Quorum Reached',
    'newly-executable': 'Newly Executable',
    'executable': 'Executable',
    'executed': 'Executed',
    'expired': 'Expired',
    'vetoed': 'Vetoed',
};

export function getStatusText(status: RoundDisplayStatus): string {
    return STATUS_TEXT[status] ?? 'Pending';
}
