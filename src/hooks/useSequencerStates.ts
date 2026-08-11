import { useEffect, useMemo, useState } from 'react';
import { createPublicClient } from 'viem';
import type { ProtocolSnapshot } from '@shared/protocol/index.ts';
import { createPublicRpcTransport } from '@/lib/rpc';
import {
    readSequencerStates,
    type SequencerState,
} from '@/lib/sequencerState';
import type { MonitorConfigInput } from '@/types/slashing';

export interface SequencerStates {
    states: Map<string, SequencerState>;
    isLoading: boolean;
    error: string | null;
    scopeKey: string | null;
}

const EMPTY_STATE: SequencerStates = {
    states: new Map(),
    isLoading: false,
    error: null,
    scopeKey: null,
};

export function useSequencerStates({
    config,
    protocol,
    addresses,
}: {
    config: MonitorConfigInput;
    protocol: ProtocolSnapshot | null;
    addresses: readonly string[];
}): SequencerStates {
    const normalizedAddresses = [...new Set(
        addresses.map((address) => address.toLowerCase()),
    )].sort();
    const addressKey = normalizedAddresses.join(',');
    const chainId = protocol?.chainId;
    const blockNumber = protocol?.blockNumber;
    const blockHash = protocol?.blockHash;
    const rollupAddress = protocol?.rollupAddress;
    const canRead = chainId !== undefined &&
        Boolean(blockNumber && blockHash && rollupAddress && config.l1RpcUrl && addressKey);
    const scopeKey = canRead
        ? `${chainId}:${rollupAddress?.toLowerCase()}:${addressKey}`
        : null;
    const [state, setState] = useState<SequencerStates>(EMPTY_STATE);
    const loadingState = useMemo<SequencerStates>(() => ({
        states: new Map(),
        isLoading: true,
        error: null,
        scopeKey,
    }), [scopeKey]);

    useEffect(() => {
        if (!canRead || !blockNumber || !blockHash || !rollupAddress || !scopeKey) return;
        let cancelled = false;
        const requestedAddresses = addressKey.split(',');
        const client = createPublicClient({
            transport: createPublicRpcTransport(config.l1RpcUrl),
        });
        void readSequencerStates(client, {
            chainId,
            blockNumber,
            blockHash,
            rollupAddress,
        }, requestedAddresses).then(
            (result) => {
                if (cancelled) return;
                setState({
                    states: result.states,
                    isLoading: false,
                    error: result.unavailable.length === 0
                        ? null
                        : `Current stake unavailable for ${result.unavailable.length} sequencer${
                            result.unavailable.length === 1 ? '' : 's'
                        }`,
                    scopeKey,
                });
            },
            (error: unknown) => {
                if (cancelled) return;
                setState({
                    states: new Map(),
                    isLoading: false,
                    error: error instanceof Error
                        ? error.message
                        : 'Unable to read current sequencer stake',
                    scopeKey,
                });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [
        addressKey,
        canRead,
        config.l1RpcUrl,
        blockHash,
        blockNumber,
        chainId,
        rollupAddress,
        scopeKey,
    ]);

    if (!scopeKey) return EMPTY_STATE;
    if (state.scopeKey !== scopeKey) return loadingState;
    return state;
}
