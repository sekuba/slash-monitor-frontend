import { type Address, type PublicClient, encodeFunctionData, decodeFunctionResult } from 'viem'

/**
 * Multicall3 ABI (only the functions we need)
 */
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
] as const

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as Address

export interface Call {
  target: Address
  abi: any
  functionName: string
  args?: any[]
}

export interface MulticallResult<T = any> {
  success: boolean
  data?: T
  error?: Error
}

/**
 * Batch multiple contract calls into a single multicall
 */
export async function multicall<T extends readonly Call[]>(
  client: PublicClient,
  calls: T
): Promise<{ [K in keyof T]: MulticallResult }> {
  // Encode all calls
  const encodedCalls = calls.map((call) => ({
    target: call.target,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args || [],
    }),
  }))

  // Execute multicall
  const results = (await client.readContract({
    address: MULTICALL3_ADDRESS,
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [encodedCalls],
  })) as { success: boolean; returnData: `0x${string}` }[]

  // Decode results
  return results.map((result, i) => {
    if (!result.success) {
      return {
        success: false,
        error: new Error(`Call ${i} failed`),
      }
    }

    try {
      const decoded = decodeFunctionResult({
        abi: calls[i].abi,
        functionName: calls[i].functionName,
        data: result.returnData,
        args: calls[i].args,
      })

      return {
        success: true,
        data: decoded,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Decode failed'),
      }
    }
  }) as any
}

/**
 * Helper to create a call object
 */
export function createCall(target: Address, abi: any, functionName: string, args?: any[]): Call {
  return { target, abi, functionName, args }
}
