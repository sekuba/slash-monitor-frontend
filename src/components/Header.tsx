import { useSlashingStore } from '@/store/slashingStore'

export function Header() {
  const { currentRound, config } = useSlashingStore()

  return (
    <header className="bg-gray-900 border-b border-gray-800">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <h1 className="text-2xl font-bold text-white">Aztec Slashing Monitor</h1>
                <p className="text-sm text-gray-400">Real-time slashing detection and veto interface</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {currentRound !== null && (
              <div className="text-right">
                <div className="text-sm text-gray-400">Current Round</div>
                <div className="text-xl font-bold text-white">{currentRound.toString()}</div>
              </div>
            )}

            {config && (
              <div className="text-right">
                <div className="text-sm text-gray-400">Quorum</div>
                <div className="text-xl font-bold text-white">{config.quorum}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
