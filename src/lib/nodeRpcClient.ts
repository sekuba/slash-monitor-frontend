import type { Address } from 'viem'
import type { Offense } from '@/types/slashing'

/**
 * Client for interacting with Aztec Node JSON RPC API
 */
export class NodeRpcClient {
  private nodeAdminUrl: string

  constructor(nodeAdminUrl: string) {
    this.nodeAdminUrl = nodeAdminUrl
  }

  /**
   * Make a JSON RPC call
   */
  private async rpcCall<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add API key if configured (for proxied requests)
    const apiKey = import.meta.env.VITE_API_KEY
    if (apiKey) {
      headers['x-api-key'] = apiKey
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now(),
      }),
    })

    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.statusText}`)
    }

    // Get response text first to handle empty responses
    const text = await response.text()

    // Handle empty responses
    if (!text || text.trim() === '') {
      throw new Error(`RPC call returned empty response for method: ${method}`)
    }

    // Parse JSON with better error handling
    let data
    try {
      data = JSON.parse(text)
    } catch (error) {
      throw new Error(`Failed to parse JSON response for method ${method}: ${error instanceof Error ? error.message : 'Unknown error'}. Response: ${text.substring(0, 100)}`)
    }

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`)
    }

    return data.result
  }

  /**
   * Get slash offenses for a specific round
   * @param round - Round number, 'current', or 'all'
   */
  async getSlashOffenses(round: bigint | 'current' | 'all' = 'all'): Promise<Offense[]> {
    const roundParam = typeof round === 'bigint' ? round.toString() : round
    const rawOffenses = await this.rpcCall<any[]>(this.nodeAdminUrl, 'nodeAdmin_getSlashOffenses', [roundParam])

    // Transform raw RPC response to our Offense type
    return rawOffenses.map((offense) => ({
      validator: offense.validator as Address,
      offenseType: offense.offenseType,
      amount: BigInt(offense.amount),
      epoch: offense.epoch ? BigInt(offense.epoch) : undefined,
      blockNumber: offense.blockNumber ? BigInt(offense.blockNumber) : undefined,
      round: offense.round ? BigInt(offense.round) : undefined,
    }))
  }
}
