import type { Address } from 'viem'
import { L1Monitor } from './l1Monitor'
import { NodeRpcClient } from './nodeRpcClient'
import type {
  DetectedSlashing,
  RoundStatus,
  SlashingMonitorConfig,
  SlashAction,
} from '@/types/slashing'

/**
 * Slashing Detector combines L1 and L2 data to detect slashing rounds
 */
export class SlashingDetector {
  private config: SlashingMonitorConfig
  private l1Monitor: L1Monitor
  private nodeRpc: NodeRpcClient

  constructor(config: SlashingMonitorConfig, l1Monitor: L1Monitor, nodeRpc: NodeRpcClient) {
    this.config = config
    this.l1Monitor = l1Monitor
    this.nodeRpc = nodeRpc
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

    // Calculate when this round ends
    const roundEndSlot = (round + 1n) * roundSize - 1n

    // Check if expired
    if (roundsSinceEnd > lifetime) {
      return 'expired'
    }

    // Check if executable (past execution delay but within lifetime)
    if (roundsSinceEnd > executionDelay && roundsSinceEnd <= lifetime) {
      return 'executable'
    }

    // Check if in veto window (exactly at execution delay)
    if (roundsSinceEnd === executionDelay) {
      return 'in-veto-window'
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
        // Get committees and tally
        const committees = await this.l1Monitor.getSlashTargetCommittees(round)
        const slashActions = await this.l1Monitor.getTally(round, committees)

        // If no slashing actions, skip
        if (slashActions.length === 0) {
          return null
        }

        // Get payload address
        const payloadAddress = await this.l1Monitor.getPayloadAddress(round, slashActions)

        // Check if vetoed
        const isVetoed = await this.l1Monitor.isPayloadVetoed(payloadAddress)

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
   * This checks:
   * 1. Current round and recent rounds (for early quorum detection)
   * 2. Rounds in execution delay period (quorum-reached, awaiting execution)
   * 3. Executable rounds (past execution delay, within lifetime)
   */
  async detectExecutableRounds(): Promise<DetectedSlashing[]> {
    const currentRound = await this.l1Monitor.getCurrentRound()
    const currentSlot = await this.l1Monitor.getCurrentSlot()

    const executionDelay = BigInt(this.config.executionDelayInRounds)
    const lifetime = BigInt(this.config.lifetimeInRounds)

    const detections: DetectedSlashing[] = []

    // 1. Check current round and rounds in execution delay period
    //    These provide early warnings when quorum is reached
    //    Go from (currentRound - executionDelay + 1) to currentRound
    const earlyWarningStart = currentRound - executionDelay + 1n
    const earlyWarningEnd = currentRound // Don't check future rounds - they don't exist yet!

    for (let round = earlyWarningStart; round <= earlyWarningEnd; round++) {
      if (round < 0n) continue

      const detected = await this.detectRound(round, currentRound, currentSlot)

      // Show rounds with any votes, not just those with slash actions
      if (detected && detected.voteCount > 0n) {
        detections.push(detected)
      }
    }

    // 2. Check executable rounds (past execution delay, within lifetime)
    //    These are rounds that can be executed or are in veto window
    //    Only check non-executed rounds to minimize RPC calls
    const executableStart = currentRound - lifetime
    const executableEnd = currentRound - executionDelay

    for (let round = executableStart; round <= executableEnd; round++) {
      if (round < 0n) continue

      // Skip if we already checked this round in early warning
      if (round >= earlyWarningStart && round <= earlyWarningEnd) {
        continue
      }

      const detected = await this.detectRound(round, currentRound, currentSlot)
      // Only show if there are actual slash actions and NOT executed
      if (detected && !detected.isExecuted && detected.slashActions && detected.slashActions.length > 0) {
        detections.push(detected)
      }
    }

    // 3. Check for the 3 most recent executed rounds (for verification purposes)
    //    Scan backwards from the end of executable period to find executed rounds
    let executedFound = 0
    const maxExecutedToShow = 3

    for (let round = executableEnd; round >= 0n && executedFound < maxExecutedToShow; round--) {
      // Skip if we already checked this round
      if (round >= earlyWarningStart && round <= earlyWarningEnd) {
        continue
      }

      const detected = await this.detectRound(round, currentRound, currentSlot)
      if (detected && detected.status === 'executed') {
        detections.push(detected)
        executedFound++
      }
    }

    return detections
  }
}

/**
 * Create a slashing detector instance
 */
export function createSlashingDetector(
  config: SlashingMonitorConfig,
  l1Monitor: L1Monitor,
  nodeRpc: NodeRpcClient
): SlashingDetector {
  return new SlashingDetector(config, l1Monitor, nodeRpc)
}
