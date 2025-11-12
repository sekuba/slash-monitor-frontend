import type { Address } from 'viem'
import { L1Monitor } from './l1Monitor'
import type {
  DetectedSlashing,
  RoundStatus,
  SlashingMonitorConfig,
  SlashAction,
  RoundInfo,
} from '@/types/slashing'

interface DetailedRoundCache {
  voteCount: bigint
  committees: Address[][]
  slashActions: SlashAction[]
  payloadAddress: Address
  isVetoed: boolean
  timestamp: number
}

/**
 * Slashing Detector combines L1 and L2 data to detect slashing rounds
 */
export class SlashingDetector {
  private config: SlashingMonitorConfig
  private l1Monitor: L1Monitor
  private detailsCache: Map<string, DetailedRoundCache> = new Map()
  private detailsCacheTTL: number

  constructor(config: SlashingMonitorConfig, l1Monitor: L1Monitor) {
    this.config = config
    this.l1Monitor = l1Monitor
    this.detailsCacheTTL = config.detailsCacheTTL
  }

  /**
   * Get cached detailed round data if still valid and voteCount matches
   */
  private getCachedDetails(round: bigint, voteCount: bigint): DetailedRoundCache | null {
    const cached = this.detailsCache.get(round.toString())
    if (!cached) return null

    // Cache invalid if voteCount changed (new votes came in)
    if (cached.voteCount !== voteCount) {
      this.detailsCache.delete(round.toString())
      return null
    }

    // Cache expired
    const age = Date.now() - cached.timestamp
    if (age > this.detailsCacheTTL) {
      this.detailsCache.delete(round.toString())
      return null
    }

    return cached
  }

  /**
   * Store detailed round data in cache
   */
  private setCachedDetails(round: bigint, data: DetailedRoundCache) {
    this.detailsCache.set(round.toString(), data)
  }

  /**
   * Calculate the round status based on current round and execution timing
   */
  calculateRoundStatus(
    round: bigint,
    currentRound: bigint,
    currentSlot: bigint,
    isExecuted: boolean,
    hasQuorum: boolean
  ): RoundStatus {
    if (isExecuted) {
      return 'executed'
    }

    const roundsSinceEnd = currentRound - round
    const executionDelay = BigInt(this.config.executionDelayInRounds)
    const lifetime = BigInt(this.config.lifetimeInRounds)
    const roundSize = BigInt(this.config.slashingRoundSize)

    // Calculate when this round ends and when it becomes executable
    const roundEndSlot = (round + 1n) * roundSize - 1n
    const executableSlot = this.calculateExecutableSlot(round)

    // Check if expired
    if (roundsSinceEnd > lifetime) {
      return 'expired'
    }

    // Check if executable (past execution delay but within lifetime)
    // IMPORTANT: Also verify that current slot has actually reached the executable slot
    if (roundsSinceEnd > executionDelay && roundsSinceEnd <= lifetime) {
      // Only mark as executable if we've actually reached the executable slot
      if (currentSlot >= executableSlot) {
        return 'executable'
      }
      // Round-based timing says it should be executable, but slot hasn't been reached yet
      return hasQuorum ? 'quorum-reached' : 'voting'
    }

    // Check if in veto window (exactly at execution delay)
    // IMPORTANT: Also verify that current slot has actually reached the executable slot
    if (roundsSinceEnd === executionDelay) {
      // Only mark as in veto window if we've actually reached the executable slot
      if (currentSlot >= executableSlot) {
        return 'in-veto-window'
      }
      // Round-based timing says it should be in veto window, but slot hasn't been reached yet
      return hasQuorum ? 'quorum-reached' : 'voting'
    }

    // If we haven't reached execution delay yet
    if (roundsSinceEnd < executionDelay) {
      // If round is still ongoing (current slot is within the round)
      if (currentSlot <= roundEndSlot) {
        return hasQuorum ? 'quorum-reached' : 'voting'
      }
      // Round ended but waiting for execution delay
      return hasQuorum ? 'quorum-reached' : 'voting'
    }

    // Default fallback
    return 'voting'
  }

