import { useSlashingStore } from '@/store/slashingStore'

export function Header() {
  const { currentRound, config } = useSlashingStore()

  return (
    <header className="bg-brand-black border-b-6 border-chartreuse shadow-brutal-chartreuse">
      <div className="px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-vermillion border-5 border-brand-black p-3 shadow-brutal">
                <svg
                  className="w-10 h-10 text-brand-black stroke-[3]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                    strokeWidth={3}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-black text-chartreuse tracking-tight">AZTEC SLASHING MONITOR</h1>
                <p className="text-sm text-aqua font-bold uppercase tracking-wider">Real-time Detection & Veto</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {currentRound !== null && (
              <div className="bg-lapis border-5 border-aqua px-6 py-3 shadow-brutal-aqua">
                <div className="text-xs text-aqua font-bold uppercase tracking-wider">Round</div>
                <div className="text-2xl font-black text-whisper-white">{currentRound.toString()}</div>
              </div>
            )}

            {config && (
              <div className="bg-aubergine border-5 border-orchid px-6 py-3 shadow-brutal-orchid">
                <div className="text-xs text-orchid font-bold uppercase tracking-wider">Quorum</div>
                <div className="text-2xl font-black text-whisper-white">{config.quorum}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
