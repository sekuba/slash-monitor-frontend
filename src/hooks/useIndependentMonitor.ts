import { useCallback, useEffect, useRef, useState } from 'react';
import { zeroAddress } from 'viem';
import { buildSlashingCase, type SlashingCase, type SlashingStackRole } from '@/domain';
import {
    INDEPENDENT_L1_CONFIRMATIONS,
    resolveDeployment,
} from '@/lib/deployment';
import {
    fetchRecentL1SlashReceipts,
    type GroupedL1SlashReceipt,
} from '@/lib/l1SlashReceipts';
import { L1Monitor } from '@/lib/l1Monitor';
import { SlashingDetector } from '@/lib/slashingDetector';
import type {
    CurrentChainState,
    DeploymentAddresses,
    DetectedL1Round,
    MonitorConfigInput,
    ResolvedMonitorConfig,
    RuntimeMonitorConfig,
    SlashingContractParameters,
} from '@/types/slashing';

const POLL_INTERVAL_MS = 180_000;

export interface IndependentProtocolSnapshot {
    blockNumber: bigint;
    confirmationDepth: bigint;
    observedAt: string;
    currentSlot: bigint;
    currentEpoch: bigint;
    currentRound: bigint;
    parameters: SlashingContractParameters;
}

export interface IndependentDeploymentSnapshot extends DeploymentAddresses {
    activeStackPausedUntil: string | null;
    legacyStackPausedUntil: string | null;
}

export interface IndependentSnapshot {
    observedAt: string;
    protocol: IndependentProtocolSnapshot;
    deployment: IndependentDeploymentSnapshot;
    cases: SlashingCase[];
    recentSlashes: GroupedL1SlashReceipt[];
    slashReceiptCoverage: {
        status: 'complete' | 'partial' | 'unavailable';
        fromBlock: bigint;
        toBlock: bigint;
        issues: string[];
    };
    issues: string[];
}

interface IndependentMonitorState {
    snapshot: IndependentSnapshot | null;
    isLoading: boolean;
    isRefreshing: boolean;
    error: string | null;
}

const initialState: IndependentMonitorState = {
    snapshot: null,
    isLoading: true,
    isRefreshing: false,
    error: null,
};

export function useIndependentMonitor(config: MonitorConfigInput) {
    const [state, setState] = useState<IndependentMonitorState>(initialState);
    const generationRef = useRef(0);

    const refresh = useCallback(async () => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        setState((current) => ({
            ...current,
            isLoading: current.snapshot === null,
            isRefreshing: current.snapshot !== null,
            error: null,
        }));

        try {
            const snapshot = await scanIndependentMonitor(config);
            if (generationRef.current === generation) {
                setState({
                    snapshot,
                    isLoading: false,
                    isRefreshing: false,
                    error: null,
                });
            }
        }
        catch (error) {
            if (generationRef.current === generation) {
                setState((current) => ({
                    ...current,
                    isLoading: false,
                    isRefreshing: false,
                    error: toErrorMessage(error),
                }));
            }
        }
    }, [config]);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void refresh();
            }
        }, POLL_INTERVAL_MS);
        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        window.addEventListener('online', refreshWhenVisible);
        document.addEventListener('visibilitychange', refreshWhenVisible);

        return () => {
            generationRef.current += 1;
            window.clearInterval(timer);
            window.removeEventListener('online', refreshWhenVisible);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
        };
    }, [refresh]);

    return { ...state, refresh };
}