  /**
   * Calculate when a round becomes executable (in slots)
   */
  calculateExecutableSlot(round: bigint): bigint {
    const roundSize = BigInt(this.config.slashingRoundSize)
    const executionDelay = BigInt(this.config.executionDelayInRounds)

    // Round ends at: (round + 1) * roundSize
    // Becomes executable after: executionDelay more rounds
    return (round + 1n + executionDelay) * roundSize
  }

  /**
   * Calculate when a round expires (in slots)
   */
  calculateExpirySlot(round: bigint): bigint {
    const roundSize = BigInt(this.config.slashingRoundSize)
    const lifetime = BigInt(this.config.lifetimeInRounds)

    return (round + 1n + lifetime) * roundSize
  }

  /**
   * Calculate seconds until a given slot
   */
  calculateSecondsUntilSlot(targetSlot: bigint, currentSlot: bigint): number {
    if (targetSlot <= currentSlot) {
      return 0
    }
    const slotDifference = Number(targetSlot - currentSlot)
    return slotDifference * this.config.slotDuration
  }

  /**
   * Get the epochs that would be slashed in a given round
   */
  getTargetEpochs(round: bigint): bigint[] {
    const roundSizeInEpochs = BigInt(this.config.slashingRoundSizeInEpochs)
    const slashOffset = BigInt(this.config.slashOffsetInRounds)

    // The epochs slashed in round R are from round (R - SLASH_OFFSET)
    const targetRound = round - slashOffset
    const startEpoch = targetRound * roundSizeInEpochs

    const epochs: bigint[] = []
    for (let i = 0n; i < roundSizeInEpochs; i++) {
      epochs.push(startEpoch + i)
    }

    return epochs
  }

  /**
   * Detect a single round and return complete information
   */
  async detectRound(round: bigint, currentRound: bigint, currentSlot: bigint): Promise<DetectedSlashing | null> {
    try {
      // Get round info from L1
      const roundInfo = await this.l1Monitor.getRound(round)

      // Check if quorum reached
      const hasQuorum = roundInfo.voteCount >= this.config.quorum

      // Calculate status
      const status = this.calculateRoundStatus(round, currentRound, currentSlot, roundInfo.isExecuted, hasQuorum)

      // Base detection info
      const detected: DetectedSlashing = {
        round,
        status,
        voteCount: roundInfo.voteCount,
        isExecuted: roundInfo.isExecuted,
        isVetoed: false,
      }

      // Compute detailed info if:
      // 1. Quorum reached (even during voting/waiting)
      // 2. OR in veto window or executable
      // 3. OR already executed (for verification purposes)
      const shouldComputeDetails =
        (hasQuorum && (status === 'quorum-reached' || status === 'in-veto-window' || status === 'executable')) ||
        status === 'executed'

      if (shouldComputeDetails) {
        // Check cache first (only if voteCount hasn't changed)
        const cachedDetails = this.getCachedDetails(round, roundInfo.voteCount)

        let committees: Address[][]
        let slashActions: SlashAction[]
        let payloadAddress: Address
        let isVetoed: boolean

        if (cachedDetails) {
          // Use cached data
          committees = cachedDetails.committees
          slashActions = cachedDetails.slashActions
          payloadAddress = cachedDetails.payloadAddress
          isVetoed = cachedDetails.isVetoed
        } else {
          // Fetch details from L1
          committees = await this.l1Monitor.getSlashTargetCommittees(round)
          slashActions = await this.l1Monitor.getTally(round, committees)

          // If no slashing actions, skip
          if (slashActions.length === 0) {
            return null
          }

          // Get payload address
          payloadAddress = await this.l1Monitor.getPayloadAddress(round, slashActions)

          // Check if vetoed
          isVetoed = await this.l1Monitor.isPayloadVetoed(payloadAddress)

          // Cache the details
          this.setCachedDetails(round, {
            voteCount: roundInfo.voteCount,
            committees,
            slashActions,
            payloadAddress,
            isVetoed,
            timestamp: Date.now(),
          })
        }

        // Calculate timing
        const executableSlot = this.calculateExecutableSlot(round)
        const expirySlot = this.calculateExpirySlot(round)
        const secondsUntilExecutable = this.calculateSecondsUntilSlot(executableSlot, currentSlot)
        const secondsUntilExpires = this.calculateSecondsUntilSlot(expirySlot, currentSlot)

        // Calculate totals
        const totalSlashAmount = slashActions.reduce((sum, action) => sum + action.slashAmount, 0n)
        const affectedValidatorCount = slashActions.length

        // Get target epochs
        const targetEpochs = this.getTargetEpochs(round)

        return {
          ...detected,
          committees,
          slashActions,
          payloadAddress,
          isVetoed,
          slotWhenExecutable: executableSlot,
          slotWhenExpires: expirySlot,
          secondsUntilExecutable,
          secondsUntilExpires,
          lastUpdatedTimestamp: Date.now(),
          targetEpochs,
          totalSlashAmount,
          affectedValidatorCount,
        }
      }

      return detected
    } catch (error) {
      console.error(`Error detecting round ${round}:`, error)
      return null
    }
  }

