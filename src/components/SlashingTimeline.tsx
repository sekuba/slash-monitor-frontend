import { useSlashingStore } from '@/store/slashingStore'
import { useMemo } from 'react'

interface TimelinePhase {
  name: string
  round: bigint
  startSlot: bigint
  endSlot: bigint
  targetEpochStart: bigint
  targetEpochEnd: bigint
  status: 'past' | 'current' | 'future'
  description: string
  color: string
}

export function SlashingTimeline() {
  const { config, currentRound, currentSlot, currentEpoch } = useSlashingStore()

  const timeline = useMemo(() => {
    if (!config || currentRound === null || currentSlot === null || currentEpoch === null) {
      return []
    }

    const phases: TimelinePhase[] = []
    const roundSize = BigInt(config.slashingRoundSize)
    const roundSizeInEpochs = BigInt(config.slashingRoundSizeInEpochs)
    const executionDelay = BigInt(config.executionDelayInRounds)
    const slashOffset = BigInt(config.slashOffsetInRounds)

    // Show current round + next 2 rounds
    for (let i = 0n; i <= 2n; i++) {
      const round = currentRound + i
      const roundStartSlot = round * roundSize
      const roundEndSlot = (round + 1n) * roundSize - 1n
      const vetoWindowSlot = (round + 1n + executionDelay) * roundSize
      const vetoWindowEndSlot = vetoWindowSlot + roundSize - 1n

      // Calculate target epochs for this round
      const targetRound = round - slashOffset
      const targetEpochStart = targetRound * roundSizeInEpochs
      const targetEpochEnd = targetEpochStart + roundSizeInEpochs - 1n

      // Determine status
      let status: 'past' | 'current' | 'future' = 'future'
      if (currentSlot >= vetoWindowSlot) {
        status = 'past'
      } else if (currentSlot >= roundStartSlot && currentSlot <= roundEndSlot) {
        status = 'current'
      }

      // Voting phase
      if (currentSlot <= roundEndSlot) {
        phases.push({
          name: i === 0n ? 'Current Voting Round' : `Round ${round.toString()} Voting`,
          round,
          startSlot: roundStartSlot,
          endSlot: roundEndSlot,
          targetEpochStart,
          targetEpochEnd,
          status: status === 'current' ? 'current' : currentSlot > roundEndSlot ? 'past' : 'future',
          description: `Committee members vote on slashing offenses from epochs ${targetEpochStart.toString()}-${targetEpochEnd.toString()}`,
          color: status === 'current' ? 'blue' : 'gray',
        })
      }

      // Veto window / Execution phase
      if (currentSlot <= vetoWindowEndSlot) {
        const isInVetoWindow = currentSlot >= vetoWindowSlot && currentSlot <= vetoWindowEndSlot
        phases.push({
          name: `Round ${round.toString()} Veto/Execute`,
          round,
          startSlot: vetoWindowSlot,
          endSlot: vetoWindowEndSlot,
          targetEpochStart,
          targetEpochEnd,
          status: isInVetoWindow ? 'current' : currentSlot > vetoWindowEndSlot ? 'past' : 'future',
          description: `Vetoer can veto or slashing can be executed for epochs ${targetEpochStart.toString()}-${targetEpochEnd.toString()}`,
          color: isInVetoWindow ? 'red' : 'orange',
        })
      }
    }

    return phases.filter((p) => p.status !== 'past' || p.status === 'current')
  }, [config, currentRound, currentSlot, currentEpoch])

  if (!config || currentRound === null || currentSlot === null || currentEpoch === null) {
    return null
  }

  const formatSlotToTime = (slot: bigint) => {
    const slotDiff = Number(slot - currentSlot)
    const seconds = slotDiff * config.slotDuration

    if (seconds < 0) {
      return 'Now'
    }

    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (hours > 24) {
      const days = Math.floor(hours / 24)
      const remainingHours = hours % 24
      return `~${days}d ${remainingHours}h`
    }
    if (hours > 0) {
      return `~${hours}h ${minutes}m`
    }
    return `~${minutes}m`
  }

  const getColorClasses = (color: string, isCurrent: boolean) => {
    if (isCurrent) {
      switch (color) {
        case 'blue':
          return 'bg-blue-900/40 border-blue-600 text-blue-300'
        case 'red':
          return 'bg-red-900/40 border-red-600 text-red-300'
        case 'orange':
          return 'bg-orange-900/40 border-orange-600 text-orange-300'
        default:
          return 'bg-gray-800/40 border-gray-600 text-gray-300'
      }
    }
    return 'bg-gray-900/40 border-gray-700 text-gray-400'
  }

  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
        <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        Slashing Timeline
      </h2>

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <div className="mb-4 text-sm text-gray-400">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="font-semibold text-gray-300">Current Slot:</span> {currentSlot.toString()}
            </div>
            <div>
              <span className="font-semibold text-gray-300">Current Epoch:</span> {currentEpoch.toString()}
            </div>
            <div>
              <span className="font-semibold text-gray-300">Current Round:</span> {currentRound.toString()}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {timeline.map((phase, index) => {
            const isCurrent = phase.status === 'current'
            const timeUntilStart = formatSlotToTime(phase.startSlot)
            const timeUntilEnd = formatSlotToTime(phase.endSlot)

            return (
              <div
                key={`${phase.round}-${phase.name}`}
                className={`relative p-4 rounded-lg border-2 transition-all ${getColorClasses(
                  phase.color,
                  isCurrent
                )} ${isCurrent ? 'shadow-lg ring-2 ring-white/10' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-base">
                        {phase.name}
                        {isCurrent && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/10">
                            ACTIVE
                          </span>
                        )}
                      </h3>
                    </div>
                    <p className="text-sm opacity-90 mb-3">{phase.description}</p>
                    <div className="flex items-center gap-4 text-xs opacity-75">
                      <div>
                        <span className="font-medium">Slots:</span> {phase.startSlot.toString()} →{' '}
                        {phase.endSlot.toString()}
                      </div>
                      <div>
                        <span className="font-medium">Target Epochs:</span> {phase.targetEpochStart.toString()}{' '}
                        → {phase.targetEpochEnd.toString()}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {phase.status === 'current' ? (
                      <div className="text-sm font-medium">
                        <div className="opacity-75 mb-1">Ends in</div>
                        <div className="text-lg font-bold">{timeUntilEnd}</div>
                      </div>
                    ) : phase.status === 'future' ? (
                      <div className="text-sm font-medium">
                        <div className="opacity-75 mb-1">Starts in</div>
                        <div className="text-lg font-bold">{timeUntilStart}</div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Progress bar for current phase */}
                {isCurrent && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="flex items-center gap-2 text-xs opacity-75 mb-1">
                      <span>Progress</span>
                      <span className="ml-auto">
                        {Math.round(
                          (Number(currentSlot - phase.startSlot) /
                            Number(phase.endSlot - phase.startSlot)) *
                            100
                        )}
                        %
                      </span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-blue-400 h-2 transition-all duration-500"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (Number(currentSlot - phase.startSlot) /
                                Number(phase.endSlot - phase.startSlot)) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {timeline.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            <p>No upcoming slashing phases to display</p>
          </div>
        )}
      </div>
    </div>
  )
}