export async function scanIndependentMonitor(
    config: MonitorConfigInput,
): Promise<IndependentSnapshot> {
    const deployment = await resolveDeployment(config);
    const active = stackRuntime(config, deployment, 'active');
    const stacks: Array<{ role: SlashingStackRole; runtime: RuntimeMonitorConfig }> = [
        { role: 'active', runtime: active },
    ];

    if (
        deployment.legacySlasherAddress !== zeroAddress &&
        deployment.legacySlashingProposerAddress !== zeroAddress &&
        deployment.legacySlasherAuthorizedUntil >= deployment.deploymentTimestamp
    ) {
        stacks.push({
            role: 'legacy',
            runtime: stackRuntime(config, deployment, 'legacy'),
        });
    }

    const results = await Promise.allSettled(stacks.map(({ role, runtime }) =>
        scanStack(role, runtime, deployment),
    ));
    const scans: StackScan[] = [];
    const issues: string[] = [];

    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            scans.push(result.value);
            issues.push(...result.value.issues);
        } else {
            issues.push(`${capitalize(stacks[index].role)} slashing stack: ${toErrorMessage(result.reason)}`);
        }
    });

    const activeScan = scans.find((scan) => scan.role === 'active');
    if (!activeScan) {
        throw new Error(issues[0] ?? 'The active Aztec slashing stack could not be read.');
    }

    const observedAt = unixSecondsToIso(activeScan.state.l1Timestamp);
    const receiptHorizon = recentSlashHorizonBlocks(activeScan.parameters);
    let receiptResult: Awaited<ReturnType<typeof fetchRecentL1SlashReceipts>> | null = null;
    let receiptFailure: string | null = null;
    try {
        receiptResult = await fetchRecentL1SlashReceipts({
            rpcUrls: config.l1RpcUrl,
            chainId: config.chainId,
            rollupAddress: deployment.rollupAddress,
            toBlock: activeScan.state.l1BlockNumber,
            toBlockHash: deployment.deploymentBlockHash,
            horizonBlocks: receiptHorizon,
            chunkSize: 4_000n,
        });
    }
    catch (error) {
        receiptFailure = toErrorMessage(error);
    }
    const receiptIssues = [
        ...(receiptResult?.coverage.issues.map((issue) =>
            `Slashed logs, blocks ${issue.fromBlock}–${issue.toBlock}: ${issue.message}`) ?? []),
        ...(receiptFailure ? [`Slashed logs: ${receiptFailure}`] : []),
    ];
    const fallbackFromBlock = activeScan.state.l1BlockNumber + 1n > receiptHorizon
        ? activeScan.state.l1BlockNumber + 1n - receiptHorizon
        : 0n;

    return {
        observedAt,
        protocol: {
            blockNumber: activeScan.state.l1BlockNumber,
            confirmationDepth: INDEPENDENT_L1_CONFIRMATIONS,
            observedAt,
            currentSlot: activeScan.state.currentSlot,
            currentEpoch: activeScan.state.currentEpoch,
            currentRound: activeScan.state.currentRound,
            parameters: activeScan.parameters,
        },
        deployment: {
            ...deployment,
            activeStackPausedUntil: pauseEnd(activeScan.state),
            legacyStackPausedUntil: pauseEnd(
                scans.find((scan) => scan.role === 'legacy')?.state,
            ),
        },
        cases: scans
            .flatMap((scan) => scan.cases)
            .sort((a, b) => Number(b.round - a.round)),
        recentSlashes: receiptResult?.receipts ?? [],
        slashReceiptCoverage: {
            status: receiptResult?.coverage.status ?? 'unavailable',
            fromBlock: receiptResult?.fromBlock ?? fallbackFromBlock,
            toBlock: receiptResult?.toBlock ?? activeScan.state.l1BlockNumber,
            issues: receiptIssues,
        },
        issues: [...issues, ...receiptIssues],
    };
}

interface StackScan {
    role: 'active' | 'legacy';
    state: CurrentChainState;
    parameters: SlashingContractParameters;
    cases: SlashingCase[];
    issues: string[];
}

async function scanStack(
    role: StackScan['role'],
    runtime: RuntimeMonitorConfig,
    deployment: DeploymentAddresses,
): Promise<StackScan> {
    const l1 = new L1Monitor(runtime);
    const [parameters, state] = await Promise.all([
        l1.loadContractParameters(),
        l1.getCurrentState(),
    ]);
    const resolved: ResolvedMonitorConfig = { ...runtime, ...parameters };
    const result = await new SlashingDetector(resolved, l1)
        .detectRounds(state.currentRound);
    const cases = result.detectedRounds
        .map((detection) => detectionToCase(
            detection,
            role,
            resolved,
            state,
            deployment,
        ));
    const caseRounds = new Set(cases.map((slashingCase) => slashingCase.round.toString()));

    return {
        role,
        state,
        parameters,
        cases,
        issues: result.issues
            .filter((issue) => (
                issue.round === undefined ||
                !caseRounds.has(issue.round.toString())
            ))
            .map((issue) => (
                issue.round === undefined
                    ? `${capitalize(role)} stack: ${issue.message}`
                    : `${capitalize(role)} stack, round ${issue.round}: ${issue.message}`
            )),
    };
}

