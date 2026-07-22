import { useState, useMemo, useEffect } from 'react';
import { useSlashingStore } from '@/store/slashingStore';
import { RoundCard } from './RoundCard';
import { StatsPanel } from './StatsPanel';
import { Header } from './Header';
import { SlashingTimeline } from './SlashingTimeline';
import { DebugView } from './DebugView';
import { SlashingHelpModal } from './SlashingHelpModal';
import { BackendOverview } from './BackendOverview';
import { collectTargetedSequencers, deriveRoundPresentation } from '@/lib/utils';
import { clearCustomRpcUrl, reloadApp } from '@/lib/rpcOverride';

interface DashboardProps {
    network: 'mainnet' | 'testnet';
    onToggleNetwork: () => void;
}

type DashboardPage = 'monitor' | 'watch' | 'debug';

function getPageFromUrl(): DashboardPage {
    const view = new URLSearchParams(window.location.search).get('view');
    return view === 'watch' || view === 'debug' ? view : 'monitor';
}

export function Dashboard({ network, onToggleNetwork }: DashboardProps) {
    const { detectedSlashings, isInitialized, initializationError, isScanning, currentRound, config, isSlashingEnabled, pauseStartedAtSlot, pauseEndsAtSlot, audit } = useSlashingStore();
    const [page, setPage] = useState<DashboardPage>(getPageFromUrl);
    const [showSlashingHelpModal, setShowSlashingHelpModal] = useState(false);

    useEffect(() => {
        const handlePopState = () => setPage(getPageFromUrl());
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const navigateTo = (nextPage: DashboardPage) => {
        const next = new URL(window.location.href);
        if (nextPage === 'monitor') {
            next.searchParams.delete('view');
        }
        else {
            next.searchParams.set('view', nextPage);
        }
        window.history.pushState({}, '', next);
        setPage(nextPage);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Memoize sorted slashings to avoid re-sorting on every render
    const slashings = useMemo(() => Array.from(detectedSlashings.values()).sort((a, b) => Number(b.round - a.round)), [detectedSlashings]);
    const slashingStates = useMemo(() => slashings.map((slashing) => {
        return {
            slashing,
            display: deriveRoundPresentation(slashing, {
                config,
                isSlashingEnabled,
                pauseStartedAtSlot,
                pauseEndsAtSlot,
            }),
        };
    }), [slashings, config, isSlashingEnabled, pauseStartedAtSlot, pauseEndsAtSlot]);
    const activeSlashings = useMemo(() => slashingStates
        .filter(({ display, slashing }) => display.isActionable && slashing.round !== currentRound)
        .map(({ slashing }) => slashing)
        .sort((a, b) => Number(a.round - b.round)), [slashingStates, currentRound]);
    const inactiveSlashings = useMemo(() => slashingStates
        .filter(({ display, slashing }) => !display.isActionable && slashing.round !== currentRound)
        .map(({ slashing }) => slashing), [slashingStates, currentRound]);
    const sequencerOccurrences = useMemo(() => {
        const counts = new Map<string, number>();
        slashings.forEach((slashing) => {
            const validatorsInRound = new Set(
                slashing.slashActions?.map((action) => action.validator.toLowerCase()) ?? []
            );
            validatorsInRound.forEach((key) => {
                counts.set(key, (counts.get(key) ?? 0) + 1);
            });
        });
        return counts;
    }, [slashings]);
    const targetedSequencers = useMemo(() => collectTargetedSequencers(slashingStates
        .filter(({ display, slashing }) => display.isActionable && slashing.slashActions && slashing.slashActions.length > 0)
        .map(({ slashing }) => slashing)), [slashingStates]);

    if (page === 'watch') {
        return (
          <div className="min-h-screen">
            <Header network={network} onToggleNetwork={onToggleNetwork} onShowWatch={() => navigateTo('watch')} />
            <main className="max-w-7xl mx-auto px-4 py-8">
              <button
                type="button"
                onClick={() => navigateTo('monitor')}
                className="mb-8 border-5 border-chartreuse bg-brand-black px-5 py-3 text-sm font-black text-chartreuse shadow-brutal-chartreuse"
              >
                ← Back to Monitor
              </button>
              <BackendOverview network={network} view="watch" />
            </main>
          </div>
        );
    }

    if (page === 'debug') {
        return (
          <div className="min-h-screen">
            <Header network={network} onToggleNetwork={onToggleNetwork} onShowWatch={() => navigateTo('watch')} />
            <main className="max-w-7xl mx-auto px-4 py-8">
              <button
                type="button"
                onClick={() => navigateTo('monitor')}
                className="mb-8 border-5 border-aqua bg-brand-black px-5 py-3 text-sm font-black text-aqua shadow-brutal-aqua"
              >
                ← Back to Monitor
              </button>
              <BackendOverview network={network} view="debug" />
              <DebugView />
            </main>
          </div>
        );
    }

    if (!isInitialized) {
        if (initializationError) {
            return (<div className="min-h-screen">
        <Header network={network} onToggleNetwork={onToggleNetwork} onShowWatch={() => navigateTo('watch')} />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto bg-oxblood border-5 border-vermillion p-8 shadow-brutal-vermillion">
          <h1 className="text-vermillion text-2xl font-black uppercase mb-4">Monitor unavailable</h1>
          <p className="text-whisper-white font-bold break-words">{initializationError}</p>
          <p className="text-whisper-white/70 text-sm font-bold mt-4">The independent browser verifier will retry automatically. Backend warning coverage is reported in the debug view.</p>
          <button
            onClick={() => {
              clearCustomRpcUrl(network === 'testnet' ? 11155111 : 1);
              reloadApp();
            }}
            className="mt-6 px-5 py-3 bg-vermillion text-brand-black border-3 border-brand-black font-black uppercase shadow-brutal"
          >
            Reset custom RPC
          </button>
          </div>
        </main>
      </div>);
        }

        return (<div className="min-h-screen">
        <Header network={network} onToggleNetwork={onToggleNetwork} onShowWatch={() => navigateTo('watch')} />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <div className="mx-auto max-w-2xl text-center bg-brand-black border-5 border-chartreuse p-8 shadow-brutal-chartreuse">
          <div className="animate-spin h-16 w-16 border-5 border-chartreuse border-t-transparent mx-auto mb-4"></div>
          <p className="text-chartreuse font-black uppercase tracking-wider">Initializing Independent L1 Verifier...</p>
          </div>
        </main>
      </div>);
    }
    return (<div className="min-h-screen">
      <Header network={network} onToggleNetwork={onToggleNetwork} onShowWatch={() => navigateTo('watch')} />
      <SlashingHelpModal
        isOpen={showSlashingHelpModal}
        onClose={() => setShowSlashingHelpModal(false)}
        targetedSequencers={targetedSequencers}
      />

      {/* Debug View Toggle Button */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => navigateTo('debug')}
          className="relative px-6 py-3 font-black uppercase text-sm shadow-brutal border-5 bg-lapis text-aqua border-aqua"
          title="Show Debug View"
        >
          {audit.status !== 'ok' && (
            <span className="absolute -top-3 -left-3 bg-vermillion border-3 border-brand-black p-1 shadow-brutal" aria-hidden="true">
              <svg className="w-4 h-4 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 9v2m0 4h.01m-7 5h14L12 3 5 20z"/>
              </svg>
            </span>
          )}
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
              </svg>
              Debug View
            </span>
        </button>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-8">

        {audit.status !== 'ok' && (
          <div className={`${audit.status === 'stale' || audit.status === 'fatal' ? 'bg-oxblood border-vermillion shadow-brutal-vermillion' : 'bg-aubergine border-orchid shadow-brutal-orchid'} border-5 p-5 mb-6`}>
            <h2 className={`${audit.status === 'stale' || audit.status === 'fatal' ? 'text-vermillion' : 'text-orchid'} text-xl font-black uppercase mb-2`}>
              {audit.status === 'stale' || audit.status === 'fatal' ? 'Monitor data may be stale' : 'Monitor coverage is partial'}
            </h2>
            <p className="text-whisper-white text-sm font-bold">
              {audit.issues[0]?.message ?? 'The latest scan could not be fully verified.'}
            </p>
            {audit.lastSuccessfulAt !== null && (
              <p className="text-whisper-white/70 text-xs font-bold mt-2">
                Last verified scan: {new Date(audit.lastSuccessfulAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        <StatsPanel />

        
        

        <SlashingTimeline onOpenHelp={() => setShowSlashingHelpModal(true)} />

        {isScanning && (<div className="mb-6 bg-lapis border-5 border-aqua p-5 shadow-brutal-aqua">
            <div className="flex items-center gap-4">
              <div className="animate-spin h-8 w-8 border-5 border-aqua border-t-transparent"></div>
              <div>
                <h3 className="text-aqua font-black uppercase text-lg">Scanning Historical Rounds</h3>
                <p className="text-whisper-white text-sm font-bold">
                  The browser is independently verifying current and historical L1 state.
                </p>
              </div>
            </div>
          </div>)}

        
        <div className="mb-8">
          <h2 className="text-3xl font-black text-whisper-white mb-6 flex items-center gap-4">
            <span className="inline-flex items-center justify-center w-12 h-12 bg-vermillion border-5 border-brand-black text-brand-black font-black shadow-brutal">
              {activeSlashings.length}
            </span>
            ACTIVE SLASHING ROUNDS
            {activeSlashings.length > 0 && (<span className="text-base font-black text-vermillion uppercase">(Vetoable)</span>)}
          </h2>

          {activeSlashings.length === 0 ? (<div className="bg-malachite/20 border-5 border-brand-black p-12 text-center shadow-brutal">
              <div className="bg-chartreuse border-3 border-brand-black p-4 inline-block mb-4">
                <svg className="w-16 h-16 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <p className="text-whisper-white text-xl font-black uppercase">No Active Slashing Rounds</p>
              <p className="text-whisper-white/70 text-sm font-bold uppercase mt-2">
                Monitoring Round {currentRound?.toString()}
              </p>
            </div>) : (<div className="grid gap-6">
              {activeSlashings.map((slashing) => (<RoundCard key={slashing.round.toString()} slashing={slashing} sequencerOccurrences={sequencerOccurrences}/>))}
            </div>)}
        </div>

        
        {inactiveSlashings.length > 0 && (<div>
            <h2 className="text-3xl font-black text-whisper-white mb-6 uppercase">Other Rounds</h2>
            <div className="grid gap-6">
              {inactiveSlashings.map((slashing) => (<RoundCard key={slashing.round.toString()} slashing={slashing} sequencerOccurrences={sequencerOccurrences}/>))}
            </div>
          </div>)}

        {slashings.length === 0 && activeSlashings.length === 0 && (<div className="bg-malachite/20 border-5 border-brand-black p-8 text-center shadow-brutal">
            <p className="text-whisper-white font-black uppercase text-lg">No Slashing Rounds Detected</p>
            <p className="text-whisper-white/70 text-sm font-bold uppercase mt-2">Monitoring continues in background</p>
          </div>)}
      </main>
    </div>);
}
