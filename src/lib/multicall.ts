import { type Address, type PublicClient, encodeFunctionData, decodeFunctionResult } from 'viem';
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
export interface Call {
    target: Address;
    abi: any;
    functionName: string;
    args?: any[];
}
export interface MulticallResult<T = any> {
    success: boolean;
    data?: T;
    error?: Error;
}
export async function multicall<T extends readonly Call[]>(client: PublicClient, calls: T): Promise<{
    [K in keyof T]: MulticallResult;
}> {
    const encodedCalls = calls.map((call) => ({
        target: call.target,
        allowFailure: true,
        callData: encodeFunctionData({
            abi: call.abi,
            functionName: call.functionName,
            args: call.args || [],
        }),
    }));
    const results = (await client.readContract({
        address: MULTICALL3_ADDRESS,
        abi: multicall3Abi,
        functionName: 'aggregate3',
        args: [encodedCalls],
    })) as {
        success: boolean;
        returnData: `0x${string}`;
    }[];
    return results.map((result, i) => {
        const call = calls[i];
        if (!result.success) {
            const argsInfo = call.args && call.args.length > 0
                ? ` with args: ${JSON.stringify(call.args, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`
                : '';
            return {
                success: false,
                error: new Error(
                    `Multicall failed: ${call.functionName} on ${call.target}${argsInfo}`
                ),
            };
        }
        try {
            const decoded = decodeFunctionResult({
                abi: call.abi,
                functionName: call.functionName,
                data: result.returnData,
                args: call.args,
            });
            return {
                success: true,
                data: decoded,
            };
        }
        catch (error) {
            const baseError = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: new Error(
                    `Failed to decode result for ${call.functionName} on ${call.target}: ${baseError}`
                ),
            };
        }
    }) as any;
}
export function createCall(target: Address, abi: any, functionName: string, args?: any[]): Call {
    return { target, abi, functionName, args };
}