function detectionToCase(
    detection: DetectedL1Round,
    role: StackScan['role'],
    config: ResolvedMonitorConfig,
    state: CurrentChainState,
    deployment: DeploymentAddresses,
): SlashingCase {
    const authorized = role === 'active' ||
        deployment.legacySlasherAuthorizedUntil >= state.l1Timestamp;
    const observedAt = unixSecondsToIso(state.l1Timestamp);

    return buildSlashingCase({
        id: `${config.chainId}:${role}:${config.slasherAddress.toLowerCase()}:${detection.round}`,
        network: config.chainId === 1 ? 'mainnet' : 'testnet',
        round: detection.round,
        currentRound: state.currentRound,
        currentSlot: state.currentSlot,
        targetEpochs: detection.targetEpochs,
        stack: {
            role,
            slasherAddress: config.slasherAddress,
            authorized,
        },
        ballotCount: detection.ballotCount,
        quorumPerTarget: config.quorum,
        reachedQuorum: detection.slashActions.length > 0,
        proposedActions: detection.slashActions.map((action) => ({
            validator: action.validator,
            amount: action.slashAmount,
        })),
        payloadAddress: detection.payloadAddress,
        exactPayloadVetoed: detection.isVetoed,
        roundExecuted: detection.isExecuted,
        slashingEnabled: state.isSlashingEnabled,
        timing: {
            roundSizeSlots: config.slashingRoundSize,
            executionDelayRounds: config.executionDelayInRounds,
            lifetimeRounds: config.lifetimeInRounds,
        },
        executableAt: isoAtSlot(
            detection.slotWhenExecutable,
            config.l1GenesisTime,
            config.slotDuration,
        ),
        expiresAt: isoAtSlot(
            detection.slotWhenExpires,
            config.l1GenesisTime,
            config.slotDuration,
        ),
        pauseEndsAt: pauseEnd(state),
        observation: {
            source: 'independent-l1',
            observedAt,
            blockNumber: state.l1BlockNumber,
        },
    });
}

function stackRuntime(
    config: MonitorConfigInput,
    deployment: DeploymentAddresses,
    role: 'active' | 'legacy',
): RuntimeMonitorConfig {
    if (role === 'active') return { ...config, ...deployment };
    return {
        ...config,
        ...deployment,
        slasherAddress: deployment.legacySlasherAddress,
        slashingProposerAddress: deployment.legacySlashingProposerAddress,
    };
}

function isoAtSlot(
    slot: bigint | undefined,
    l1GenesisTime: bigint,
    slotDurationSeconds: number,
): string | null {
    if (slot === undefined) return null;
    const timestamp = l1GenesisTime + slot * BigInt(slotDurationSeconds);
    return timestamp >= 0n ? unixSecondsToIso(timestamp) : null;
}

function pauseEnd(state: CurrentChainState | undefined): string | null {
    if (!state || state.isSlashingEnabled || state.slashingDisabledUntil <= 0n) return null;
    return unixSecondsToIso(state.slashingDisabledUntil);
}

function recentSlashHorizonBlocks(parameters: SlashingContractParameters): bigint {
    const lifetimeSeconds =
        parameters.lifetimeInRounds *
        parameters.slashingRoundSize *
        parameters.slotDuration;
    // Ten seconds is deliberately conservative relative to Ethereum's target
    // block time; the extra blocks cover timestamp and head variance.
    return BigInt(Math.ceil(lifetimeSeconds / 10)) + 1_024n;
}

function unixSecondsToIso(value: bigint): string {
    return new Date(Number(value) * 1_000).toISOString();
}

function capitalize(value: string): string {
    return value[0].toUpperCase() + value.slice(1);
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
