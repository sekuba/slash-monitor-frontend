import { create } from 'zustand';
import type {
    ConfirmedExecution,
    ConfirmedSlash,
    CurrentChainState,
    DetectedSlashing,
    ExecutionHistoryScan,
    MonitorAudit,
    MonitorSnapshot,
    ResolvedMonitorConfig,
} from '@/types/slashing';

interface SlashingMonitorStore extends CurrentChainState {
    config: ResolvedMonitorConfig | null;
    isInitialized: boolean;
    initializationError: string | null;
    isScanning: boolean;
    detectedSlashings: Map<bigint, DetectedSlashing>;
    confirmedExecutions: ConfirmedExecution[];
    confirmedSlashes: ConfirmedSlash[];
    executionScan: ExecutionHistoryScan;
    audit: MonitorAudit;
    initialize: (config: ResolvedMonitorConfig, state: CurrentChainState) => void;
    setIsScanning: (scanning: boolean) => void;
    applySnapshot: (snapshot: MonitorSnapshot) => void;
    setInitializationError: (message: string | null) => void;
    setMonitorFailure: (message: string, fatal?: boolean) => void;
    resetMonitor: () => void;
}

const initialAudit: MonitorAudit = {
    status: 'ok',
    issues: [],
    updatedAt: null,
    lastSuccessfulAt: null,
};

const initialExecutionScan: ExecutionHistoryScan = {
    status: 'idle',
    targetFromBlock: null,
    headBlock: null,
    oldestScannedBlock: null,
    scannedBlocks: 0n,
    totalBlocks: 0n,
    chunkSize: 1_024n,
    lastError: null,
};

const initialChainState: CurrentChainState = {
    l1BlockNumber: 0n,
    l1BlockHash: `0x${'00'.repeat(32)}`,
    l1Timestamp: 0n,
    currentRound: 0n,
    currentSlot: 0n,
    currentEpoch: 0n,
    isSlashingEnabled: true,
    slashingDisabledUntil: 0n,
    slashingDisableDuration: 0n,
    pauseStartedAtSlot: null,
    pauseEndsAtSlot: null,
};

export const useSlashingStore = create<SlashingMonitorStore>((set) => ({
    ...initialChainState,
    config: null,
    isInitialized: false,
    initializationError: null,
    isScanning: false,
    detectedSlashings: new Map(),
    confirmedExecutions: [],
    confirmedSlashes: [],
    executionScan: initialExecutionScan,
    audit: initialAudit,
    initialize: (config, state) => set({
        config,
        isInitialized: true,
        initializationError: null,
        detectedSlashings: new Map(),
        confirmedExecutions: [],
        confirmedSlashes: [],
        executionScan: initialExecutionScan,
        ...state,
    }),
    setIsScanning: (isScanning) => set({ isScanning }),
    applySnapshot: (snapshot) => set({
        ...snapshot,
    }),
    setInitializationError: (initializationError) => set({ initializationError }),
    setMonitorFailure: (message, fatal = false) => set((state) => ({
        audit: {
            status: fatal ? 'fatal' : 'stale',
            issues: [{
                source: 'l1-rpc',
                scope: 'chain-state',
                severity: 'error',
                message,
            }],
            updatedAt: Date.now(),
            lastSuccessfulAt: state.audit.lastSuccessfulAt,
        },
    })),
    resetMonitor: () => set({
        ...initialChainState,
        config: null,
        isInitialized: false,
        initializationError: null,
        isScanning: false,
        detectedSlashings: new Map(),
        confirmedExecutions: [],
        confirmedSlashes: [],
        executionScan: initialExecutionScan,
        audit: initialAudit,
    }),
}));
