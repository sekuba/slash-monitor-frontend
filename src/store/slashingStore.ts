import { create } from 'zustand';
import type { SlashingMonitorConfig, DetectedSlashing, Offense, SlashingStats, } from '@/types/slashing';
interface SlashingMonitorStore {
    config: SlashingMonitorConfig | null;
    isInitialized: boolean;
    isScanning: boolean;
    currentRound: bigint | null;
    currentSlot: bigint | null;
    currentEpoch: bigint | null;
    isSlashingEnabled: boolean;
    slashingDisabledUntil: bigint | null;
    slashingDisableDuration: bigint | null;
    activeAttesterCount: bigint | null;
    entryQueueLength: bigint | null;
    detectedSlashings: Map<bigint, DetectedSlashing>;
    offenses: Offense[];
    stats: SlashingStats;
    setConfig: (config: SlashingMonitorConfig) => void;
    setInitialized: (initialized: boolean) => void;
    setIsScanning: (scanning: boolean) => void;
    setCurrentRound: (round: bigint) => void;
    setCurrentSlot: (slot: bigint) => void;
    setCurrentEpoch: (epoch: bigint) => void;
    setSlashingEnabled: (enabled: boolean) => void;
    setSlashingDisabledUntil: (timestamp: bigint) => void;
    setSlashingDisableDuration: (duration: bigint) => void;
    setActiveAttesterCount: (count: bigint) => void;
    setEntryQueueLength: (length: bigint) => void;
    addDetectedSlashing: (slashing: DetectedSlashing) => void;
    setOffenses: (offenses: Offense[]) => void;
    updateStats: (stats: Partial<SlashingStats>) => void;
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
export const useSlashingStore = create<SlashingMonitorStore>((set) => ({
    config: null,
    isInitialized: false,
    isScanning: false,
    currentRound: null,
    currentSlot: null,
    currentEpoch: null,
    isSlashingEnabled: true,
    slashingDisabledUntil: null,
    slashingDisableDuration: null,
    activeAttesterCount: null,
    entryQueueLength: null,
    detectedSlashings: new Map(),
    offenses: [],
    stats: initialStats,
    setConfig: (config) => set({ config }),
    setInitialized: (initialized) => set({ isInitialized: initialized }),
    setIsScanning: (scanning) => set({ isScanning: scanning }),
    setCurrentRound: (round) => set({ currentRound: round }),
    setCurrentSlot: (slot) => set({ currentSlot: slot }),
    setCurrentEpoch: (epoch) => set({ currentEpoch: epoch }),
    setSlashingEnabled: (enabled) => set({ isSlashingEnabled: enabled }),
    setSlashingDisabledUntil: (timestamp) => set({ slashingDisabledUntil: timestamp }),
    setSlashingDisableDuration: (duration) => set({ slashingDisableDuration: duration }),
    setActiveAttesterCount: (count) => set({ activeAttesterCount: count }),
    setEntryQueueLength: (length) => set({ entryQueueLength: length }),
    addDetectedSlashing: (slashing) => set((state) => {
        const newMap = new Map(state.detectedSlashings);
        newMap.set(slashing.round, slashing);
        return { detectedSlashings: newMap };
    }),
    setOffenses: (offenses) => set({ offenses }),
    updateStats: (stats) => set((state) => ({
        stats: { ...state.stats, ...stats },
    })),
}));
