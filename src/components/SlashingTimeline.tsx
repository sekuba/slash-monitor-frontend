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

    // Only show current round
    const round = currentRound
    const roundStartSlot = round * roundSize
    const roundEndSlot = (round + 1n) * roundSize - 1n
    const vetoWindowSlot = (round + 1n + executionDelay) * roundSize
    const vetoWindowEndSlot = vetoWindowSlot + roundSize - 1n

    // Calculate target epochs for this round
    const targetRound = round - slashOffset
    const targetEpochStart = targetRound * roundSizeInEpochs
    const targetEpochEnd = targetEpochStart + roundSizeInEpochs - 1n

    // Current voting phase (if still ongoing)
    if (currentSlot <= roundEndSlot) {
      phases.push({
        name: 'Current Voting Round',
        round,
        startSlot: roundStartSlot,
        endSlot: roundEndSlot,
        targetEpochStart,
        targetEpochEnd,
        status: 'current',
        description: `Committee members vote on slashing offenses from epochs ${targetEpochStart.toString()}-${targetEpochEnd.toString()}`,
        color: 'blue',
      })
    }

    // Veto window / Execution phase (if not passed)
    if (currentSlot <= vetoWindowEndSlot) {
      const isInVetoWindow = currentSlot >= vetoWindowSlot && currentSlot <= vetoWindowEndSlot
      phases.push({
        name: `Round ${round.toString()} Veto/Execute`,
        round,
        startSlot: vetoWindowSlot,
        endSlot: vetoWindowEndSlot,
        targetEpochStart,
        targetEpochEnd,
        status: isInVetoWindow ? 'current' : 'future',
        description: `Vetoer can veto or slashing can be executed for epochs ${targetEpochStart.toString()}-${targetEpochEnd.toString()}`,
        color: isInVetoWindow ? 'red' : 'orange',
      })
    }

    return phases
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
          return 'bg-lapis border-aqua text-aqua shadow-brutal-aqua'
        case 'red':
          return 'bg-oxblood border-vermillion text-vermillion shadow-brutal-vermillion'
        case 'orange':
          return 'bg-malachite border-chartreuse text-chartreuse shadow-brutal-chartreuse'
        default:
          return 'bg-malachite/30 border-brand-black text-whisper-white shadow-brutal'
      }
    }
    return 'bg-malachite/20 border-brand-black text-whisper-white/70 shadow-brutal'
  }

  return (
    <div className="mb-8">
      <h2 className="text-3xl font-black text-whisper-white mb-6 flex items-center gap-4 uppercase">
        <div className="bg-aqua border-3 border-brand-black p-2">
          <svg className="w-8 h-8 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="square"
              strokeLinejoin="miter"
              strokeWidth={3}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </div>
        Epoch Progress
      </h2>

      <div className="bg-brand-black border-5 border-whisper-white p-6 shadow-brutal">
        <div className="mb-6 flex items-center gap-4 flex-wrap">
          <div className="bg-lapis border-3 border-aqua px-4 py-2">
            <span className="font-black text-aqua text-xs uppercase tracking-wider">Slot:</span>{' '}
            <span className="font-black text-whisper-white text-lg">{currentSlot.toString()}</span>
          </div>
          <div className="bg-aubergine border-3 border-orchid px-4 py-2">
            <span className="font-black text-orchid text-xs uppercase tracking-wider">Epoch:</span>{' '}
            <span className="font-black text-whisper-white text-lg">{currentEpoch.toString()}</span>
          </div>
          <div className="bg-malachite border-3 border-chartreuse px-4 py-2">
            <span className="font-black text-chartreuse text-xs uppercase tracking-wider">Round:</span>{' '}
            <span className="font-black text-whisper-white text-lg">{currentRound.toString()}</span>
          </div>
        </div>

        <div className="space-y-3">
          {timeline.map((phase) => {
            const isCurrent = phase.status === 'current'
            const timeUntilStart = formatSlotToTime(phase.startSlot)
            const timeUntilEnd = formatSlotToTime(phase.endSlot)

            return (
              <div
                key={`${phase.round}-${phase.name}`}
                className={`relative p-5 border-5 transition-all ${getColorClasses(
                  phase.color,
                  isCurrent
                )} ${isCurrent ? 'animate-pulse' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="font-black text-lg uppercase tracking-tight">
                        {phase.name}
                        {isCurrent && (
                          <span className="ml-3 inline-flex items-center px-3 py-1 border-3 border-brand-black bg-chartreuse text-xs font-black uppercase text-brand-black">
                            ACTIVE
                          </span>
                        )}
                      </h3>
                    </div>
                    <p className="text-sm font-bold mb-3">{phase.description}</p>
                    <div className="flex items-center gap-4 text-xs font-bold uppercase">
                      <div>
                        <span className="opacity-75">Slots:</span> {phase.startSlot.toString()} →{' '}
                        {phase.endSlot.toString()}
                      </div>
                      <div>
                        <span className="opacity-75">Epochs:</span> {phase.targetEpochStart.toString()}{' '}
                        → {phase.targetEpochEnd.toString()}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {phase.status === 'current' ? (
                      <div className="bg-brand-black border-3 border-current px-4 py-2">
                        <div className="opacity-75 mb-1 text-xs font-black uppercase">Ends In</div>
                        <div className="text-2xl font-black">{timeUntilEnd}</div>
                      </div>
                    ) : phase.status === 'future' ? (
                      <div className="bg-brand-black border-3 border-current px-4 py-2">
                        <div className="opacity-75 mb-1 text-xs font-black uppercase">Starts In</div>
                        <div className="text-2xl font-black">{timeUntilStart}</div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Progress bar for current phase */}
                {isCurrent && (
                  <div className="mt-4 pt-4 border-t-3 border-brand-black">
                    <div className="flex items-center gap-2 text-xs font-black uppercase mb-2">
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
                    <div className="w-full bg-brand-black border-3 border-current h-4 overflow-hidden">
                      <div
                        className="bg-chartreuse h-full transition-all duration-500"
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
          <div className="text-center text-whisper-white/70 py-8">
            <p className="font-black uppercase">No Upcoming Phases</p>
          </div>
        )}
      </div>
    </div>
  )
}
