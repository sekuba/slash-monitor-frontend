import { useCallback, useEffect, useRef } from 'react';
import { zeroAddress } from 'viem';
import { resolveDeployment } from '@/lib/deployment';
import { L1Monitor } from '@/lib/l1Monitor';
import { SlashingDetector } from '@/lib/slashingDetector';
import { useSlashingStore } from '@/store/slashingStore';
import type {
    ConfirmedExecution,
    ConfirmedSlash,
    CurrentChainState,
    DetectedSlashing,
    ExecutionHistoryScan,
    MonitorAudit,
    MonitorConfigInput,
    MonitorIssue,
    MonitorSnapshot,
    SlashingStats,
} from '@/types/slashing';

class StaleMonitorRunError extends Error {}
const POLL_INTERVAL_MS = 180_000;
const MAX_EXECUTION_RPC_CALLS_PER_BATCH = 12;
const MAX_EXECUTION_SCAN_BATCH_MS = 15_000;
const EXECUTION_SCAN_BATCH_PAUSE_MS = 1_000;
const ETHEREUM_BLOCK_TIME_SECONDS = 12n;
const EXECUTION_LOOKBACK_SAFETY_BLOCKS = 5_000n;

export function useSlashingMonitor(
    config: MonitorConfigInput,
    active = true,
) {
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
    const isActiveRef = useRef(active);
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
            let confirmedExecutions = previousStoreState.confirmedExecutions;
            let confirmedSlashes = previousStoreState.confirmedSlashes;
            let executionScan = previousStoreState.executionScan;
            const issues: MonitorIssue[] = [
                ...preflightIssues,
                ...buildDeploymentIssues(previousStoreState.config, currentState.l1Timestamp),
            ];
            let detectionSucceeded = false;

            try {
                const detectionResult = await detectorRef.current.detectExecutableRounds(currentState.currentRound, currentState.currentSlot);
                detectedSlashings = detectionResult.detectedSlashings;
                issues.push(...detectionResult.issues);
                detectionSucceeded = true;
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

            let published = false;
            if (detectionSucceeded) {
                let batchStartedAt = Date.now();
                let rpcCalls = 0;
                for (;;) {
                    let result;
                    try {
                        result = await l1MonitorRef.current.scanExecutionHistory(
                            detectedSlashings,
                            executionLookbackBlocks(previousStoreState.config),
                        );
                    }
                    catch (error) {
                        executionScan = {
                            ...executionScan,
                            status: 'paused',
                            lastError: toErrorMessage(error),
                        };
                        const audit = buildAudit(
                            [...issues, executionScanIssue(executionScan)],
                            previousStoreState.audit.lastSuccessfulAt,
                        );
                        assertCurrentRun(generation, runGenerationRef.current);
                        applySnapshot(buildSnapshot(
                            currentState,
                            detectedSlashings,
                            confirmedExecutions,
                            confirmedSlashes,
                            executionScan,
                            audit,
                        ));
                        published = true;
                        completed = true;
                        break;
                    }
                    rpcCalls += result.rpcCalls;
                    confirmedExecutions = result.confirmedExecutions;
                    confirmedSlashes = result.confirmedSlashes;
                    executionScan = result.scan;
                    const scanIssues = executionScan.status === 'paused'
                        ? [executionScanIssue(executionScan)]
                        : [];
                    const audit = buildAudit(
                        [...issues, ...scanIssues],
                        previousStoreState.audit.lastSuccessfulAt,
                    );
                    assertCurrentRun(generation, runGenerationRef.current);
                    applySnapshot(buildSnapshot(
                        currentState,
                        detectedSlashings,
                        confirmedExecutions,
                        confirmedSlashes,
                        executionScan,
                        audit,
                    ));
                    published = true;
                    completed = audit.status !== 'stale' &&
                        audit.status !== 'fatal';
                    if (!result.canContinue) {
                        break;
                    }
                    const batchComplete =
                        rpcCalls >= MAX_EXECUTION_RPC_CALLS_PER_BATCH ||
                        Date.now() - batchStartedAt >=
                            MAX_EXECUTION_SCAN_BATCH_MS;
                    if (batchComplete) {
                        await pauseExecutionScanBatch();
                        assertCurrentRun(
                            generation,
                            runGenerationRef.current,
                        );
                        batchStartedAt = Date.now();
                        rpcCalls = 0;
                        continue;
                    }
                    await yieldToBrowser();
                }
            }

            if (!published) {
                const audit = buildAudit(
                    issues,
                    previousStoreState.audit.lastSuccessfulAt,
                );
                assertCurrentRun(generation, runGenerationRef.current);
                applySnapshot(buildSnapshot(
                    currentState,
                    detectedSlashings,
                    confirmedExecutions,
                    confirmedSlashes,
                    executionScan,
                    audit,
                ));
                completed = audit.status !== 'stale' &&
                    audit.status !== 'fatal';
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
    }, [applySnapshot, initializeMonitor, setIsScanning, setMonitorFailure]);

    useEffect(() => {
        if (!active) {
            isActiveRef.current = false;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            return;
        }

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
            }, POLL_INTERVAL_MS);
        }

        const start = async () => {
            try {
                while (isPollingRef.current) {
                    if (cancelled || generation !== runGenerationRef.current) {
                        return;
                    }
                    await waitForPollToStop();
                }
                if (
                    l1MonitorRef.current &&
                    detectorRef.current &&
                    useSlashingStore.getState().isInitialized
                ) {
                    await poll(undefined, generation);
                }
                else {
                    const initialState = await initializeMonitor(generation);
                    if (cancelled || generation !== runGenerationRef.current) {
                        return;
                    }
                    await poll(initialState, generation);
                }
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
                    timeoutRef.current = setTimeout(start, POLL_INTERVAL_MS);
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
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [
        active,
        initializeMonitor,
        poll,
        setInitializationError,
        setIsScanning,
        setMonitorFailure,
    ]);
}

