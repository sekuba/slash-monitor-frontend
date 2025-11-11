import type { Address } from 'viem'
import type { L2Tips, NodeInfo, Offense } from '@/types/slashing'

/**
 * Client for interacting with Aztec Node JSON RPC API
 */
export class NodeRpcClient {
  private nodeRpcUrl: string
  private nodeAdminUrl: string

  constructor(nodeRpcUrl: string, nodeAdminUrl: string) {
    this.nodeRpcUrl = nodeRpcUrl
    this.nodeAdminUrl = nodeAdminUrl
  }

  /**
   * Make a JSON RPC call
   */
  private async rpcCall<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const data = await response.json()

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`)
    }

    return data.result
  }

  /**
   * Get node information
   */
  async getNodeInfo(): Promise<NodeInfo> {
    return this.rpcCall<NodeInfo>(this.nodeRpcUrl, 'node_getNodeInfo')
  }

  /**
   * Get L2 chain tips (latest, pending, proven)
   */
  async getL2Tips(): Promise<L2Tips> {
    return this.rpcCall<L2Tips>(this.nodeRpcUrl, 'node_getL2Tips')
  }

  /**
   * Get the latest L2 block number
   */
  async getBlockNumber(): Promise<number> {
    return this.rpcCall<number>(this.nodeRpcUrl, 'node_getBlockNumber')
  }

  /**
   * Check if the node is ready
   */
  async isReady(): Promise<boolean> {
    try {
      return await this.rpcCall<boolean>(this.nodeRpcUrl, 'node_isReady')
    } catch {
      return false
    }
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

  /**
   * Get all slash payloads for the current round
   * Note: This is only supported in Empire slashing model, not Tally
   */
  async getSlashPayloads(): Promise<any[]> {
    try {
      return await this.rpcCall<any[]>(this.nodeAdminUrl, 'nodeAdmin_getSlashPayloads')
    } catch (error) {
      console.warn('getSlashPayloads not supported (likely using Tally model):', error)
      return []
    }
  }

  /**
   * Get node configuration
   */
  async getConfig(): Promise<any> {
    return this.rpcCall(this.nodeAdminUrl, 'nodeAdmin_getConfig')
  }

  /**
   * Update node configuration
   */
  async setConfig(config: Record<string, unknown>): Promise<void> {
    await this.rpcCall(this.nodeAdminUrl, 'nodeAdmin_setConfig', [config])
  }
}

/**
 * Create a new Node RPC client
 */
export function createNodeRpcClient(nodeRpcUrl: string, nodeAdminUrl: string): NodeRpcClient {
  return new NodeRpcClient(nodeRpcUrl, nodeAdminUrl)
}
