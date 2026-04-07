import { create } from 'zustand';
import type { CurrentChainState, DetectedSlashing, MonitorAudit, MonitorSnapshot, ResolvedMonitorConfig, SlashingStats } from '@/types/slashing';
import { updateRpcUrl as updateRpcUrlUtil } from '@/lib/cacheManager';

interface SlashingMonitorStore extends CurrentChainState {
    config: ResolvedMonitorConfig | null;
    isInitialized: boolean;
    isScanning: boolean;
    detectedSlashings: Map<bigint, DetectedSlashing>;
    stats: SlashingStats;
    audit: MonitorAudit;
    initialize: (config: ResolvedMonitorConfig, state: CurrentChainState) => void;
    setIsScanning: (scanning: boolean) => void;
    applySnapshot: (snapshot: MonitorSnapshot) => void;
    updateRpcUrl: (url: string) => void;
}

const initialStats: SlashingStats = {
    currentRound: 0n,
    totalRoundsMonitored: 0,
    activeSlashings: 0,
    vetoedPayloads: 0,
    executedRounds: 0,
    totalValidatorsSlashed: 0,
    totalSlashAmount: 0n,
};

const initialAudit: MonitorAudit = {
    status: 'ok',
    issues: [],
    updatedAt: null,
};

const initialChainState: CurrentChainState = {
    currentRound: 0n,
    currentSlot: 0n,
    currentEpoch: 0n,
    isSlashingEnabled: true,
    slashingDisabledUntil: 0n,
    slashingDisableDuration: 0n,
    activeAttesterCount: 0n,
    entryQueueLength: 0n,
};

export const useSlashingStore = create<SlashingMonitorStore>((set) => ({
    ...initialChainState,
    config: null,
    isInitialized: false,
    isScanning: false,
    detectedSlashings: new Map(),
    stats: initialStats,
    audit: initialAudit,
    initialize: (config, state) => set({
        config,
        isInitialized: true,
        ...state,
    }),
    setIsScanning: (isScanning) => set({ isScanning }),
    applySnapshot: (snapshot) => set({
        ...snapshot,
    }),
    updateRpcUrl: updateRpcUrlUtil,
}));
