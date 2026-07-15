import { decodeFunctionResult, encodeFunctionData, type Address, type PublicClient } from 'viem';

export const multicall3Abi = [
    {
        inputs: [
            {
                components: [
                    { name: 'target', type: 'address' },
                    { name: 'allowFailure', type: 'bool' },
                    { name: 'callData', type: 'bytes' },
                ],
                name: 'calls',
                type: 'tuple[]',
            },
        ],
        name: 'aggregate3',
        outputs: [
            {
                components: [
                    { name: 'success', type: 'bool' },
                    { name: 'returnData', type: 'bytes' },
                ],
                name: 'returnData',
                type: 'tuple[]',
            },
        ],
        stateMutability: 'payable',
        type: 'function',
    },
] as const;

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as Address;
const MAX_CALLS_PER_BATCH = 40;
const MAX_CALLDATA_BYTES_PER_BATCH = 96_000;

export interface Call {
    target: Address;
    abi: any;
    functionName: string;
    args?: any[];
}

export type MulticallResult<T = any> =
    | {
        success: true;
        data: T;
    }
    | {
        success: false;
        error: Error;
    };

export async function multicall<T extends readonly Call[]>(client: PublicClient, calls: T, blockNumber?: bigint): Promise<{
    [K in keyof T]: MulticallResult;
}> {
    const preparedCalls = calls.map((call) => {
        const callData = encodeFunctionData({
            abi: call.abi,
            functionName: call.functionName,
            args: call.args || [],
            });
        return {
            ...call,
            callData,
            estimatedBytes: (callData.length - 2) / 2,
        };
    });

    const chunks = chunkCalls(preparedCalls);
    const results: MulticallResult[] = [];

    for (const chunk of chunks) {
        results.push(...await runChunk(client, chunk, blockNumber));
    }

    return results as {
        [K in keyof T]: MulticallResult;
    };
}

async function runChunk(
    client: PublicClient,
    calls: Array<Call & { callData: `0x${string}`; estimatedBytes: number }>,
    blockNumber?: bigint
): Promise<MulticallResult[]> {
    try {
        const response = (await client.readContract({
            address: MULTICALL3_ADDRESS,
            abi: multicall3Abi,
            functionName: 'aggregate3',
            args: [calls.map((call) => ({
                target: call.target,
                allowFailure: true,
                callData: call.callData,
            }))],
            blockNumber,
        })) as {
            success: boolean;
            returnData: `0x${string}`;
        }[];

        return response.map((result, index) => decodeResult(calls[index], result));
    }
    catch (error) {
        if (calls.length === 1) {
            return [{
                success: false,
                error: new Error(`Multicall transport failed for ${describeCall(calls[0])}: ${toErrorMessage(error)}`),
            }];
        }

        const midpoint = Math.ceil(calls.length / 2);
        const left = await runChunk(client, calls.slice(0, midpoint), blockNumber);
        const right = await runChunk(client, calls.slice(midpoint), blockNumber);
        return [...left, ...right];
    }
}

function decodeResult(
    call: Call & { callData: `0x${string}`; estimatedBytes: number },
    result: { success: boolean; returnData: `0x${string}` }
): MulticallResult {
    if (!result.success) {
        return {
            success: false,
            error: new Error(`Multicall failed for ${describeCall(call)}`),
        };
    }

    try {
        return {
            success: true,
            data: decodeFunctionResult({
                abi: call.abi,
                functionName: call.functionName,
                data: result.returnData,
                args: call.args,
            }),
        };
    }
    catch (error) {
        return {
            success: false,
            error: new Error(`Failed to decode ${describeCall(call)}: ${toErrorMessage(error)}`),
        };
    }
}

function chunkCalls(calls: Array<Call & { callData: `0x${string}`; estimatedBytes: number }>) {
    const chunks: Array<Array<Call & { callData: `0x${string}`; estimatedBytes: number }>> = [];
    let currentChunk: Array<Call & { callData: `0x${string}`; estimatedBytes: number }> = [];
    let currentSize = 0;

    for (const call of calls) {
        const wouldOverflow = currentChunk.length > 0 && (
            currentChunk.length >= MAX_CALLS_PER_BATCH ||
            currentSize + call.estimatedBytes > MAX_CALLDATA_BYTES_PER_BATCH
        );

        if (wouldOverflow) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentSize = 0;
        }

        currentChunk.push(call);
        currentSize += call.estimatedBytes;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}

function describeCall(call: Call): string {
    const argsInfo = call.args && call.args.length > 0
        ? `(${JSON.stringify(call.args, (_, value) => typeof value === 'bigint' ? value.toString() : value)})`
        : '()';

    return `${call.functionName}${argsInfo} on ${call.target}`;
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
}

export function createCall(target: Address, abi: any, functionName: string, args?: any[]): Call {
    return { target, abi, functionName, args };
}
