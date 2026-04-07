import { useCallback, useEffect, useRef } from 'react';
import { L1Monitor } from '@/lib/l1Monitor';
import { notifyGlobalPauseStarted, notifyQuorumReached, notifyRoundExecuted, notifyRoundVetoed } from '@/lib/notifications';
import { SlashingDetector } from '@/lib/slashingDetector';
import { deriveRoundPresentation } from '@/lib/utils';
import { useSlashingStore } from '@/store/slashingStore';
import type { CurrentChainState, DetectedSlashing, MonitorAudit, MonitorConfigInput, MonitorIssue, MonitorSnapshot, RoundStatus, SlashingStats } from '@/types/slashing';

interface RoundState {
    status: RoundStatus;
    isVetoed: boolean;
}

export function useSlashingMonitor(config: MonitorConfigInput) {
    const { initialize, setIsScanning, applySnapshot } = useSlashingStore();
    const l1MonitorRef = useRef<L1Monitor | null>(null);
    const detectorRef = useRef<SlashingDetector | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const previousRoundStatesRef = useRef<Map<string, RoundState>>(new Map());
    const previousSlashingEnabledRef = useRef<boolean | null>(null);
    const isFirstScanRef = useRef(true);
    const isPollingRef = useRef(false);
    const isActiveRef = useRef(true);

    const initializeMonitor = useCallback(async () => {
        const l1Monitor = new L1Monitor(config);
        const contractParameters = await l1Monitor.loadContractParameters();
        const fullConfig = { ...config, ...contractParameters };
        const currentState = await l1Monitor.getCurrentState();

        l1MonitorRef.current = l1Monitor;
        detectorRef.current = new SlashingDetector(fullConfig, l1Monitor);
        previousSlashingEnabledRef.current = currentState.isSlashingEnabled;
        initialize(fullConfig, currentState);
        return currentState;
    }, [config, initialize]);

    const poll = useCallback(async (seedState?: CurrentChainState) => {
        if (isPollingRef.current || !l1MonitorRef.current || !detectorRef.current) {
            return;
        }

        isPollingRef.current = true;

        try {
            if (isFirstScanRef.current) {
                setIsScanning(true);
            }

            const currentState = seedState ?? await l1MonitorRef.current.getCurrentState();
            const previousStoreState = useSlashingStore.getState();
            let detectedSlashings = Array.from(previousStoreState.detectedSlashings.values());
            let issues: MonitorIssue[] = [];

            try {
                const detectionResult = await detectorRef.current.detectExecutableRounds(currentState.currentRound, currentState.currentSlot);
                detectedSlashings = detectionResult.detectedSlashings;
                issues = detectionResult.issues;
            }
            catch (error) {
                issues = [{
                    source: 'l1-rpc',
                    scope: 'rounds',
                    message: error instanceof Error ? error.message : 'Unknown detection error',
                }];
            }

            const audit = buildAudit(issues);
            emitNotificationsForPoll(detectedSlashings, currentState.isSlashingEnabled, previousRoundStatesRef.current, isFirstScanRef.current);

            if (previousSlashingEnabledRef.current !== null &&
                previousSlashingEnabledRef.current !== currentState.isSlashingEnabled &&
                !currentState.isSlashingEnabled) {
                notifyGlobalPauseStarted();
            }

            previousSlashingEnabledRef.current = currentState.isSlashingEnabled;

            const snapshot = buildSnapshot(currentState, detectedSlashings, audit);
            applySnapshot(snapshot);

            if (Math.random() < config.consoleLogProbability) {
                console.log(`Poll complete: ${detectedSlashings.length} rounds, audit=${audit.status}`);
                l1MonitorRef.current.logCacheStats();
                detectorRef.current.logCacheStats();
            }
        }
        catch (error) {
            console.error('Poll error:', error);
        }
        finally {
            if (isFirstScanRef.current) {
                isFirstScanRef.current = false;
                setIsScanning(false);
            }

            isPollingRef.current = false;
        }
    }, [applySnapshot, config.consoleLogProbability, setIsScanning]);

    const scheduleNextPoll = useCallback(() => {
        if (!isActiveRef.current) {
            return;
        }

        timeoutRef.current = setTimeout(async () => {
            if (!isActiveRef.current) {
                return;
            }

            await poll();
            if (isActiveRef.current) {
                scheduleNextPoll();
            }
        }, config.l2PollInterval);
    }, [config.l2PollInterval, poll]);

    useEffect(() => {
        let cancelled = false;
        isActiveRef.current = true;

        const start = async () => {
            try {
                const initialState = await initializeMonitor();
                if (cancelled) {
                    return;
                }

                await poll(initialState);
                if (!cancelled) {
                    scheduleNextPoll();
                }
            }
            catch (error) {
                console.error('Failed to initialize slashing monitor:', error);
                setIsScanning(false);
            }
        };

        start();

        return () => {
            cancelled = true;
            isActiveRef.current = false;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [initializeMonitor, poll, scheduleNextPoll, setIsScanning]);
}

function buildSnapshot(
    currentState: CurrentChainState,
    detectedSlashings: DetectedSlashing[],
    audit: MonitorAudit
): MonitorSnapshot {
    return {
        ...currentState,
        detectedSlashings: new Map(detectedSlashings.map((slashing) => [slashing.round, slashing])),
        stats: buildStats(currentState, detectedSlashings),
        audit,
    };
}

function buildStats(currentState: CurrentChainState, detectedSlashings: DetectedSlashing[]): SlashingStats {
    const storeState = useSlashingStore.getState();
    const activeSlashings = detectedSlashings.filter((slashing) => {
        const presentation = deriveRoundPresentation(slashing, {
            config: storeState.config,
            currentSlot: currentState.currentSlot,
            isSlashingEnabled: currentState.isSlashingEnabled,
            slashingDisabledUntil: currentState.slashingDisabledUntil,
            slashingDisableDuration: currentState.slashingDisableDuration,
        });

        return presentation.isActionable && slashing.round !== currentState.currentRound;
    }).length;

    return {
        currentRound: currentState.currentRound,
        totalRoundsMonitored: detectedSlashings.length,
        activeSlashings,
        vetoedPayloads: detectedSlashings.filter((slashing) => slashing.isVetoed).length,
        executedRounds: detectedSlashings.filter((slashing) => slashing.isExecuted).length,
        totalValidatorsSlashed: detectedSlashings
            .filter((slashing) => slashing.isExecuted)
            .reduce((sum, slashing) => sum + (slashing.affectedValidatorCount ?? 0), 0),
        totalSlashAmount: detectedSlashings
            .filter((slashing) => slashing.isExecuted)
            .reduce((sum, slashing) => sum + (slashing.totalSlashAmount ?? 0n), 0n),
    };
}

function buildAudit(issues: MonitorIssue[]): MonitorAudit {
    return {
        status: issues.length === 0 ? 'ok' : 'partial',
        issues,
        updatedAt: Date.now(),
    };
}

function emitNotificationsForPoll(
    detectedSlashings: DetectedSlashing[],
    isSlashingEnabled: boolean,
    previousRoundStates: Map<string, RoundState>,
    isFirstScan: boolean
) {
    for (const slashing of detectedSlashings) {
        if (slashing.verificationStatus !== 'verified' || !slashing.slashActions || slashing.slashActions.length === 0) {
            continue;
        }

        const roundKey = slashing.round.toString();
        const previousState = previousRoundStates.get(roundKey);
        const hasQuorumStatus = isQuorumStatus(slashing.status);
        const hadQuorumStatus = previousState ? isQuorumStatus(previousState.status) : false;
        const wasVetoed = previousState?.isVetoed ?? false;

        if (!isFirstScan) {
            if (slashing.isVetoed && !wasVetoed) {
                notifyRoundVetoed(slashing);
            }

            if (slashing.isExecuted && (!previousState || previousState.status !== 'executed')) {
                notifyRoundExecuted(slashing);
            }

            if (hasQuorumStatus && !hadQuorumStatus && !slashing.isVetoed && !slashing.isExecuted && isSlashingEnabled) {
                notifyQuorumReached(slashing);
            }
        }

        previousRoundStates.set(roundKey, {
            status: slashing.status,
            isVetoed: slashing.isVetoed,
        });
    }
}

function isQuorumStatus(status: RoundStatus) {
    return status === 'quorum-reached' || status === 'in-veto-window' || status === 'executable';
}
