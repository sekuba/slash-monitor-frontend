import { useSlashingStore } from '@/store/slashingStore';
import { useNetwork } from '@/NetworkContext';

export function Header() {
    const { currentRound, config } = useSlashingStore();
    const { network, toggleNetwork } = useNetwork();

    const isMainnet = network === 'mainnet';
    const networkBorderClass = isMainnet ? 'border-vermillion' : 'border-aqua';
    const networkShadowClass = isMainnet ? 'shadow-brutal-vermillion' : 'shadow-brutal-aqua';
    const networkTextClass = isMainnet ? 'text-vermillion' : 'text-aqua';

    return (<header className="bg-brand-black border-b-6 border-chartreuse shadow-brutal-chartreuse">
      <div className="max-w-7xl mx-auto px-4 py-4 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Logo and Title */}
          <div className="flex items-center gap-3 md:gap-4">
            <div className="bg-vermillion border-5 border-brand-black p-2 md:p-3 shadow-brutal flex-shrink-0">
              <svg className="w-8 h-8 md:w-10 md:h-10 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-chartreuse tracking-tight">AZTEC SLASHING MONITOR</h1>
              <p className="text-xs sm:text-sm text-aqua font-bold uppercase tracking-wider hidden sm:block">Real-time Detection & Veto</p>
            </div>
          </div>

          {/* Stats and Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 md:gap-4">
            {currentRound !== null && (<div className="bg-lapis border-5 border-aqua px-3 py-2 md:px-6 md:py-3 shadow-brutal-aqua">
                <div className="text-xs text-aqua font-bold uppercase tracking-wider">Round</div>
                <div className="text-xl md:text-2xl font-black text-whisper-white">{currentRound.toString()}</div>
              </div>)}

            {config && (<div className="bg-aubergine border-5 border-orchid px-3 py-2 md:px-6 md:py-3 shadow-brutal-orchid">
                <div className="text-xs text-orchid font-bold uppercase tracking-wider">Quorum</div>
                <div className="text-xl md:text-2xl font-black text-whisper-white">{config.quorum}</div>
              </div>)}

            <button onClick={toggleNetwork} className={`bg-brand-black border-5 ${networkBorderClass} px-3 py-2 md:px-4 md:py-3 ${networkShadowClass} hover:-translate-y-1 hover:translate-x-1 hover:shadow-none transition-all duration-100 cursor-pointer`} aria-label={`Switch to ${isMainnet ? 'Testnet' : 'Mainnet'}`}>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${isMainnet ? 'bg-vermillion' : 'bg-aqua'} animate-pulse`}></div>
                <span className={`text-xs md:text-sm font-bold uppercase tracking-wider ${networkTextClass}`}>
                  {network}
                </span>
              </div>
            </button>

            <a href="https://github.com/sekuba/slashmon" target="_blank" rel="noopener noreferrer" className="bg-brand-black border-5 border-chartreuse p-2 md:p-3 shadow-brutal-chartreuse hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all duration-100" aria-label="View on GitHub">
              <svg className="w-6 h-6 md:w-8 md:h-8 text-chartreuse" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </header>);
}