  /**
   * Detect all rounds with slashings (including early warnings and executable rounds)
   * Optimized version with batching and smart scanning
   *
   * This checks:
   * 1. Current round and recent rounds (for early quorum detection)
   * 2. Rounds in execution delay period (quorum-reached, awaiting execution)
   * 3. Executable rounds (past execution delay, within lifetime)
   * 4. Up to 3 most recent executed rounds (for verification purposes)
   *
   * @param currentRound - Current round from L1 (passed in to avoid re-fetching)
   * @param currentSlot - Current slot from L1 (passed in to avoid re-fetching)
   */
  async detectExecutableRounds(currentRound: bigint, currentSlot: bigint): Promise<DetectedSlashing[]> {
    const executionDelay = BigInt(this.config.executionDelayInRounds)
    const lifetime = BigInt(this.config.lifetimeInRounds)

    // Calculate the complete slashing period (26 rounds back from current)
    // This includes: current round + execution delay period + executable period
    const slashingPeriodSize = executionDelay + lifetime + 1n // +1 for current round
    const slashingPeriodStart = currentRound - slashingPeriodSize + 1n

    console.log(`[Detection] Scanning rounds: current=${currentRound}, period size=${slashingPeriodSize}`)

    // 1. Collect all rounds we want to check in the active slashing period
    const roundsToCheck: bigint[] = []

    // Early warning rounds (current round down to executable boundary)
    const earlyWarningStart = currentRound - executionDelay + 1n
    const earlyWarningEnd = currentRound

    for (let round = earlyWarningStart; round <= earlyWarningEnd; round++) {
      if (round >= 0n) {
        roundsToCheck.push(round)
      }
    }

    // Executable rounds (within lifetime, past execution delay)
    const executableStart = currentRound - lifetime
    const executableEnd = currentRound - executionDelay

    for (let round = executableStart; round <= executableEnd; round++) {
      if (round >= 0n && round < earlyWarningStart) {
        roundsToCheck.push(round)
      }
    }

    // 2. Batch fetch all round info using multicall
    console.log(`[Detection] Fetching ${roundsToCheck.length} rounds via multicall`)
    const roundInfoMap = await this.l1Monitor.getRounds(roundsToCheck)

    // 3. First pass: determine which rounds need details and check cache
    interface RoundToProcess {
      round: bigint
      roundInfo: RoundInfo
      status: RoundStatus
      hasQuorum: boolean
    }

    const roundsNeedingDetails: RoundToProcess[] = []
    const roundsWithDetails: Map<bigint, DetectedSlashing> = new Map()
    const simpleRounds: DetectedSlashing[] = []

    for (const round of roundsToCheck) {
      const roundInfo = roundInfoMap.get(round)
      if (!roundInfo) continue

      const hasQuorum = roundInfo.voteCount >= this.config.quorum
      const status = this.calculateRoundStatus(round, currentRound, currentSlot, roundInfo.isExecuted, hasQuorum)

      // Base detection info
      const detected: DetectedSlashing = {
        round,
        status,
        voteCount: roundInfo.voteCount,
        isExecuted: roundInfo.isExecuted,
        isVetoed: false,
      }

      // Determine if we should fetch detailed info
      const shouldComputeDetails =
        (hasQuorum && (status === 'quorum-reached' || status === 'in-veto-window' || status === 'executable')) ||
        status === 'executed'

      if (!shouldComputeDetails) {
        // Only include if it has votes (for early warning)
        if (roundInfo.voteCount > 0n) {
          simpleRounds.push(detected)
        }
        continue
      }

      // Check cache first
      const cachedDetails = this.getCachedDetails(round, roundInfo.voteCount)
      if (cachedDetails) {
        // Use cached data immediately
        const executableSlot = this.calculateExecutableSlot(round)
        const expirySlot = this.calculateExpirySlot(round)
        const secondsUntilExecutable = this.calculateSecondsUntilSlot(executableSlot, currentSlot)
        const secondsUntilExpires = this.calculateSecondsUntilSlot(expirySlot, currentSlot)
        const totalSlashAmount = cachedDetails.slashActions.reduce((sum, action) => sum + action.slashAmount, 0n)
        const targetEpochs = this.getTargetEpochs(round)

        roundsWithDetails.set(round, {
          ...detected,
          committees: cachedDetails.committees,
          slashActions: cachedDetails.slashActions,
          payloadAddress: cachedDetails.payloadAddress,
          isVetoed: cachedDetails.isVetoed,
          slotWhenExecutable: executableSlot,
          slotWhenExpires: expirySlot,
          secondsUntilExecutable,
          secondsUntilExpires,
          lastUpdatedTimestamp: Date.now(),
          targetEpochs,
          totalSlashAmount,
          affectedValidatorCount: cachedDetails.slashActions.length,
        })
      } else {
        roundsNeedingDetails.push({ round, roundInfo, status, hasQuorum })
      }
    }

    // 4. Batch fetch ALL details for all uncached rounds using multicalls
    if (roundsNeedingDetails.length > 0) {
      console.log(`[Detection] Batch fetching details for ${roundsNeedingDetails.length} rounds (uncached)`)

      try {
        // Step 1: Batch fetch committees for all rounds (1 multicall)
        const allCommittees = await this.l1Monitor.batchGetSlashTargetCommittees(
          roundsNeedingDetails.map(r => r.round)
        )

        // Step 2: Batch fetch tallies for all rounds (1 multicall)
        const roundsWithCommittees = roundsNeedingDetails.map((r, i) => ({
          round: r.round,
          committees: allCommittees[i],
        }))
        const allTallies = await this.l1Monitor.batchGetTally(roundsWithCommittees)

        // Filter out rounds with no slash actions
        const roundsWithActions = roundsNeedingDetails
          .map((r, i) => ({
            roundData: r,
            committees: allCommittees[i],
            slashActions: allTallies[i],
            index: i,
          }))
          .filter(item => item.slashActions.length > 0)

        if (roundsWithActions.length === 0) {
          console.log('[Detection] No rounds with slash actions found')
          // No further processing needed
        } else {
          // Step 3: Batch fetch payload addresses for rounds with actions (1 multicall)
          const allPayloadAddresses = await this.l1Monitor.batchGetPayloadAddress(
            roundsWithActions.map(item => ({
              round: item.roundData.round,
              actions: item.slashActions,
            }))
          )

          // Step 4: Batch fetch veto status for all payloads (1 multicall)
          const allVetoStatuses = await this.l1Monitor.batchIsPayloadVetoed(allPayloadAddresses)

          // Step 5: Process all results
          roundsWithActions.forEach((item, resultIndex) => {
            const { roundData, committees, slashActions } = item
            const { round, roundInfo, status } = roundData
            const payloadAddress = allPayloadAddresses[resultIndex]
            const isVetoed = allVetoStatuses[resultIndex]

            // Cache the details
            this.setCachedDetails(round, {
              voteCount: roundInfo.voteCount,
              committees,
              slashActions,
              payloadAddress,
              isVetoed,
              timestamp: Date.now(),
            })

            // Calculate timing
            const executableSlot = this.calculateExecutableSlot(round)
            const expirySlot = this.calculateExpirySlot(round)
            const secondsUntilExecutable = this.calculateSecondsUntilSlot(executableSlot, currentSlot)
            const secondsUntilExpires = this.calculateSecondsUntilSlot(expirySlot, currentSlot)
            const totalSlashAmount = slashActions.reduce((sum, action) => sum + action.slashAmount, 0n)
            const targetEpochs = this.getTargetEpochs(round)

            roundsWithDetails.set(round, {
              round,
              status,
              voteCount: roundInfo.voteCount,
              isExecuted: roundInfo.isExecuted,
              isVetoed,
              committees,
              slashActions,
              payloadAddress,
              slotWhenExecutable: executableSlot,
              slotWhenExpires: expirySlot,
              secondsUntilExecutable,
              secondsUntilExpires,
              lastUpdatedTimestamp: Date.now(),
              targetEpochs,
              totalSlashAmount,
              affectedValidatorCount: slashActions.length,
            })
          })

          console.log(`[Detection] Successfully processed ${roundsWithActions.length} rounds with details`)
        }
      } catch (error) {
        console.error('Error batch fetching details:', error)
      }
    }

    // Combine all results
    const validDetections = [
      ...simpleRounds,
      ...Array.from(roundsWithDetails.values()),
    ]

    // 4. Find most recent executed rounds (configurable limit)
    //    Limit scan to a reasonable window before the slashing period
    const maxExecutedToShow = this.config.maxExecutedRoundsToShow
    const maxRoundsToScanForExecuted = this.config.maxRoundsToScanForHistory
    const executedScanStart = Math.max(0, Number(slashingPeriodStart) - maxRoundsToScanForExecuted)
    const executedScanEnd = slashingPeriodStart - 1n

    if (executedScanEnd >= 0n && executedScanStart < Number(executedScanEnd)) {
      const executedRoundsToCheck: bigint[] = []
      for (let round = executedScanEnd; round >= BigInt(executedScanStart); round--) {
        executedRoundsToCheck.push(round)
      }

      // Batch fetch executed rounds
      const executedRoundInfoMap = await this.l1Monitor.getRounds(executedRoundsToCheck)

      // Find executed rounds (check in order, stop after finding maxExecutedToShow)
      let executedFound = 0
      for (const round of executedRoundsToCheck) {
        if (executedFound >= maxExecutedToShow) break

        const roundInfo = executedRoundInfoMap.get(round)
        if (roundInfo && roundInfo.isExecuted) {
          // Only fetch full details for executed rounds with votes
          if (roundInfo.voteCount > 0n) {
            try {
              const detected = await this.detectRound(round, currentRound, currentSlot)
              if (detected && detected.status === 'executed' && detected.slashActions && detected.slashActions.length > 0) {
                validDetections.push(detected)
                executedFound++
              }
            } catch (error) {
              console.error(`Error detecting executed round ${round}:`, error)
            }
          }
        }
      }
    }

    return validDetections.sort((a, b) => Number(b.round - a.round))
  }
}
