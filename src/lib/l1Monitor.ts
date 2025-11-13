import {
  createPublicClient,
  http,
  fallback,
  type Address,
  type PublicClient,
} from 'viem'
import { tallySlashingProposerAbi } from './contracts/tallySlashingProposerAbi'
import { slasherAbi } from './contracts/slasherAbi'
import { rollupAbi } from './contracts/rollupAbi'
import { multicall, createCall } from './multicall'
import { ImmutableAwareCache } from './immutableCache'
import type {
  SlashAction,
  RoundInfo,
  SlashingMonitorConfig,
} from '@/types/slashing'

/**
 * L1 Monitor for tracking slashing-related events and contract state
 */
export class L1Monitor {
  private publicClient: PublicClient
  private config: SlashingMonitorConfig
  private roundCache: ImmutableAwareCache<bigint, RoundInfo>
  private mutableTTL: number

  constructor(config: SlashingMonitorConfig) {
    this.config = config
    this.mutableTTL = config.l1RoundCacheTTL

    // Create immutability-aware cache
    // Executed rounds are immutable and cached forever
    this.roundCache = new ImmutableAwareCache<bigint, RoundInfo>(
      (round) => round.toString(),
      (roundInfo) => roundInfo.isExecuted, // Executed rounds never change
      { maxMutableSize: 100 }
    )

    // Create transport with automatic failover for multiple RPC URLs
    const transport = Array.isArray(config.l1RpcUrl)
      ? fallback(config.l1RpcUrl.map(url => http(url)))
      : http(config.l1RpcUrl)

    // Create public client for reading
    this.publicClient = createPublicClient({
      transport,
    })
  }

