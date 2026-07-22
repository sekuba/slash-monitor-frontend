import { useState, useEffect } from 'react';
import type { DetectedSlashing } from '@/types/slashing';
import { useSlashingStore } from '@/store/slashingStore';
import { formatAddress, formatEther, formatTimeRemaining, getStatusColor, getStatusText, deriveRoundPresentation, } from '@/lib/utils';
import { SequencerAddressLink } from './SequencerAddressLink';
interface RoundCardProps {
    slashing: DetectedSlashing;
    sequencerOccurrences?: Map<string, number>;
}
export function RoundCard({ slashing, sequencerOccurrences }: RoundCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [currentTime, setCurrentTime] = useState<number | null>(null);
    const { config, isSlashingEnabled, pauseStartedAtSlot, pauseEndsAtSlot } = useSlashingStore();

    const displayState = deriveRoundPresentation(slashing, {
        config,
        isSlashingEnabled,
        pauseStartedAtSlot,
        pauseEndsAtSlot,
        now: currentTime ?? undefined,
    });
    const isProtected = displayState.isProtected;
    const displayStatus = displayState.status;

    const isActionable = displayState.isActionable;
    useEffect(() => {
        if (!config)
            return;
        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1_000);
        return () => clearInterval(interval);
    }, [config]);

    // Determine color theme based on status
    const getColorTheme = (): 'aqua' | 'chartreuse' | 'vermillion' | 'default' => {
        if (displayStatus === 'vetoed' || isProtected)
            return 'aqua';
        if (displayStatus === 'quorum-reached')
            return 'chartreuse';
        if (displayStatus === 'newly-executable' || displayStatus === 'executable')
            return 'vermillion';
        return 'default';
    };

    const colorTheme = getColorTheme();

    // Style mappings based on color theme
    const themeStyles = {
        border: {
            aqua: 'border-aqua shadow-brutal-aqua',
            chartreuse: 'border-chartreuse shadow-brutal-chartreuse',
            vermillion: 'border-vermillion shadow-brutal-vermillion',
            default: 'border-brand-black shadow-brutal',
        },
        background: {
            aqua: 'bg-lapis',
            chartreuse: 'bg-malachite',
            vermillion: 'bg-oxblood',
            default: 'bg-malachite/20',
        },
        pulseColor: {
            aqua: '[--pulse-color:var(--color-aqua)]',
            chartreuse: '[--pulse-color:var(--color-chartreuse)]',
            vermillion: '[--pulse-color:var(--color-vermillion)]',
            default: '[--pulse-color:var(--color-chartreuse)]',
        },
    };
    return (<div className={`${themeStyles.background[colorTheme]} border-5 ${themeStyles.border[colorTheme]} ${isActionable ? `brutal-border-pulse ${themeStyles.pulseColor[colorTheme]}` : ''} transition-all hover:translate-x-1 hover:translate-y-1 hover:shadow-none relative`}>

      {/* Hidden search index so full addresses are findable even when collapsed */}
      <div className="sr-only" aria-hidden="true">
        {slashing.payloadAddress ? (<span>Payload {slashing.payloadAddress}</span>) : null}
        {slashing.slashActions?.map((action, idx) => (<span key={`${action.validator}-${idx}`}> Sequencer {action.validator}</span>))}
      </div>

      <div className="p-6 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-brand-black border-3 border-whisper-white px-4 py-2">
              <div className="text-xs text-chartreuse font-black uppercase tracking-wider">Round</div>
              <div className="text-3xl font-black text-whisper-white">{slashing.round.toString()}</div>
            </div>

            <div className={`px-4 py-2 border-3 text-sm font-black uppercase tracking-wider ${getStatusColor(displayStatus)}`}>
              {getStatusText(displayStatus)}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {slashing.affectedValidatorCount !== undefined && (<div className="bg-brand-black border-3 border-vermillion px-4 py-3">
                <div className="text-xs text-vermillion font-black uppercase tracking-wider">Sequencers</div>
                <div className="text-2xl font-black text-whisper-white">{slashing.affectedValidatorCount}</div>
              </div>)}

            {slashing.totalSlashAmount !== undefined && (<div className="bg-brand-black border-3 border-vermillion px-4 py-3">
                <div className="text-xs text-vermillion font-black uppercase tracking-wider">Slash Total</div>
                <div className="text-2xl font-black text-vermillion">
                  {parseInt(formatEther(slashing.totalSlashAmount), 10)} AZTEC
                </div>
              </div>)}

            <div className="bg-whisper-white border-3 border-brand-black p-2">
              <svg className={`w-6 h-6 text-brand-black stroke-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          </div>
      </div>


        {(() => {
            const showExecutableTimer = !slashing.isVetoed &&
                !isProtected &&
                displayStatus === 'quorum-reached' &&
                displayState.secondsUntilExecutable !== undefined;
            const showExpirationTimer = (displayStatus === 'newly-executable' ||
                displayStatus === 'executable' ||
                displayStatus === 'vetoed' ||
                displayStatus === 'expired' ||
                (isProtected && displayStatus === 'quorum-reached')) &&
                displayState.secondsUntilExpires !== undefined;
            const shouldShow = isProtected || showExecutableTimer || showExpirationTimer || slashing.isVetoed;
            if (!shouldShow)
                return null;
            return (<div className="mt-4 space-y-3">

              {slashing.verificationStatus === 'partial' && (
                <div className="flex items-center gap-3 bg-brand-black border-3 border-vermillion p-3">
                  <svg className="w-6 h-6 text-vermillion stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                  </svg>
                  <div>
                    <div className="text-vermillion font-black uppercase text-sm">PARTIAL VERIFICATION</div>
                    <div className="text-whisper-white/70 text-xs font-bold uppercase mt-1">
                      {slashing.issues?.[0] ?? 'Round details are incomplete on the current RPCs'}
                    </div>
                  </div>
                </div>
              )}

              {isProtected && (<div className="flex items-center gap-3 bg-brand-black border-3 border-aqua p-3">
                  <svg className="w-6 h-6 text-aqua stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                  </svg>
                  <div className="text-aqua font-black uppercase text-sm">PROTECTED BY GLOBAL PAUSE</div>
                </div>)}

              {showExecutableTimer && (<div className="flex items-center gap-3 bg-brand-black border-3 border-vermillion p-3">
                  <svg className="w-6 h-6 text-vermillion stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <div>
                    <div className="text-vermillion font-black uppercase text-sm">
                      EXECUTABLE IN {formatTimeRemaining(displayState.secondsUntilExecutable ?? 0)}
                    </div>
                    <div className="text-whisper-white/70 text-xs font-bold uppercase mt-1">
                      Veto now to prevent execution
                    </div>
                  </div>
                </div>)}

              {showExpirationTimer && (() => {
                  const adjustedSeconds = displayState.secondsUntilExpires ?? 0;
                  const isExpired = displayState.isExpired || adjustedSeconds === 0;
                  return (<div className="flex items-center gap-3 bg-brand-black border-3 border-vermillion p-3">
                      <svg className="w-6 h-6 text-vermillion stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      <div className="text-vermillion font-black uppercase text-sm">
                        {isExpired ? 'EXPIRED' : `EXPIRES IN ${formatTimeRemaining(adjustedSeconds)}`}
                      </div>
                    </div>);
              })()}

              {slashing.isVetoed && (<div className="flex items-center gap-3 bg-brand-black border-3 border-aqua p-3">
                  <svg className="w-6 h-6 text-aqua stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                  <div className="text-aqua font-black uppercase text-sm">VETOED</div>
                </div>)}
            </div>);
        })()}
      </div>

      
      {isExpanded && (<div className="border-t-5 border-brand-black p-6 space-y-4 bg-brand-black/30">
          
          {slashing.payloadAddress && (<div>
              <div className="text-xs text-whisper-white font-black uppercase tracking-wider mb-2">Payload Address</div>
              <div className="font-mono text-sm text-whisper-white bg-brand-black px-4 py-3 border-3 border-chartreuse flex items-center justify-between">
                <span>{formatAddress(slashing.payloadAddress, 9)}</span>
                <button type="button" onClick={() => navigator.clipboard.writeText(slashing.payloadAddress!)} className="brutal-button brutal-button--icon-sm" title="Copy address" aria-label="Copy payload address">
                  <svg className="w-5 h-5 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                </button>
              </div>
            </div>)}

          
          {slashing.targetEpochs && slashing.targetEpochs.length > 0 && (<div>
              <div className="text-xs text-whisper-white font-black uppercase tracking-wider mb-2">Target Epochs</div>
              <div className="flex gap-2 flex-wrap">
                {slashing.targetEpochs.map((epoch) => (<span key={epoch.toString()} className="px-3 py-2 bg-lapis border-3 border-aqua text-sm text-aqua font-bold">
                    {epoch.toString()}
                  </span>))}
              </div>
            </div>)}

          
          {slashing.slashActions && slashing.slashActions.length > 0 && (<div>
              <div className="text-xs text-whisper-white font-black uppercase tracking-wider mb-3">Sequencers To Slash</div>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {slashing.slashActions.map((action, idx) => {
                    const occurrences = sequencerOccurrences?.get(action.validator.toLowerCase()) ?? 1;
                    const showOccurrences = occurrences > 1;
                    return (<div key={idx} className="flex items-center justify-between bg-brand-black px-4 py-3 border-3 border-whisper-white gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <SequencerAddressLink
                          address={action.validator}
                          chars={9}
                          className="font-mono text-sm text-whisper-white font-bold"
                        />
                        {showOccurrences && (<span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-oxblood text-vermillion border-3 border-vermillion text-xs font-black uppercase whitespace-nowrap" title="This sequencer address shows up in multiple rounds in this monitor window">
                            <svg className="w-4 h-4 text-vermillion stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/>
                              <circle cx="12" cy="12" r="3" strokeWidth={3}/>
                            </svg>
                            <span className="font-black">{occurrences}</span>
                          </span>)}
                        <button type="button" onClick={() => navigator.clipboard.writeText(action.validator)} className="brutal-button brutal-button--neutral brutal-button--icon-sm shrink-0" title="Copy sequencer address" aria-label="Copy sequencer address">
                          <svg className="w-4 h-4 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                          </svg>
                        </button>
                      </div>
                      <span className="text-vermillion font-black text-lg whitespace-nowrap">{parseInt(formatEther(action.slashAmount), 10)} AZTEC</span>
                    </div>);
                })}
              </div>
            </div>)}

          
          <div className="grid grid-cols-2 gap-4 text-sm pt-4 border-t-3 border-brand-black">
            <div className="bg-aubergine border-3 border-orchid px-4 py-3">
              <div className="text-orchid font-black uppercase text-xs mb-1">Ballots Cast</div>
              <div className="text-whisper-white font-black text-xl">
                {slashing.ballotCount.toString()}
              </div>
              {config && <div className="text-whisper-white/70 font-bold text-xs mt-1">{config.quorum} matching required per validator</div>}
            </div>
            {slashing.slotWhenExecutable !== undefined && (<div className="bg-lapis border-3 border-aqua px-4 py-3">
                <div className="text-aqua font-black uppercase text-xs mb-1">Executable Slot</div>
                <div className="text-whisper-white font-black text-xl">{slashing.slotWhenExecutable.toString()}</div>
              </div>)}
          </div>
        </div>)}
    </div>);
}
