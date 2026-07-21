import { useCallback, useEffect, useRef } from 'react';
import { zeroAddress } from 'viem';
import { resolveDeployment } from '@/lib/deployment';
import { L1Monitor } from '@/lib/l1Monitor';
import { SlashingDetector } from '@/lib/slashingDetector';
import { deriveRoundPresentation } from '@/lib/utils';
import { useSlashingStore } from '@/store/slashingStore';
import type { CurrentChainState, DetectedSlashing, MonitorAudit, MonitorConfigInput, MonitorIssue, MonitorSnapshot, SlashingStats } from '@/types/slashing';

class StaleMonitorRunError extends Error {}

export function useSlashingMonitor(config: MonitorConfigInput) {
    const {
        initialize,
        setIsScanning,
        applySnapshot,
        setInitializationError,
        setMonitorFailure,
    } = useSlashingStore();
    const l1MonitorRef = useRef<L1Monitor | null>(null);
    const detectorRef = useRef<SlashingDetector | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFirstScanRef = useRef(true);
    const isPollingRef = useRef(false);
    const isActiveRef = useRef(true);
    const runGenerationRef = useRef(0);

    const initializeMonitor = useCallback(async (generation: number) => {
        const deployment = await resolveDeployment(config);
        const runtimeConfig = { ...config, ...deployment };
        const l1Monitor = new L1Monitor(runtimeConfig);
        const contractParameters = await l1Monitor.loadContractParameters();
        const fullConfig = { ...runtimeConfig, ...contractParameters };
        const currentState = await l1Monitor.getCurrentState();
        assertCurrentRun(generation, runGenerationRef.current);

        l1MonitorRef.current = l1Monitor;
        detectorRef.current = new SlashingDetector(fullConfig, l1Monitor);
        initialize(fullConfig, currentState);
        setInitializationError(null);
        return currentState;
    }, [config, initialize, setInitializationError]);

    const poll = useCallback(async (seedState?: CurrentChainState, generation = runGenerationRef.current) => {
        if (generation !== runGenerationRef.current || isPollingRef.current || !l1MonitorRef.current || !detectorRef.current) {
            return;
        }

        isPollingRef.current = true;
        let completed = false;

        try {
            const preflightIssues: MonitorIssue[] = [];

            if (isFirstScanRef.current) {
                setIsScanning(true);
            }

            let currentState = seedState;
            if (!currentState) {
                try {
                    if (await l1MonitorRef.current.hasDeploymentChanged()) {
                        assertCurrentRun(generation, runGenerationRef.current);
                        isFirstScanRef.current = true;
                        setIsScanning(true);
                        currentState = await initializeMonitor(generation);
                    }
                }
                catch (error) {
                    if (error instanceof StaleMonitorRunError) {
                        throw error;
                    }
                    preflightIssues.push({
                        source: 'deployment',
                        scope: 'deployment',
                        severity: 'error',
                        message: `Unable to verify the canonical Aztec deployment: ${toErrorMessage(error)}`,
                    });
                }
            }

            currentState ??= await l1MonitorRef.current.getCurrentState();
            assertCurrentRun(generation, runGenerationRef.current);
            const previousStoreState = useSlashingStore.getState();
            let detectedSlashings = Array.from(previousStoreState.detectedSlashings.values());
            const issues: MonitorIssue[] = [
                ...preflightIssues,
                ...buildDeploymentIssues(previousStoreState.config, currentState.l1Timestamp),
            ];

            try {
                const detectionResult = await detectorRef.current.detectExecutableRounds(currentState.currentRound, currentState.currentSlot);
                detectedSlashings = detectionResult.detectedSlashings;
                issues.push(...detectionResult.issues);
            }
            catch (error) {
                if (error instanceof StaleMonitorRunError) {
                    throw error;
                }
                issues.push({
                    source: 'l1-rpc',
                    scope: 'rounds',
                    severity: 'error',
                    message: toErrorMessage(error),
                });
            }

            const audit = buildAudit(issues, previousStoreState.audit.lastSuccessfulAt);
            assertCurrentRun(generation, runGenerationRef.current);

            const snapshot = buildSnapshot(currentState, detectedSlashings, audit);
            applySnapshot(snapshot);
            completed = audit.status !== 'stale' && audit.status !== 'fatal';

            if (Math.random() < config.consoleLogProbability) {
                console.log(`Poll complete: ${detectedSlashings.length} rounds, audit=${audit.status}`);
            }
        }
        catch (error) {
            if (error instanceof StaleMonitorRunError) {
                return;
            }
            console.error('Poll error:', error);
            setMonitorFailure(`Unable to refresh on-chain state: ${toErrorMessage(error)}`);
        }
        finally {
            if (completed && isFirstScanRef.current) {
                isFirstScanRef.current = false;
                setIsScanning(false);
            }

            isPollingRef.current = false;
        }
    }, [applySnapshot, config.consoleLogProbability, initializeMonitor, setIsScanning, setMonitorFailure]);

    useEffect(() => {
        let cancelled = false;
        const generation = runGenerationRef.current + 1;
        runGenerationRef.current = generation;
        isActiveRef.current = true;

        function scheduleNextPoll() {
            if (!isActiveRef.current || generation !== runGenerationRef.current) {
                return;
            }

            timeoutRef.current = setTimeout(async () => {
                if (!isActiveRef.current || generation !== runGenerationRef.current) {
                    return;
                }

                await poll(undefined, generation);
                if (isActiveRef.current && generation === runGenerationRef.current) {
                    scheduleNextPoll();
                }
            }, config.pollInterval);
        }

        const start = async () => {
            try {
                const initialState = await initializeMonitor(generation);
                if (cancelled || generation !== runGenerationRef.current) {
                    return;
                }

                await poll(initialState, generation);
                if (!cancelled && generation === runGenerationRef.current) {
                    scheduleNextPoll();
                }
            }
            catch (error) {
                if (cancelled || generation !== runGenerationRef.current || error instanceof StaleMonitorRunError) {
                    return;
                }
                console.error('Failed to initialize slashing monitor:', error);
                const message = `Unable to initialize from the canonical Aztec deployment: ${toErrorMessage(error)}`;
                setInitializationError(message);
                setMonitorFailure(message, true);
                setIsScanning(false);
                if (!cancelled) {
                    timeoutRef.current = setTimeout(start, config.pollInterval);
                }
            }
        };

        start();

        return () => {
            cancelled = true;
            isActiveRef.current = false;
            if (runGenerationRef.current === generation) {
                runGenerationRef.current += 1;
            }
            isPollingRef.current = false;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [config.pollInterval, initializeMonitor, poll, setInitializationError, setIsScanning, setMonitorFailure]);
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
            isSlashingEnabled: currentState.isSlashingEnabled,
            pauseStartedAtSlot: currentState.pauseStartedAtSlot,
            pauseEndsAtSlot: currentState.pauseEndsAtSlot,
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

function buildAudit(issues: MonitorIssue[], previousLastSuccessfulAt: number | null): MonitorAudit {
    const now = Date.now();
    const hasError = issues.some((issue) => issue.severity === 'error');

    return {
        status: hasError ? 'stale' : issues.length === 0 ? 'ok' : 'partial',
        issues,
        updatedAt: now,
        lastSuccessfulAt: hasError || issues.length > 0 ? previousLastSuccessfulAt : now,
    };
}

function buildDeploymentIssues(config: ReturnType<typeof useSlashingStore.getState>['config'], l1Timestamp?: bigint): MonitorIssue[] {
    if (!config) {
        return [];
    }

    const issues: MonitorIssue[] = [];
    const now = l1Timestamp ?? BigInt(Math.floor(Date.now() / 1000));

    if (config.pendingSlasherAddress !== zeroAddress) {
        const readyAt = config.pendingSlasherReadyAt > 0n
            ? new Date(Number(config.pendingSlasherReadyAt) * 1000).toISOString()
            : 'an unknown time';
        issues.push({
            source: 'deployment',
            scope: 'deployment',
            severity: 'warning',
            message: `Slasher rotation is queued: ${config.pendingSlasherAddress} with proposer ${config.pendingSlashingProposerAddress} can become active at ${readyAt}`,
        });
    }

    if (config.legacySlasherAddress !== zeroAddress && config.legacySlasherAuthorizedUntil >= now) {
        issues.push({
            source: 'deployment',
            scope: 'deployment',
            severity: 'warning',
            message: `Legacy slasher ${config.legacySlasherAddress} with proposer ${config.legacySlashingProposerAddress} remains authorized until ${new Date(Number(config.legacySlasherAuthorizedUntil) * 1000).toISOString()}; its draining rounds are not included in the primary round list`,
        });
    }

    return issues;
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
}

function assertCurrentRun(expected: number, actual: number): void {
    if (expected !== actual) {
        throw new StaleMonitorRunError();
    }
}