  /**
   * Clear cache for a specific round or all rounds
   */
  clearCache(round?: bigint) {
    if (round !== undefined) {
      this.roundCache.delete(round)
    } else {
      this.roundCache.clear()
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.roundCache.getStats()
  }

  /**
   * Log cache statistics (useful for debugging)
   */
  logCacheStats() {
    console.log(`[L1Monitor] ${this.roundCache.getStatsString()}`)
  }

  /**
   * Get the current round number
   */
  async getCurrentRound(): Promise<bigint> {
    const round = await this.publicClient.readContract({
      address: this.config.tallySlashingProposerAddress,
      abi: tallySlashingProposerAbi,
      functionName: 'getCurrentRound',
    })
    return round as bigint
  }

  /**
   * Get the current slot from the Rollup contract
   */
  async getCurrentSlot(): Promise<bigint> {
    const slot = await this.publicClient.readContract({
      address: this.config.rollupAddress,
      abi: rollupAbi,
      functionName: 'getCurrentSlot',
    })
    return slot as bigint
  }

  /**
   * Get the current epoch from the Rollup contract
   */
  async getCurrentEpoch(): Promise<bigint> {
    const epoch = await this.publicClient.readContract({
      address: this.config.rollupAddress,
      abi: rollupAbi,
      functionName: 'getCurrentEpoch',
    })
    return epoch as bigint
  }

  /**
   * Get current state (round, slot, epoch, slashing status) in a single multicall
   * This replaces 6 separate RPC calls with 1
   */
  async getCurrentState(): Promise<{
    currentRound: bigint
    currentSlot: bigint
    currentEpoch: bigint
    isSlashingEnabled: boolean
    slashingDisabledUntil: bigint
    slashingDisableDuration: bigint
  }> {
    const calls = [
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getCurrentRound'),
      createCall(this.config.rollupAddress, rollupAbi, 'getCurrentSlot'),
      createCall(this.config.rollupAddress, rollupAbi, 'getCurrentEpoch'),
      createCall(this.config.slasherAddress, slasherAbi, 'isSlashingEnabled'),
      createCall(this.config.slasherAddress, slasherAbi, 'slashingDisabledUntil'),
      createCall(this.config.slasherAddress, slasherAbi, 'SLASHING_DISABLE_DURATION'),
    ]

    const results = await multicall(this.publicClient, calls)

    return {
      currentRound: results[0].data as bigint,
      currentSlot: results[1].data as bigint,
      currentEpoch: results[2].data as bigint,
      isSlashingEnabled: results[3].data as boolean,
      slashingDisabledUntil: results[4].data as bigint,
      slashingDisableDuration: results[5].data as bigint,
    }
  }

  /**
   * Get information about a specific round (with caching)
   */
  async getRound(round: bigint, skipCache = false): Promise<RoundInfo> {
    // Check cache first
    if (!skipCache) {
      const cached = this.roundCache.get(round)
      if (cached) {
        return cached
      }
    }

    const result = await this.publicClient.readContract({
      address: this.config.tallySlashingProposerAddress,
      abi: tallySlashingProposerAbi,
      functionName: 'getRound',
      args: [round],
    })

    // getRound returns (bool isExecuted, bool readyToExecute, uint256 voteCount)
    const [isExecuted, , voteCount] = result as [
      boolean,
      boolean,
      bigint,
    ]

    const roundInfo = {
      round,
      isExecuted: isExecuted as boolean,
      voteCount: voteCount as bigint,
    }

    // Cache the result
    // Executed rounds get cached forever, others use configurable TTL
    this.roundCache.set(round, roundInfo, this.mutableTTL)

    return roundInfo
  }

  /**
   * Get information about multiple rounds in a single multicall
   * This is much more efficient than calling getRound multiple times
   */
  async getRounds(rounds: bigint[]): Promise<Map<bigint, RoundInfo>> {
    // Check which rounds we need to fetch (not in cache)
    const roundsToFetch: bigint[] = []
    const cachedRounds = new Map<bigint, RoundInfo>()

    for (const round of rounds) {
      const cached = this.roundCache.get(round)
      if (cached) {
        cachedRounds.set(round, cached)
      } else {
        roundsToFetch.push(round)
      }
    }

    // If all rounds are cached, return immediately
    if (roundsToFetch.length === 0) {
      return cachedRounds
    }

    // Fetch uncached rounds in a single multicall
    const calls = roundsToFetch.map((round) =>
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getRound', [round])
    )

    const results = await multicall(this.publicClient, calls)

    // Process results and cache them
    const allRounds = new Map(cachedRounds)
    results.forEach((result, i) => {
      if (result.success && result.data) {
        const round = roundsToFetch[i]
        const [isExecuted, , voteCount] = result.data as [boolean, boolean, bigint]

        const roundInfo: RoundInfo = {
          round,
          isExecuted,
          voteCount,
        }

        // Cache with smart TTL (executed = forever, others = mutableTTL)
        this.roundCache.set(round, roundInfo, this.mutableTTL)
        allRounds.set(round, roundInfo)
      }
    })

    return allRounds
  }

  /**
   * Check if a round is ready to execute at a given slot
   */
  async isRoundReadyToExecute(round: bigint, slot?: bigint): Promise<boolean> {
    const currentSlot = slot ?? (await this.getCurrentSlot())
    const ready = await this.publicClient.readContract({
      address: this.config.tallySlashingProposerAddress,
      abi: tallySlashingProposerAbi,
      functionName: 'isRoundReadyToExecute',
      args: [round, currentSlot],
    })
    return ready as boolean
  }

  /**
   * Get the committees that would be slashed in a given round
   */
  async getSlashTargetCommittees(round: bigint): Promise<Address[][]> {
    const committees = await this.publicClient.readContract({
      address: this.config.tallySlashingProposerAddress,
      abi: tallySlashingProposerAbi,
      functionName: 'getSlashTargetCommittees',
      args: [round],
    })
    return committees as Address[][]
  }

  /**
   * Batch get committees for multiple rounds using multicall
   */
  async batchGetSlashTargetCommittees(rounds: bigint[]): Promise<Address[][][]> {
    if (rounds.length === 0) return []

    const calls = rounds.map((round) =>
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getSlashTargetCommittees', [round])
    )

    const results = await multicall(this.publicClient, calls)

    return results.map((result) => {
      if (result.success && result.data) {
        return result.data as Address[][]
      }
      return []
    })
  }

  /**
   * Get the tally (slash actions) for a round
   */
  async getTally(round: bigint, committees: Address[][]): Promise<SlashAction[]> {
    const actions = await this.publicClient.readContract({
      address: this.config.tallySlashingProposerAddress,
      abi: tallySlashingProposerAbi,
      functionName: 'getTally',
      args: [round, committees],
    })

    // Transform the result to our SlashAction type
    return (actions as any[]).map((action) => ({
      validator: action.validator as Address,
      slashAmount: action.slashAmount as bigint,
    }))
  }

  /**
   * Batch get tallies for multiple rounds using multicall
   */
  async batchGetTally(roundsWithCommittees: Array<{ round: bigint; committees: Address[][] }>): Promise<SlashAction[][]> {
    if (roundsWithCommittees.length === 0) return []

    const calls = roundsWithCommittees.map(({ round, committees }) =>
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getTally', [round, committees])
    )

    const results = await multicall(this.publicClient, calls)

    return results.map((result) => {
      if (result.success && result.data) {
        return (result.data as any[]).map((action) => ({
          validator: action.validator as Address,
          slashAmount: action.slashAmount as bigint,
        }))
      }
      return []
    })
  }

  /**
   * Get the precomputed payload address for a round
   * This is the deterministic CREATE2 address that will be deployed
   */
  async getPayloadAddress(round: bigint, actions: SlashAction[]): Promise<Address> {
    if (actions.length === 0) {
      return '0x0000000000000000000000000000000000000000'
    }

    const address = await this.publicClient.readContract({
      address: this.config.tallySlashingProposerAddress,
      abi: tallySlashingProposerAbi,
      functionName: 'getPayloadAddress',
      args: [round, actions as readonly { validator: Address; slashAmount: bigint }[]],
    })
    return address as Address
  }

  /**
   * Batch get payload addresses for multiple rounds using multicall
   */
  async batchGetPayloadAddress(roundsWithActions: Array<{ round: bigint; actions: SlashAction[] }>): Promise<Address[]> {
    if (roundsWithActions.length === 0) return []

    const calls = roundsWithActions.map(({ round, actions }) => {
      if (actions.length === 0) {
        // Return null call for empty actions - we'll handle this below
        return null
      }
      return createCall(
        this.config.tallySlashingProposerAddress,
        tallySlashingProposerAbi,
        'getPayloadAddress',
        [round, actions as readonly { validator: Address; slashAmount: bigint }[]]
      )
    })

    // Filter out null calls and track indices
    const validCalls: ReturnType<typeof createCall>[] = []
    const validIndices: number[] = []
    calls.forEach((call, i) => {
      if (call) {
        validCalls.push(call)
        validIndices.push(i)
      }
    })

    const results = validCalls.length > 0 ? await multicall(this.publicClient, validCalls) : []

    // Map results back to original indices
    const addresses: Address[] = new Array(roundsWithActions.length).fill('0x0000000000000000000000000000000000000000')
    results.forEach((result, i) => {
      const originalIndex = validIndices[i]
      if (result.success && result.data) {
        addresses[originalIndex] = result.data as Address
      }
    })

    return addresses
  }

  /**
   * Check if a payload has been vetoed
   */
  async isPayloadVetoed(payloadAddress: Address): Promise<boolean> {
    const vetoed = await this.publicClient.readContract({
      address: this.config.slasherAddress,
      abi: slasherAbi,
      functionName: 'vetoedPayloads',
      args: [payloadAddress],
    })
    return vetoed as boolean
  }

  /**
   * Batch check if multiple payloads have been vetoed using multicall
   */
  async batchIsPayloadVetoed(payloadAddresses: Address[]): Promise<boolean[]> {
    if (payloadAddresses.length === 0) return []

    const calls = payloadAddresses.map((address) =>
      createCall(this.config.slasherAddress, slasherAbi, 'vetoedPayloads', [address])
    )

    const results = await multicall(this.publicClient, calls)

    return results.map((result) => {
      if (result.success && result.data !== undefined) {
        return result.data as boolean
      }
      return false
    })
  }

  /**
   * Batch get payload addresses AND veto statuses in a single multicall
   * This combines two separate calls into one for better performance
   */
  async batchGetPayloadAddressesAndVetoStatus(
    roundsWithActions: Array<{ round: bigint; actions: SlashAction[] }>
  ): Promise<Array<{ payloadAddress: Address; isVetoed: boolean }>> {
    if (roundsWithActions.length === 0) return []

    // Build all calls: payload addresses first, then veto statuses
    const calls: ReturnType<typeof createCall>[] = []
    const payloadIndices: number[] = []

    // Add payload address calls
    roundsWithActions.forEach((item, i) => {
      if (item.actions.length === 0) {
        // Track that this index has no payload
        calls.push(null as any) // Placeholder
      } else {
        payloadIndices.push(i)
        calls.push(
          createCall(
            this.config.tallySlashingProposerAddress,
            tallySlashingProposerAbi,
            'getPayloadAddress',
            [item.round, item.actions as readonly { validator: Address; slashAmount: bigint }[]]
          )
        )
      }
    })

    // Filter out null placeholders
    const validPayloadCalls = calls.filter(call => call !== null)

    // Execute all payload address calls
    const payloadResults = validPayloadCalls.length > 0
      ? await multicall(this.publicClient, validPayloadCalls)
      : []

    // Extract payload addresses
    const payloadAddresses: Address[] = new Array(roundsWithActions.length).fill('0x0000000000000000000000000000000000000000')
    payloadResults.forEach((result, i) => {
      const originalIndex = payloadIndices[i]
      if (result.success && result.data) {
        payloadAddresses[originalIndex] = result.data as Address
      }
    })

    // Now build veto status calls for all payloads (including zero addresses)
    const vetoStatusCalls = payloadAddresses.map((address) =>
      createCall(this.config.slasherAddress, slasherAbi, 'vetoedPayloads', [address])
    )

    // Execute all veto status calls in the same or separate multicall
    const vetoResults = await multicall(this.publicClient, vetoStatusCalls)

    // Combine results
    return roundsWithActions.map((_, i) => ({
      payloadAddress: payloadAddresses[i],
      isVetoed: vetoResults[i].success && vetoResults[i].data !== undefined
        ? (vetoResults[i].data as boolean)
        : false
    }))
  }

  /**
   * OPTIMIZED: Batch get payload addresses AND veto statuses in a SINGLE multicall
   * Combines all calls (payload addresses + veto checks) into one RPC request
   */
  async batchGetPayloadAddressesAndVetoStatusOptimized(
    roundsWithActions: Array<{ round: bigint; actions: SlashAction[] }>
  ): Promise<Array<{ payloadAddress: Address; isVetoed: boolean }>> {
    if (roundsWithActions.length === 0) return []

    const allCalls: ReturnType<typeof createCall>[] = []
    const payloadCallIndices: number[] = []

    // Step 1: Add payload address calls (skip empty actions)
    roundsWithActions.forEach((item, i) => {
      if (item.actions.length > 0) {
        payloadCallIndices.push(i)
        allCalls.push(
          createCall(
            this.config.tallySlashingProposerAddress,
            tallySlashingProposerAbi,
            'getPayloadAddress',
            [item.round, item.actions as readonly { validator: Address; slashAmount: bigint }[]]
          )
        )
      }
    })

    // Step 2: We need payload addresses before we can check veto status
    // So we still need 2 multicalls, but we've eliminated individual calls
    if (allCalls.length === 0) {
      return roundsWithActions.map(() => ({
        payloadAddress: '0x0000000000000000000000000000000000000000' as Address,
        isVetoed: false
      }))
    }

    // Execute payload address calls
    const payloadResults = await multicall(this.publicClient, allCalls)

    // Extract payload addresses
    const payloadAddresses: Address[] = new Array(roundsWithActions.length).fill('0x0000000000000000000000000000000000000000')
    payloadResults.forEach((result, i) => {
      const originalIndex = payloadCallIndices[i]
      if (result.success && result.data) {
        payloadAddresses[originalIndex] = result.data as Address
      }
    })

    // Build veto status calls
    const vetoStatusCalls = payloadAddresses.map((address) =>
      createCall(this.config.slasherAddress, slasherAbi, 'vetoedPayloads', [address])
    )

    // Execute veto status calls
    const vetoResults = await multicall(this.publicClient, vetoStatusCalls)

    // Combine results
    return roundsWithActions.map((_, i) => ({
      payloadAddress: payloadAddresses[i],
      isVetoed: vetoResults[i].success && vetoResults[i].data !== undefined
        ? (vetoResults[i].data as boolean)
        : false
    }))
  }

  /**
   * Check if slashing is currently enabled
   */
  async isSlashingEnabled(): Promise<boolean> {
    const enabled = await this.publicClient.readContract({
      address: this.config.slasherAddress,
      abi: slasherAbi,
      functionName: 'isSlashingEnabled',
    })
    return enabled as boolean
  }

  /**
   * Load contract parameters from L1 using multicall (1 RPC call instead of 9)
   */
  async loadContractParameters(): Promise<Partial<SlashingMonitorConfig>> {
    // Batch all parameter reads into a single multicall
    const calls = [
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'QUORUM'),
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'ROUND_SIZE'),
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'ROUND_SIZE_IN_EPOCHS'),
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'EXECUTION_DELAY_IN_ROUNDS'),
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'LIFETIME_IN_ROUNDS'),
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'SLASH_OFFSET_IN_ROUNDS'),
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'COMMITTEE_SIZE'),
      createCall(this.config.rollupAddress, rollupAbi, 'getSlotDuration'),
      createCall(this.config.rollupAddress, rollupAbi, 'getEpochDuration'),
    ]

    const results = await multicall(this.publicClient, calls)

    return {
      quorum: Number(results[0].data),
      slashingRoundSize: Number(results[1].data),
      slashingRoundSizeInEpochs: Number(results[2].data),
      executionDelayInRounds: Number(results[3].data),
      lifetimeInRounds: Number(results[4].data),
      slashOffsetInRounds: Number(results[5].data),
      committeeSize: Number(results[6].data),
      slotDuration: Number(results[7].data),
      epochDuration: Number(results[8].data),
    }
  }
}