function buildSnapshot(
    currentState: CurrentChainState,
    detectedSlashings: DetectedSlashing[],
    confirmedExecutions: ConfirmedExecution[],
    confirmedSlashes: ConfirmedSlash[],
    executionScan: ExecutionHistoryScan,
    audit: MonitorAudit
): MonitorSnapshot {
    return {
        ...currentState,
        detectedSlashings: new Map(detectedSlashings.map((slashing) => [slashing.round, slashing])),
        confirmedExecutions,
        confirmedSlashes,
        executionScan,
        stats: buildStats(currentState, detectedSlashings, confirmedSlashes),
        audit,
    };
}

function buildStats(
    currentState: CurrentChainState,
    detectedSlashings: DetectedSlashing[],
    confirmedSlashes: ConfirmedSlash[],
): SlashingStats {
    const activeSlashings = detectedSlashings.filter((slashing) =>
        !slashing.isExecuted &&
        !slashing.isVetoed &&
        slashing.round !== currentState.currentRound &&
        slashing.slashActions &&
        slashing.slashActions.length > 0 &&
        !['expired'].includes(slashing.status)).length;

    return {
        currentRound: currentState.currentRound,
        totalRoundsMonitored: detectedSlashings.length,
        activeSlashings,
        vetoedPayloads: detectedSlashings.filter((slashing) => slashing.isVetoed).length,
        executedRounds: detectedSlashings.filter((slashing) => slashing.isExecuted).length,
        totalValidatorsSlashed: new Set(
            confirmedSlashes.map((slash) => slash.sequencer.toLowerCase()),
        ).size,
        totalSlashAmount: confirmedSlashes.reduce(
            (sum, slash) => sum + slash.amount,
            0n,
        ),
    };
}

function executionLookbackBlocks(
    config: ReturnType<typeof useSlashingStore.getState>['config'],
): bigint {
    if (!config) return 10_000n;
    const executionWindowRounds = Math.max(
        1,
        config.lifetimeInRounds - config.executionDelayInRounds,
    );
    const seconds = BigInt(executionWindowRounds) *
        BigInt(config.slashingRoundSize) *
        BigInt(config.slotDuration);
    return seconds / ETHEREUM_BLOCK_TIME_SECONDS +
        EXECUTION_LOOKBACK_SAFETY_BLOCKS;
}

function executionScanIssue(scan: ExecutionHistoryScan): MonitorIssue {
    return {
        source: 'l1-rpc',
        scope: 'execution-history',
        severity: 'warning',
        message: `Execution history paused after ${scan.scannedBlocks} of ${scan.totalBlocks} blocks: ${
            scan.lastError ?? 'the RPC stopped accepting history requests'
        }`,
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

function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function waitForPollToStop(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
}

function pauseExecutionScanBatch(): Promise<void> {
    return new Promise((resolve) =>
        setTimeout(resolve, EXECUTION_SCAN_BATCH_PAUSE_MS));
}
