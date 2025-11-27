import { useEffect, useRef, useCallback } from 'react';
import { useSlashingStore } from '@/store/slashingStore';
import { L1Monitor } from '@/lib/l1Monitor';
import { NodeRpcClient } from '@/lib/nodeRpcClient';
import { SlashingDetector } from '@/lib/slashingDetector';
import { notifyQuorumReached, notifyRoundVetoed, notifyGlobalPauseStarted, notifyRoundExecuted, } from '@/lib/notifications';
import type { RoundStatus, SlashingMonitorConfig } from '@/types/slashing';
import { deriveRoundDisplayState } from '@/lib/utils';
import { isRoundProtectedByPause } from '@/lib/pauseProtection';

interface RoundState {
    status: RoundStatus;
    isVetoed: boolean;
}

export function useSlashingMonitor(config: SlashingMonitorConfig) {
    const { setConfig, setInitialized, setIsScanning, setCurrentRound, setCurrentSlot, setCurrentEpoch, setSlashingEnabled, setSlashingDisabledUntil, setSlashingDisableDuration, setActiveAttesterCount, setEntryQueueLength, addDetectedSlashing, setOffenses, updateStats, } = useSlashingStore();
    const l1MonitorRef = useRef<L1Monitor | null>(null);
    const nodeRpcRef = useRef<NodeRpcClient | null>(null);
    const detectorRef = useRef<SlashingDetector | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const previousRoundStatesRef = useRef<Map<string, RoundState>>(new Map());
    const previousSlashingEnabledRef = useRef<boolean | null>(null);
    const isFirstScanRef = useRef<boolean>(true);
    const initialize = useCallback(async () => {
        console.log('Initializing slashing monitor...');
        try {
            l1MonitorRef.current = new L1Monitor(config);
            nodeRpcRef.current = new NodeRpcClient(config.nodeAdminUrl);
            const contractParams = await l1MonitorRef.current.loadContractParameters();
            const fullConfig = { ...config, ...contractParams };
            detectorRef.current = new SlashingDetector(fullConfig, l1MonitorRef.current);
            setConfig(fullConfig);
            const currentRound = await l1MonitorRef.current.getCurrentRound();
            const currentSlot = await l1MonitorRef.current.getCurrentSlot();
            const currentEpoch = await l1MonitorRef.current.getCurrentEpoch();
            const isEnabled = await l1MonitorRef.current.isSlashingEnabled();
            setCurrentRound(currentRound);
            setCurrentSlot(currentSlot);
            setCurrentEpoch(currentEpoch);
            setSlashingEnabled(isEnabled);
            console.log('Slashing monitor initialized', {
                currentRound: currentRound.toString(),
                currentSlot: currentSlot.toString(),
                currentEpoch: currentEpoch.toString(),
                isEnabled,
            });
            previousSlashingEnabledRef.current = isEnabled;
            setInitialized(true);
        }
        catch (error) {
            console.error('Failed to initialize slashing monitor:', error);
            throw error;
        }
    }, [config, setConfig, setInitialized, setCurrentRound, setCurrentSlot, setCurrentEpoch, setSlashingEnabled]);
    const poll = useCallback(async () => {
        if (!l1MonitorRef.current || !detectorRef.current || !nodeRpcRef.current)
            return;
        try {
            if (isFirstScanRef.current) {
                setIsScanning(true);
            }
            const { currentRound, currentSlot, currentEpoch, isSlashingEnabled: isEnabled, slashingDisabledUntil, slashingDisableDuration, activeAttesterCount, entryQueueLength } = await l1MonitorRef.current.getCurrentState();
            setCurrentRound(currentRound);
            setCurrentSlot(currentSlot);
            setCurrentEpoch(currentEpoch);
            setSlashingEnabled(isEnabled);
            setSlashingDisabledUntil(slashingDisabledUntil);
            setSlashingDisableDuration(slashingDisableDuration);
            setActiveAttesterCount(activeAttesterCount);
            setEntryQueueLength(entryQueueLength);
            // Detect global pause state changes
            if (previousSlashingEnabledRef.current !== null &&
                previousSlashingEnabledRef.current !== isEnabled &&
                !isEnabled) {
                notifyGlobalPauseStarted();
            }

            // Update previous values for transition detection
            previousSlashingEnabledRef.current = isEnabled;
            const detectedSlashings = await detectorRef.current.detectExecutableRounds(currentRound, currentSlot);

            detectedSlashings.forEach((slashing) => {
                const roundKey = slashing.round.toString();
                const previousState = previousRoundStatesRef.current.get(roundKey);
                const hasQuorumStatus = slashing.status === 'quorum-reached' ||
                    slashing.status === 'in-veto-window' ||
                    slashing.status === 'executable';
                const hadQuorumStatus = previousState
                    ? previousState.status === 'quorum-reached' ||
                        previousState.status === 'in-veto-window' ||
                        previousState.status === 'executable'
                    : false;
                const wasVetoed = previousState?.isVetoed ?? false;

                // Skip notifications on first scan to avoid spam
                if (!isFirstScanRef.current && slashing.slashActions && slashing.slashActions.length > 0) {
                    // Detect round vetoed (transition from not vetoed to vetoed)
                    if (slashing.isVetoed && !wasVetoed) {
                        notifyRoundVetoed(slashing);
                    }

                    // Detect round executed
                    if (slashing.isExecuted && (!previousState || previousState.status !== 'executed')) {
                        notifyRoundExecuted(slashing);
                    }

                    // Detect quorum reached (only if not vetoed and not globally paused)
                    if (hasQuorumStatus && !hadQuorumStatus && !slashing.isVetoed && !slashing.isExecuted && isEnabled) {
                        notifyQuorumReached(slashing);
                    }
                }

                // Update the state tracking
                previousRoundStatesRef.current.set(roundKey, {
                    status: slashing.status,
                    isVetoed: slashing.isVetoed,
                });
                addDetectedSlashing(slashing);
            });
            const offenses = await nodeRpcRef.current.getSlashOffenses('all');
            setOffenses(offenses);
            // Active slashings: actionable rounds excluding current round (still being voted on)
            const storeConfig = useSlashingStore.getState().config;
            const activeSlashings = detectedSlashings.filter((s) => {
                const isProtected = storeConfig
                    ? isRoundProtectedByPause(s.round, storeConfig, currentSlot, isEnabled, slashingDisabledUntil, slashingDisableDuration)
                    : false;
                const displayState = deriveRoundDisplayState(s, { isProtected });
                return displayState.isActionable && s.round !== currentRound;
            }).length;
            const vetoedPayloads = detectedSlashings.filter((s) => s.isVetoed).length;
            const executedRounds = detectedSlashings.filter((s) => s.isExecuted).length;
            // Only count validators and slash amounts for executed rounds
            const totalValidatorsSlashed = detectedSlashings
                .filter((s) => s.isExecuted)
                .reduce((sum, s) => sum + (s.affectedValidatorCount ?? 0), 0);
            const totalSlashAmount = detectedSlashings
                .filter((s) => s.isExecuted)
                .reduce((sum, s) => sum + (s.totalSlashAmount ?? 0n), 0n);
            updateStats({
                currentRound,
                totalRoundsMonitored: detectedSlashings.length,
                activeSlashings,
                vetoedPayloads,
                executedRounds,
                totalValidatorsSlashed,
                totalSlashAmount,
            });
            if (isFirstScanRef.current) {
                console.log(`Initial scan complete: ${detectedSlashings.length} rounds detected`);
                isFirstScanRef.current = false;
                setIsScanning(false);
            }
            if (Math.random() < config.consoleLogProbability) {
                console.log(`Poll complete: ${detectedSlashings.length} rounds, ${offenses.length} offenses`);
                if (l1MonitorRef.current && detectorRef.current) {
                    l1MonitorRef.current.logCacheStats();
                    detectorRef.current.logCacheStats();
                }
            }
        }
        catch (error) {
            console.error('Poll error:', error);
            if (isFirstScanRef.current) {
                isFirstScanRef.current = false;
                setIsScanning(false);
            }
        }
    }, [setCurrentRound, setCurrentSlot, setCurrentEpoch, setSlashingEnabled, setSlashingDisabledUntil, setSlashingDisableDuration, setActiveAttesterCount, setEntryQueueLength, setIsScanning, addDetectedSlashing, setOffenses, updateStats]);
    const startPolling = useCallback(() => {
        poll();
        intervalRef.current = setInterval(poll, config.l2PollInterval);
        console.log(`Polling started with interval ${config.l2PollInterval}ms`);
    }, [poll, config.l2PollInterval]);
    const cleanup = useCallback(() => {
        console.log('Cleaning up slashing monitor...');
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);
    useEffect(() => {
        let isMounted = true;

        const initAndPoll = async () => {
            if (isMounted) {
                await initialize();
                if (isMounted) {
                    startPolling();
                }
            }
        };

        initAndPoll();

        return () => {
            isMounted = false;
            cleanup();
        };
    }, [initialize, startPolling, cleanup]);
}
