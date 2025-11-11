import { useState } from 'react'
import type { DetectedSlashing } from '@/types/slashing'
import { VetoInstructions } from './VetoInstructions'
import {
  formatAddress,
  formatEther,
  formatTimeRemaining,
  getStatusColor,
  getStatusText,
  isActionableStatus,
} from '@/lib/utils'

interface RoundCardProps {
  slashing: DetectedSlashing
}

export function RoundCard({ slashing }: RoundCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const isActionable = isActionableStatus(slashing.status)

  const getBorderStyle = () => {
    if (!isActionable) return 'border-gray-800'
    if (slashing.status === 'quorum-reached') return 'border-blue-500/50 shadow-lg shadow-blue-500/10'
    return 'border-yellow-500/50 shadow-lg shadow-yellow-500/10'
  }

  return (
    <div className={`bg-gray-900 rounded-lg border ${getBorderStyle()}`}>
      {/* Header */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-sm text-gray-400">Round</div>
              <div className="text-2xl font-bold text-white">{slashing.round.toString()}</div>
            </div>

            <div className={`px-3 py-1 rounded-full border text-sm font-medium ${getStatusColor(slashing.status)}`}>
              {getStatusText(slashing.status)}
            </div>

            {slashing.isVetoed && (
              <div className="px-3 py-1 rounded-full border bg-purple-500/20 text-purple-500 border-purple-700 text-sm font-medium">
                Vetoed
              </div>
            )}
          </div>

          <div className="flex items-center gap-6">
            {slashing.affectedValidatorCount !== undefined && (
              <div className="text-right">
                <div className="text-sm text-gray-400">Validators</div>
                <div className="text-xl font-semibold text-white">{slashing.affectedValidatorCount}</div>
              </div>
            )}

            {slashing.totalSlashAmount !== undefined && (
              <div className="text-right">
                <div className="text-sm text-gray-400">Total Slash</div>
                <div className="text-xl font-semibold text-red-400">
                  {formatEther(slashing.totalSlashAmount)} ETH
                </div>
              </div>
            )}

            <svg
              className={`w-6 h-6 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Time remaining (if actionable) */}
        {isActionable && (
          <div className="mt-3 space-y-2">
            {slashing.status === 'quorum-reached' && slashing.secondsUntilExecutable !== undefined && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-blue-400 font-medium">
                    ⏰ Becomes executable in {formatTimeRemaining(slashing.secondsUntilExecutable)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span className="ml-6 text-xs">
                    (Not yet executable, but you can veto now to prevent future execution)
                  </span>
                </div>
              </>
            )}
            {(slashing.status === 'in-veto-window' || slashing.status === 'executable') &&
              slashing.secondsUntilExpires !== undefined && (
                <div className="flex items-center gap-2 text-sm">
                  <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-red-400 font-medium">
                    ⏰ Expires in {formatTimeRemaining(slashing.secondsUntilExpires)}
                  </span>
                </div>
              )}
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-green-400 font-medium">✓ You can veto this NOW</span>
            </div>
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          {/* Payload Address */}
          {slashing.payloadAddress && (
            <div>
              <div className="text-sm text-gray-400 mb-1">Payload Address</div>
              <div className="font-mono text-sm text-white bg-gray-950 px-3 py-2 rounded border border-gray-800 flex items-center justify-between">
                <span>{slashing.payloadAddress}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(slashing.payloadAddress!)}
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Copy address"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Target Epochs */}
          {slashing.targetEpochs && slashing.targetEpochs.length > 0 && (
            <div>
              <div className="text-sm text-gray-400 mb-1">Target Epochs</div>
              <div className="flex gap-2 flex-wrap">
                {slashing.targetEpochs.map((epoch) => (
                  <span
                    key={epoch.toString()}
                    className="px-2 py-1 bg-gray-800 rounded text-sm text-gray-300"
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
              <div className="text-sm text-gray-400 mb-2">Validators Being Slashed</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {slashing.slashActions.map((action, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-gray-950 px-3 py-2 rounded border border-gray-800"
                  >
                    <span className="font-mono text-sm text-gray-300">{formatAddress(action.validator)}</span>
                    <span className="text-red-400 font-semibold">{formatEther(action.slashAmount)} ETH</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Veto Instructions */}
          {isActionable && slashing.payloadAddress && !slashing.isVetoed && (
            <VetoInstructions payloadAddress={slashing.payloadAddress} />
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t border-gray-800">
            <div>
              <span className="text-gray-400">Vote Count:</span>
              <span className="ml-2 text-white font-medium">{slashing.voteCount.toString()}</span>
            </div>
            {slashing.slotWhenExecutable && (
              <div>
                <span className="text-gray-400">Executable Slot:</span>
                <span className="ml-2 text-white font-medium">{slashing.slotWhenExecutable.toString()}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
