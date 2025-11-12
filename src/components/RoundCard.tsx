import { useState, useEffect } from 'react'
import type { DetectedSlashing } from '@/types/slashing'
import { useSlashingStore } from '@/store/slashingStore'
import {
  formatAddress,
  formatEther,
  formatTimeRemaining,
  getStatusColor,
  getStatusText,
  isActionableStatus,
  findOffenseForValidator,
  getOffenseTypeName,
  getOffenseTypeColor,
} from '@/lib/utils'

interface RoundCardProps {
  slashing: DetectedSlashing
}

export function RoundCard({ slashing }: RoundCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [currentTime, setCurrentTime] = useState(Date.now())
  const { offenses, config } = useSlashingStore()

  const isActionable = isActionableStatus(slashing.status)

  // Update current time for real-time countdown (interval from config)
  useEffect(() => {
    if (!config) return
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, config.realtimeCountdownInterval)
    return () => clearInterval(interval)
  }, [config])

  // Calculate adjusted time remaining accounting for elapsed time since last poll
  const getAdjustedSecondsRemaining = (baseSeconds: number | undefined): number | undefined => {
    if (baseSeconds === undefined || slashing.lastUpdatedTimestamp === undefined) {
      return baseSeconds
    }
    const elapsedSeconds = Math.floor((currentTime - slashing.lastUpdatedTimestamp) / 1000)
    const adjustedSeconds = baseSeconds - elapsedSeconds
    return Math.max(0, adjustedSeconds) // Don't go negative
  }

  const getBorderStyle = () => {
    if (!isActionable) return 'border-brand-black shadow-brutal'
    if (slashing.status === 'quorum-reached') return 'border-aqua shadow-brutal-aqua'
    return 'border-chartreuse shadow-brutal-chartreuse'
  }

  const getBackgroundStyle = () => {
    if (slashing.isVetoed) return 'bg-aubergine'
    if (!isActionable) return 'bg-malachite/20'
    if (slashing.status === 'quorum-reached') return 'bg-lapis'
    if (slashing.status === 'executable' || slashing.status === 'in-veto-window') return 'bg-oxblood'
    return 'bg-malachite/30'
  }

  return (
    <div className={`${getBackgroundStyle()} border-5 ${getBorderStyle()} transition-all hover:-translate-y-1 hover:translate-x-1 relative`}>
      {/* Pulsing indicator for actionable rounds */}
      {isActionable && (
        <div className="absolute top-4 right-4 w-3 h-3 bg-chartreuse rounded-full animate-pulse shadow-brutal"></div>
      )}

      {/* Header */}
      <div
        className="p-6 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-brand-black border-3 border-whisper-white px-4 py-2">
              <div className="text-xs text-chartreuse font-black uppercase tracking-wider">Round</div>
              <div className="text-3xl font-black text-whisper-white">{slashing.round.toString()}</div>
            </div>

            <div className={`px-4 py-2 border-3 text-sm font-black uppercase tracking-wider ${getStatusColor(slashing.status)}`}>
              {getStatusText(slashing.status)}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {slashing.affectedValidatorCount !== undefined && (
              <div className="bg-brand-black border-3 border-vermillion px-4 py-3">
                <div className="text-xs text-vermillion font-black uppercase tracking-wider">Validators</div>
                <div className="text-2xl font-black text-whisper-white">{slashing.affectedValidatorCount}</div>
              </div>
            )}

            {slashing.totalSlashAmount !== undefined && (
              <div className="bg-brand-black border-3 border-vermillion px-4 py-3">
                <div className="text-xs text-vermillion font-black uppercase tracking-wider">Slash Total</div>
                <div className="text-2xl font-black text-vermillion">
                  {parseInt(formatEther(slashing.totalSlashAmount), 10)} FEE
                </div>
              </div>
            )}

            <div className="bg-whisper-white border-3 border-brand-black p-2">
              <svg
                className={`w-6 h-6 text-brand-black stroke-[3] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Time remaining (if actionable) */}
        {isActionable && (
          <div className="mt-4 space-y-3">
            {/* Show executable countdown only if not vetoed */}
            {!slashing.isVetoed && slashing.status === 'quorum-reached' && slashing.secondsUntilExecutable !== undefined && (
              <>
                <div className="flex items-center gap-3 bg-brand-black border-3 border-whisper-white p-3 animate-pulse">
                  <svg className="w-6 h-6 text-orchid stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="square"
                      strokeLinejoin="miter"
                      strokeWidth={3}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <div className="text-orchid font-black uppercase text-sm">
                      EXECUTABLE IN {formatTimeRemaining(getAdjustedSecondsRemaining(slashing.secondsUntilExecutable) ?? 0)}
                    </div>
                    <div className="text-whisper-white/70 text-xs font-bold uppercase mt-1">
                      Veto now to prevent execution
                    </div>
                  </div>
                </div>
              </>
            )}
            {/* Show expiration countdown for non-vetoed OR vetoed rounds */}
            {(slashing.status === 'in-veto-window' || slashing.status === 'executable' || (slashing.isVetoed && slashing.status === 'quorum-reached')) &&
              slashing.secondsUntilExpires !== undefined && (() => {
                const adjustedSeconds = getAdjustedSecondsRemaining(slashing.secondsUntilExpires) ?? 0
                const isExpired = adjustedSeconds === 0
                return (
                  <div className={`flex items-center gap-3 bg-brand-black border-3 border-vermillion p-3 ${!isExpired ? 'animate-pulse' : ''}`}>
                    <svg className="w-6 h-6 text-vermillion stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="square"
                        strokeLinejoin="miter"
                        strokeWidth={3}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="text-vermillion font-black uppercase text-sm">
                      {isExpired ? 'EXPIRED' : `EXPIRES IN ${formatTimeRemaining(adjustedSeconds)}`}
                    </div>
                  </div>
                )
              })()}
            {slashing.isVetoed ? (
              <div className="flex items-center gap-3 bg-brand-black border-3 border-orchid p-3">
                <svg className="w-6 h-6 text-orchid stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                    strokeWidth={3}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                <div className="text-orchid font-black uppercase text-sm">VETOED</div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-brand-black border-3 border-chartreuse p-3">
                <svg className="w-6 h-6 text-chartreuse stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                    strokeWidth={3}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="text-chartreuse font-black uppercase text-sm">VETO AVAILABLE NOW</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t-5 border-brand-black p-6 space-y-4 bg-brand-black/30">
          {/* Payload Address */}
          {slashing.payloadAddress && (
            <div>
              <div className="text-xs text-whisper-white font-black uppercase tracking-wider mb-2">Payload Address</div>
              <div className="font-mono text-sm text-whisper-white bg-brand-black px-4 py-3 border-3 border-chartreuse flex items-center justify-between">
                <span>{slashing.payloadAddress}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(slashing.payloadAddress!)}
                  className="bg-chartreuse border-3 border-brand-black p-2 hover:translate-x-1 hover:-translate-y-1 transition-transform shadow-brutal"
                  title="Copy address"
                >
                  <svg className="w-5 h-5 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Target Epochs */}
          {slashing.targetEpochs && slashing.targetEpochs.length > 0 && (
            <div>
              <div className="text-xs text-whisper-white font-black uppercase tracking-wider mb-2">Target Epochs</div>
              <div className="flex gap-2 flex-wrap">
                {slashing.targetEpochs.map((epoch) => (
                  <span
                    key={epoch.toString()}
                    className="px-3 py-2 bg-lapis border-3 border-aqua text-sm text-aqua font-bold"
                  >
                    {epoch.toString()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Slash Actions */}
          {slashing.slashActions && slashing.slashActions.length > 0 && (
            <div>
              <div className="text-xs text-whisper-white font-black uppercase tracking-wider mb-3">Validators To Slash</div>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {slashing.slashActions.map((action, idx) => {
                  const offense = slashing.targetEpochs
                    ? findOffenseForValidator(action.validator, slashing.targetEpochs, offenses, slashing.round)
                    : undefined

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-brand-black px-4 py-3 border-3 border-whisper-white gap-3"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="font-mono text-sm text-whisper-white font-bold truncate">{formatAddress(action.validator)}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(action.validator)}
                          className="flex-shrink-0 bg-whisper-white border-3 border-brand-black p-1 hover:translate-x-1 hover:-translate-y-1 transition-transform shadow-brutal"
                          title="Copy validator address"
                        >
                          <svg className="w-4 h-4 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                        {offense && (
                          <span className={`px-2 py-1 border-3 text-xs font-black uppercase whitespace-nowrap ${getOffenseTypeColor(offense.offenseType)}`}>
                            {getOffenseTypeName(offense.offenseType)}
                          </span>
                        )}
                      </div>
                      <span className="text-vermillion font-black text-lg whitespace-nowrap">{parseInt(formatEther(action.slashAmount), 10)} FEE</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm pt-4 border-t-3 border-brand-black">
            <div className="bg-aubergine border-3 border-orchid px-4 py-3">
              <div className="text-orchid font-black uppercase text-xs mb-1">Vote Count</div>
              <div className="text-whisper-white font-black text-xl">
                {slashing.voteCount.toString()}{config ? `/${config.quorum}` : ''}
              </div>
            </div>
            {slashing.slotWhenExecutable !== undefined && (
              <div className="bg-lapis border-3 border-aqua px-4 py-3">
                <div className="text-aqua font-black uppercase text-xs mb-1">Executable Slot</div>
                <div className="text-whisper-white font-black text-xl">{slashing.slotWhenExecutable.toString()}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
