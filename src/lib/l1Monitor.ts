import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from 'viem'
import { tallySlashingProposerAbi } from './contracts/tallySlashingProposerAbi'
import { slasherAbi } from './contracts/slasherAbi'
import { rollupAbi } from './contracts/rollupAbi'
import { multicall, createCall } from './multicall'
import type {
  SlashAction,
  RoundInfo,
  VoteCastEvent,
  RoundExecutedEvent,
  SlashingMonitorConfig,
} from '@/types/slashing'

interface CachedRoundData {
  data: RoundInfo
  timestamp: number
  blockNumber?: bigint
}

/**
 * L1 Monitor for tracking slashing-related events and contract state
 */
export class L1Monitor {
  private publicClient: PublicClient
  private config: SlashingMonitorConfig
  private roundCache: Map<string, CachedRoundData> = new Map()
  private cacheTTL: number = 30000 // 30 seconds cache TTL

  constructor(config: SlashingMonitorConfig) {
    this.config = config

    // Create public client for reading
    this.publicClient = createPublicClient({
      transport: http(config.l1RpcUrl),
    })
  }

  /**
   * Clear cache for a specific round or all rounds
   */
  clearCache(round?: bigint) {
    if (round !== undefined) {
      this.roundCache.delete(round.toString())
    } else {
      this.roundCache.clear()
    }
  }

  /**
   * Get cached round data if still valid
   */
  private getCachedRound(round: bigint): RoundInfo | null {
    const cached = this.roundCache.get(round.toString())
    if (!cached) return null

    const age = Date.now() - cached.timestamp
    if (age > this.cacheTTL) {
      this.roundCache.delete(round.toString())
      return null
    }

    return cached.data
  }

  /**
   * Store round data in cache
   */
  private setCachedRound(round: bigint, data: RoundInfo) {
    this.roundCache.set(round.toString(), {
      data,
      timestamp: Date.now(),
    })
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
   * Get current state (round, slot, epoch, slashing enabled) in a single multicall
   * This replaces 4 separate RPC calls with 1
   */
  async getCurrentState(): Promise<{
    currentRound: bigint
    currentSlot: bigint
    currentEpoch: bigint
    isSlashingEnabled: boolean
  }> {
    const calls = [
      createCall(this.config.tallySlashingProposerAddress, tallySlashingProposerAbi, 'getCurrentRound'),
      createCall(this.config.rollupAddress, rollupAbi, 'getCurrentSlot'),
      createCall(this.config.rollupAddress, rollupAbi, 'getCurrentEpoch'),
      createCall(this.config.slasherAddress, slasherAbi, 'isSlashingEnabled'),
    ]

    const results = await multicall(this.publicClient, calls)

    return {
      currentRound: results[0].data as bigint,
      currentSlot: results[1].data as bigint,
      currentEpoch: results[2].data as bigint,
      isSlashingEnabled: results[3].data as boolean,
    }
  }

  /**
   * Get information about a specific round (with caching)
   */
  async getRound(round: bigint, skipCache = false): Promise<RoundInfo> {
    // Check cache first
    if (!skipCache) {
      const cached = this.getCachedRound(round)
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
    this.setCachedRound(round, roundInfo)

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
      const cached = this.getCachedRound(round)
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

        this.setCachedRound(round, roundInfo)
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
   * Load contract parameters from L1
   */
  async loadContractParameters(): Promise<Partial<SlashingMonitorConfig>> {
    const [
      quorum,
      roundSize,
      roundSizeInEpochs,
      executionDelayInRounds,
      lifetimeInRounds,
      slashOffsetInRounds,
      committeeSize,
      slashAmountSmall,
      slashAmountMedium,
      slashAmountLarge,
      slotDuration,
      epochDuration,
    ] = await Promise.all([
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'QUORUM',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'ROUND_SIZE',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'ROUND_SIZE_IN_EPOCHS',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'EXECUTION_DELAY_IN_ROUNDS',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'LIFETIME_IN_ROUNDS',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'SLASH_OFFSET_IN_ROUNDS',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'COMMITTEE_SIZE',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'SLASH_AMOUNT_SMALL',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'SLASH_AMOUNT_MEDIUM',
      }),
      this.publicClient.readContract({
        address: this.config.tallySlashingProposerAddress,
        abi: tallySlashingProposerAbi,
        functionName: 'SLASH_AMOUNT_LARGE',
      }),
      this.publicClient.readContract({
        address: this.config.rollupAddress,
        abi: rollupAbi,
        functionName: 'getSlotDuration',
      }),
      this.publicClient.readContract({
        address: this.config.rollupAddress,
        abi: rollupAbi,
        functionName: 'getEpochDuration',
      }),
    ])

    return {
      quorum: Number(quorum),
      slashingRoundSize: Number(roundSize),
      slashingRoundSizeInEpochs: Number(roundSizeInEpochs),
      executionDelayInRounds: Number(executionDelayInRounds),
      lifetimeInRounds: Number(lifetimeInRounds),
      slashOffsetInRounds: Number(slashOffsetInRounds),
      committeeSize: Number(committeeSize),
      slashAmountSmall: slashAmountSmall as bigint,
      slashAmountMedium: slashAmountMedium as bigint,
      slashAmountLarge: slashAmountLarge as bigint,
      slotDuration: Number(slotDuration),
      epochDuration: Number(epochDuration),
    }
  }

  /**
   * Watch for VoteCast events
   */
  watchVoteCastEvents(
    onEvent: (event: VoteCastEvent) => void
  ): () => void {
    const unwatch = this.publicClient.watchContractEvent({
      address: this.config.tallySlashingProposerAddress,
      abi: tallySlashingProposerAbi,
      eventName: 'VoteCast',
      onLogs: (logs) => {
        logs.forEach((log) => {
          onEvent({
            round: log.args.round as bigint,
            slot: log.args.slot as bigint,
            proposer: log.args.proposer as Address,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          })
        })
      },
    })

    return unwatch
  }

  /**
   * Watch for RoundExecuted events
   */
  watchRoundExecutedEvents(
    onEvent: (event: RoundExecutedEvent) => void
  ): () => void {
    const unwatch = this.publicClient.watchContractEvent({
      address: this.config.tallySlashingProposerAddress,
      abi: tallySlashingProposerAbi,
      eventName: 'RoundExecuted',
      onLogs: (logs) => {
        logs.forEach((log) => {
          onEvent({
            round: log.args.round as bigint,
            slashCount: log.args.slashCount as bigint,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          })
        })
      },
    })

    return unwatch
  }
}

/**
 * Create an L1 monitor instance
 */
export function createL1Monitor(config: SlashingMonitorConfig): L1Monitor {
  return new L1Monitor(config)
}
