import { useState, useEffect } from 'react';
import type { DetectedSlashing } from '@/types/slashing';
import { useSlashingStore } from '@/store/slashingStore';
import { formatAddress, formatEther, formatTimeRemaining, getStatusColor, getStatusText, isActionableStatus, findOffenseForValidator, getOffenseTypeName, getOffenseTypeColor, } from '@/lib/utils';
interface RoundCardProps {
    slashing: DetectedSlashing;
}
export function RoundCard({ slashing }: RoundCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [currentTime, setCurrentTime] = useState(Date.now());
    const { offenses, config, isSlashingEnabled, slashingDisabledUntil, slashingDisableDuration, currentSlot } = useSlashingStore();

    const isProtectedByGlobalPause = (): boolean => {
        if (!config || isSlashingEnabled || !slashingDisabledUntil || !slashingDisableDuration || !currentSlot) {
            return false;
        }
        const now = Math.floor(Date.now() / 1000);
        const disabledUntilSeconds = Number(slashingDisabledUntil);
        const secondsUntilReEnabled = Math.max(0, disabledUntilSeconds - now);
        const slotsUntilReEnabled = Math.floor(secondsUntilReEnabled / config.slotDuration);
        const slotWhenReEnabled = currentSlot + BigInt(slotsUntilReEnabled);
        const roundSize = BigInt(config.slashingRoundSize);
        const roundWhenReEnabled = slotWhenReEnabled / roundSize;
        const executionDelay = BigInt(config.executionDelayInRounds);
        const slotWhenPauseStarted = slotWhenReEnabled - BigInt(Math.floor(Number(slashingDisableDuration) / config.slotDuration));
        const roundWhenPauseStarted = slotWhenPauseStarted / roundSize;
        const firstGroup1Round = roundWhenPauseStarted - executionDelay;
        const lastGroup2Round = roundWhenReEnabled - executionDelay - 2n;
        return slashing.round >= firstGroup1Round && slashing.round <= lastGroup2Round;
    };

    const isProtected = isProtectedByGlobalPause();

    // Adjust status if protected by global pause - executable rounds become quorum-reached
    const displayStatus = (isProtected && (slashing.status === 'executable' || slashing.status === 'in-veto-window'))
        ? 'quorum-reached'
        : slashing.status;

    const isActionable = isActionableStatus(displayStatus);
    useEffect(() => {
        if (!config)
            return;
        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, config.realtimeCountdownInterval);
        return () => clearInterval(interval);
    }, [config]);
    const getAdjustedSecondsRemaining = (baseSeconds: number | undefined): number | undefined => {
        if (baseSeconds === undefined || slashing.lastUpdatedTimestamp === undefined) {
            return baseSeconds;
        }
        const elapsedSeconds = Math.floor((currentTime - slashing.lastUpdatedTimestamp) / 1000);
        const adjustedSeconds = baseSeconds - elapsedSeconds;
        return Math.max(0, adjustedSeconds);
    };
    const getBorderStyle = () => {
        if (!isActionable)
            return 'border-brand-black shadow-brutal';
        if (displayStatus === 'quorum-reached')
            return 'border-aqua shadow-brutal-aqua';
        return 'border-chartreuse shadow-brutal-chartreuse';
    };
    const getBackgroundStyle = () => {
        if (slashing.isVetoed)
            return 'bg-lapis';
        if (!isActionable)
            return 'bg-malachite/20';
        if (displayStatus === 'quorum-reached')
            return 'bg-lapis';
        if (displayStatus === 'executable' || displayStatus === 'in-veto-window')
            return 'bg-oxblood';
        return 'bg-malachite/30';
    };
    return (<div className={`${getBackgroundStyle()} border-5 ${getBorderStyle()} transition-all hover:-translate-y-1 hover:translate-x-1 relative`}>
      
      {isActionable && (<div className="absolute top-4 right-4 w-3 h-3 bg-chartreuse rounded-full animate-pulse shadow-brutal"></div>)}

      
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
              <svg className={`w-6 h-6 text-brand-black stroke-[3] transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          </div>
        </div>


        {isActionable && (() => {
            const showExecutableTimer = !slashing.isVetoed && !isProtected && slashing.status === 'quorum-reached' && slashing.secondsUntilExecutable !== undefined;
            const showExpirationTimer = (slashing.status === 'in-veto-window' || slashing.status === 'executable' ||
                                        (slashing.isVetoed && slashing.status === 'quorum-reached') ||
                                        (isProtected && slashing.status === 'quorum-reached')) &&
                                        slashing.secondsUntilExpires !== undefined;
            const showVetoButton = !slashing.isVetoed && !isProtected;

            return (<div className="mt-4 space-y-3">

              {isProtected && (<div className="flex items-center gap-3 bg-brand-black border-3 border-aqua p-3">
                  <svg className="w-6 h-6 text-aqua stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                  </svg>
                  <div className="text-aqua font-black uppercase text-sm">PROTECTED BY GLOBAL PAUSE</div>
                </div>)}

              {showExecutableTimer && (<div className="flex items-center gap-3 bg-brand-black border-3 border-vermillion p-3 animate-pulse">
                  <svg className="w-6 h-6 text-vermillion stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <div>
                    <div className="text-vermillion font-black uppercase text-sm">
                      EXECUTABLE IN {formatTimeRemaining(getAdjustedSecondsRemaining(slashing.secondsUntilExecutable) ?? 0)}
                    </div>
                    <div className="text-whisper-white/70 text-xs font-bold uppercase mt-1">
                      Veto now to prevent execution
                    </div>
                  </div>
                </div>)}

              {showExpirationTimer && (() => {
                  const adjustedSeconds = getAdjustedSecondsRemaining(slashing.secondsUntilExpires) ?? 0;
                  const isExpired = adjustedSeconds === 0;
                  return (<div className={`flex items-center gap-3 bg-brand-black border-3 border-vermillion p-3 ${!isExpired ? 'animate-pulse' : ''}`}>
                      <svg className="w-6 h-6 text-vermillion stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      <div className="text-vermillion font-black uppercase text-sm">
                        {isExpired ? 'EXPIRED' : `EXPIRES IN ${formatTimeRemaining(adjustedSeconds)}`}
                      </div>
                    </div>);
              })()}

              {slashing.isVetoed ? (<div className="flex items-center gap-3 bg-brand-black border-3 border-aqua p-3">
                  <svg className="w-6 h-6 text-aqua stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                  <div className="text-aqua font-black uppercase text-sm">VETOED</div>
                </div>) : showVetoButton ? (<div className="flex items-center gap-3 bg-brand-black border-3 border-chartreuse p-3">
                  <svg className="w-6 h-6 text-chartreuse stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <div className="text-chartreuse font-black uppercase text-sm">VETO AVAILABLE NOW</div>
                </div>) : null}
            </div>);
          })()}
      </div>

      
      {isExpanded && (<div className="border-t-5 border-brand-black p-6 space-y-4 bg-brand-black/30">
          
          {slashing.payloadAddress && (<div>
              <div className="text-xs text-whisper-white font-black uppercase tracking-wider mb-2">Payload Address</div>
              <div className="font-mono text-sm text-whisper-white bg-brand-black px-4 py-3 border-3 border-chartreuse flex items-center justify-between">
                <span>{slashing.payloadAddress}</span>
                <button onClick={() => navigator.clipboard.writeText(slashing.payloadAddress!)} className="bg-chartreuse border-3 border-brand-black p-2 hover:translate-x-1 hover:-translate-y-1 transition-transform shadow-brutal" title="Copy address">
                  <svg className="w-5 h-5 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              <div className="text-xs text-whisper-white font-black uppercase tracking-wider mb-3">Validators To Slash</div>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {slashing.slashActions.map((action, idx) => {
                    const offense = slashing.targetEpochs
                        ? findOffenseForValidator(action.validator, slashing.targetEpochs, offenses, slashing.round)
                        : undefined;
                    return (<div key={idx} className="flex items-center justify-between bg-brand-black px-4 py-3 border-3 border-whisper-white gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="font-mono text-sm text-whisper-white font-bold truncate">{formatAddress(action.validator)}</span>
                        <button onClick={() => navigator.clipboard.writeText(action.validator)} className="flex-shrink-0 bg-whisper-white border-3 border-brand-black p-1 hover:translate-x-1 hover:-translate-y-1 transition-transform shadow-brutal" title="Copy sequencer address">
                          <svg className="w-4 h-4 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                          </svg>
                        </button>
                        {offense && (<span className={`px-2 py-1 border-3 text-xs font-black uppercase whitespace-nowrap ${getOffenseTypeColor(offense.offenseType)}`}>
                            {getOffenseTypeName(offense.offenseType)}
                          </span>)}
                      </div>
                      <span className="text-vermillion font-black text-lg whitespace-nowrap">{parseInt(formatEther(action.slashAmount), 10)} AZTEC</span>
                    </div>);
                })}
              </div>
            </div>)}

          
          <div className="grid grid-cols-2 gap-4 text-sm pt-4 border-t-3 border-brand-black">
            <div className="bg-aubergine border-3 border-orchid px-4 py-3">
              <div className="text-orchid font-black uppercase text-xs mb-1">Vote Count</div>
              <div className="text-whisper-white font-black text-xl">
                {slashing.voteCount.toString()}{config ? `/${config.quorum}` : ''}
              </div>
            </div>
            {slashing.slotWhenExecutable !== undefined && (<div className="bg-lapis border-3 border-aqua px-4 py-3">
                <div className="text-aqua font-black uppercase text-xs mb-1">Executable Slot</div>
                <div className="text-whisper-white font-black text-xl">{slashing.slotWhenExecutable.toString()}</div>
              </div>)}
          </div>
        </div>)}
    </div>);
}
