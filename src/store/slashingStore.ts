import { create } from 'zustand'
import type {
  SlashingMonitorConfig,
  DetectedSlashing,
  VoteCastEvent,
  RoundExecutedEvent,
  Offense,
  SlashingStats,
} from '@/types/slashing'

interface SlashingMonitorStore {
  // Configuration
  config: SlashingMonitorConfig | null
  isInitialized: boolean
  isScanning: boolean

  // Current state
  currentRound: bigint | null
  currentSlot: bigint | null
  currentEpoch: bigint | null
  isSlashingEnabled: boolean

  // Detected slashings
  detectedSlashings: Map<bigint, DetectedSlashing>

  // Events
  recentVoteCastEvents: VoteCastEvent[]
  recentRoundExecutedEvents: RoundExecutedEvent[]

  // Offenses from node
  offenses: Offense[]

  // Statistics
  stats: SlashingStats

  // Actions
  setConfig: (config: SlashingMonitorConfig) => void
  setInitialized: (initialized: boolean) => void
  setIsScanning: (scanning: boolean) => void
  setCurrentRound: (round: bigint) => void
  setCurrentSlot: (slot: bigint) => void
  setCurrentEpoch: (epoch: bigint) => void
  setSlashingEnabled: (enabled: boolean) => void
  addDetectedSlashing: (slashing: DetectedSlashing) => void
  updateDetectedSlashing: (round: bigint, updates: Partial<DetectedSlashing>) => void
  removeDetectedSlashing: (round: bigint) => void
  addVoteCastEvent: (event: VoteCastEvent) => void
  addRoundExecutedEvent: (event: RoundExecutedEvent) => void
  setOffenses: (offenses: Offense[]) => void
  updateStats: (stats: Partial<SlashingStats>) => void
  reset: () => void
}

const initialStats: SlashingStats = {
  currentRound: 0n,
  totalRoundsMonitored: 0,
  activeSlashings: 0,
  vetoedPayloads: 0,
  executedRounds: 0,
  totalValidatorsSlashed: 0,
  totalSlashAmount: 0n,
}

export const useSlashingStore = create<SlashingMonitorStore>((set, get) => ({
  // Initial state
  config: null,
  isInitialized: false,
  isScanning: false,
  currentRound: null,
  currentSlot: null,
  currentEpoch: null,
  isSlashingEnabled: true,
  detectedSlashings: new Map(),
  recentVoteCastEvents: [],
  recentRoundExecutedEvents: [],
  offenses: [],
  stats: initialStats,

  // Actions
  setConfig: (config) => set({ config }),

  setInitialized: (initialized) => set({ isInitialized: initialized }),

  setIsScanning: (scanning) => set({ isScanning: scanning }),

  setCurrentRound: (round) => set({ currentRound: round }),

  setCurrentSlot: (slot) => set({ currentSlot: slot }),

  setCurrentEpoch: (epoch) => set({ currentEpoch: epoch }),

  setSlashingEnabled: (enabled) => set({ isSlashingEnabled: enabled }),

  addDetectedSlashing: (slashing) =>
    set((state) => {
      const newMap = new Map(state.detectedSlashings)
      newMap.set(slashing.round, slashing)
      return { detectedSlashings: newMap }
    }),

  updateDetectedSlashing: (round, updates) =>
    set((state) => {
      const existing = state.detectedSlashings.get(round)
      if (!existing) return state

      const newMap = new Map(state.detectedSlashings)
      newMap.set(round, { ...existing, ...updates })
      return { detectedSlashings: newMap }
    }),

  removeDetectedSlashing: (round) =>
    set((state) => {
      const newMap = new Map(state.detectedSlashings)
      newMap.delete(round)
      return { detectedSlashings: newMap }
    }),

  addVoteCastEvent: (event) =>
    set((state) => {
      // Keep only last 100 events
      const events = [event, ...state.recentVoteCastEvents].slice(0, 100)
      return { recentVoteCastEvents: events }
    }),

  addRoundExecutedEvent: (event) =>
    set((state) => {
      // Keep only last 50 events
      const events = [event, ...state.recentRoundExecutedEvents].slice(0, 50)
      return { recentRoundExecutedEvents: events }
    }),

  setOffenses: (offenses) => set({ offenses }),

  updateStats: (stats) =>
    set((state) => ({
      stats: { ...state.stats, ...stats },
    })),

  reset: () =>
    set({
      config: null,
      isInitialized: false,
      currentRound: null,
      currentSlot: null,
      currentEpoch: null,
      isSlashingEnabled: true,
      detectedSlashings: new Map(),
      recentVoteCastEvents: [],
      recentRoundExecutedEvents: [],
      offenses: [],
      stats: initialStats,
    }),
}))
