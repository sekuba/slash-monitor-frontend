import { useEffect, useRef, useCallback } from 'react'
import { useSlashingStore } from '@/store/slashingStore'
import { L1Monitor } from '@/lib/l1Monitor'
import { NodeRpcClient } from '@/lib/nodeRpcClient'
import { SlashingDetector } from '@/lib/slashingDetector'
import {
  notifySlashingDetected,
  notifySlashingDisabled,
  notifySlashingEnabled,
} from '@/lib/notifications'
import type { SlashingMonitorConfig } from '@/types/slashing'

/**
 * Main hook for initializing and running the slashing monitor
 */
export function useSlashingMonitor(config: SlashingMonitorConfig) {
  const {
    setConfig,
    setInitialized,
    setIsScanning,
    setCurrentRound,
    setCurrentSlot,
    setCurrentEpoch,
    setSlashingEnabled,
    setSlashingDisabledUntil,
    setSlashingDisableDuration,
    addDetectedSlashing,
    setOffenses,
    updateStats,
  } = useSlashingStore()

  const l1MonitorRef = useRef<L1Monitor | null>(null)
  const nodeRpcRef = useRef<NodeRpcClient | null>(null)
  const detectorRef = useRef<SlashingDetector | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const notifiedSlashingsRef = useRef<Set<string>>(new Set()) // Track which slashings we've notified about
  const previousSlashingEnabledRef = useRef<boolean | null>(null) // Track slashing enabled status changes
  const isFirstScanRef = useRef<boolean>(true) // Track if this is the first scan

  /**
   * Initialize the monitor components
   */
  const initialize = useCallback(async () => {
    console.log('Initializing slashing monitor...')

    try {
      // Create L1 monitor
      l1MonitorRef.current = new L1Monitor(config)

      // Create Node RPC client
      nodeRpcRef.current = new NodeRpcClient(config.nodeAdminUrl)

      // Load contract parameters from L1
      const contractParams = await l1MonitorRef.current.loadContractParameters()
      const fullConfig = { ...config, ...contractParams }

      // Create detector with full config
      detectorRef.current = new SlashingDetector(fullConfig, l1MonitorRef.current)

      // Set config in store
      setConfig(fullConfig)

      // Get initial state
      const currentRound = await l1MonitorRef.current.getCurrentRound()
      const currentSlot = await l1MonitorRef.current.getCurrentSlot()
      const currentEpoch = await l1MonitorRef.current.getCurrentEpoch()
      const isEnabled = await l1MonitorRef.current.isSlashingEnabled()

      setCurrentRound(currentRound)
      setCurrentSlot(currentSlot)
      setCurrentEpoch(currentEpoch)
      setSlashingEnabled(isEnabled)

      console.log('Slashing monitor initialized', {
        currentRound: currentRound.toString(),
        currentSlot: currentSlot.toString(),
        currentEpoch: currentEpoch.toString(),
        isEnabled,
      })

      // Initialize slashing enabled tracking
      previousSlashingEnabledRef.current = isEnabled

      setInitialized(true)
    } catch (error) {
      console.error('Failed to initialize slashing monitor:', error)
      throw error
    }
  }, [config, setConfig, setInitialized, setCurrentRound, setCurrentSlot, setCurrentEpoch, setSlashingEnabled])

  /**
   * Poll for updates
   * Optimized to use multicall and pass state to detector
   */
  const poll = useCallback(async () => {
    if (!l1MonitorRef.current || !detectorRef.current || !nodeRpcRef.current) return

    try {
      // Set scanning state for first scan
      if (isFirstScanRef.current) {
        setIsScanning(true)
      }

      // Get current state in a single multicall (6 calls in 1)
      const { currentRound, currentSlot, currentEpoch, isSlashingEnabled: isEnabled, slashingDisabledUntil, slashingDisableDuration } =
        await l1MonitorRef.current.getCurrentState()

      setCurrentRound(currentRound)
      setCurrentSlot(currentSlot)
      setCurrentEpoch(currentEpoch)
      setSlashingEnabled(isEnabled)
      setSlashingDisabledUntil(slashingDisabledUntil)
      setSlashingDisableDuration(slashingDisableDuration)

      // Check for slashing enabled status changes and notify
      if (previousSlashingEnabledRef.current !== null && previousSlashingEnabledRef.current !== isEnabled) {
        if (isEnabled) {
          notifySlashingEnabled()
        } else {
          notifySlashingDisabled()
        }
      }
      previousSlashingEnabledRef.current = isEnabled

      // Detect executable rounds - pass current state to avoid re-fetching
      const detectedSlashings = await detectorRef.current.detectExecutableRounds(currentRound, currentSlot)

      // Update store with detected slashings and send notifications for new ones
      detectedSlashings.forEach((slashing) => {
        // Create a unique key for this slashing (round + status to detect status changes)
        const slashingKey = `${slashing.round}-${slashing.status}`

        // Only notify if this is NOT the first scan and this is a new slashing or if status changed to a critical state
        const isNewNotification = !notifiedSlashingsRef.current.has(slashingKey)
        const isCriticalStatus =
          slashing.status === 'quorum-reached' ||
          slashing.status === 'in-veto-window' ||
          slashing.status === 'executable'

        // Mark as notified to prevent duplicate notifications
        if (isCriticalStatus && slashing.slashActions && slashing.slashActions.length > 0) {
          if (!isFirstScanRef.current && isNewNotification) {
            notifySlashingDetected(slashing)
          }
          // Always add to notified set, even on first scan, to prevent notifications on subsequent polls
          notifiedSlashingsRef.current.add(slashingKey)
        }

        addDetectedSlashing(slashing)
      })

      // Get offenses from node
      const offenses = await nodeRpcRef.current.getSlashOffenses('all')
      setOffenses(offenses)

      // Update stats
      const activeSlashings = detectedSlashings.filter(
        (s) => s.status === 'quorum-reached' || s.status === 'in-veto-window' || s.status === 'executable'
      ).length

      const vetoedPayloads = detectedSlashings.filter((s) => s.isVetoed).length
      const executedRounds = detectedSlashings.filter((s) => s.isExecuted).length

      const totalValidatorsSlashed = detectedSlashings.reduce(
        (sum, s) => sum + (s.affectedValidatorCount ?? 0),
        0
      )

      const totalSlashAmount = detectedSlashings.reduce(
        (sum, s) => sum + (s.totalSlashAmount ?? 0n),
        0n
      )

      updateStats({
        currentRound,
        totalRoundsMonitored: detectedSlashings.length,
        activeSlashings,
        vetoedPayloads,
        executedRounds,
        totalValidatorsSlashed,
        totalSlashAmount,
      })

      // Mark first scan as complete
      if (isFirstScanRef.current) {
        console.log(`Initial scan complete: ${detectedSlashings.length} rounds detected`)
        isFirstScanRef.current = false
        setIsScanning(false)
      }

      // Log poll stats (only every 5 polls to reduce noise)
      if (Math.random() < 0.2) {
        console.log(`Poll complete: ${detectedSlashings.length} rounds, ${offenses.length} offenses`)
      }
    } catch (error) {
      console.error('Poll error:', error)
      // Also end scanning on error
      if (isFirstScanRef.current) {
        isFirstScanRef.current = false
        setIsScanning(false)
      }
    }
  }, [setCurrentRound, setCurrentSlot, setCurrentEpoch, setSlashingEnabled, setSlashingDisabledUntil, setIsScanning, addDetectedSlashing, setOffenses, updateStats])

  /**
   * Start polling
   */
  const startPolling = useCallback(() => {
    // Initial poll
    poll()

    // Set up polling interval
    intervalRef.current = setInterval(poll, config.l2PollInterval)

    console.log(`Polling started with interval ${config.l2PollInterval}ms`)
  }, [poll, config.l2PollInterval])

  /**
   * Cleanup function
   */
  const cleanup = useCallback(() => {
    console.log('Cleaning up slashing monitor...')

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Initialize and start on mount
  useEffect(() => {
    initialize().then(() => {
      startPolling()
    })

    return cleanup
  }, [initialize, startPolling, cleanup])

  return {
    l1Monitor: l1MonitorRef.current,
    nodeRpc: nodeRpcRef.current,
    detector: detectorRef.current,
  }
}
