import { useSlashingStore } from '@/store/slashingStore';
import { formatTimeRemaining } from '@/lib/utils';
import { useMemo } from 'react';
interface TimelinePhase {
    name: string;
    round: bigint;
    startSlot: bigint;
    endSlot: bigint;
    targetEpochStart: bigint;
    targetEpochEnd: bigint;
    status: 'past' | 'current' | 'future';
    description: string;
    color: string;
}
export function SlashingTimeline() {
    const { config, currentRound, currentSlot, currentEpoch, isSlashingEnabled, slashingDisabledUntil, slashingDisableDuration } = useSlashingStore();
    const timeline = useMemo(() => {
        if (!config || currentRound === null || currentSlot === null || currentEpoch === null) {
            return [];
        }
        const phases: TimelinePhase[] = [];
        const roundSize = BigInt(config.slashingRoundSize);
        const roundSizeInEpochs = BigInt(config.slashingRoundSizeInEpochs);
        const executionDelay = BigInt(config.executionDelayInRounds);
        const slashOffset = BigInt(config.slashOffsetInRounds);
        const round = currentRound;
        const roundStartSlot = round * roundSize;
        const roundEndSlot = (round + 1n) * roundSize - 1n;
        const vetoWindowSlot = (round + 1n + executionDelay) * roundSize;
        const vetoWindowEndSlot = vetoWindowSlot + roundSize - 1n;
        const targetRound = round - slashOffset;
        const targetEpochStart = targetRound * roundSizeInEpochs;
        const targetEpochEnd = targetEpochStart + roundSizeInEpochs - 1n;
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
            });
        }
        if (currentSlot <= vetoWindowEndSlot) {
            const isInVetoWindow = currentSlot >= vetoWindowSlot && currentSlot <= vetoWindowEndSlot;
            phases.push({
                name: `Round ${round.toString()} Veto/Execute`,
                round,
                startSlot: vetoWindowSlot,
                endSlot: vetoWindowEndSlot,
                targetEpochStart,
                targetEpochEnd,
                status: isInVetoWindow ? 'current' : 'future',
                description: `If voted to slash and no veto, slashing can be executed for epochs ${targetEpochStart.toString()}-${targetEpochEnd.toString()}`,
                color: isInVetoWindow ? 'red' : 'orange',
            });
        }
        return phases;
    }, [config, currentRound, currentSlot, currentEpoch]);
    if (!config || currentRound === null || currentSlot === null || currentEpoch === null) {
        return null;
    }
    const formatSlotToTime = (slot: bigint) => {
        const slotDiff = Number(slot - currentSlot);
        const seconds = slotDiff * config.slotDuration;
        if (seconds < 0) {
            return 'Now';
        }
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > config.hoursThresholdForDayDisplay) {
            const days = Math.floor(hours / config.hoursThresholdForDayDisplay);
            const remainingHours = hours % config.hoursThresholdForDayDisplay;
            return `~${days}d ${remainingHours}h`;
        }
        if (hours > 0) {
            return `~${hours}h ${minutes}m`;
        }
        return `~${minutes}m`;
    };
    const getColorClasses = (color: string, isCurrent: boolean) => {
        if (isCurrent) {
            switch (color) {
                case 'blue':
                    return 'bg-lapis border-aqua text-aqua shadow-brutal-aqua';
                case 'red':
                    return 'bg-oxblood border-vermillion text-vermillion shadow-brutal-vermillion';
                case 'orange':
                    return 'bg-malachite border-chartreuse text-chartreuse shadow-brutal-chartreuse';
                default:
                    return 'bg-malachite/30 border-brand-black text-whisper-white shadow-brutal';
            }
        }
        return 'bg-malachite/20 border-brand-black text-whisper-white/70 shadow-brutal';
    };
    return (<div className="mb-8">
      <h2 className="text-3xl font-black text-whisper-white mb-6 flex items-center gap-4 uppercase">
        <div className="bg-aqua border-3 border-brand-black p-2">
          <svg className="w-8 h-8 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
          </svg>
        </div>
        Slashing Timeline
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
            const isCurrent = phase.status === 'current';
            const timeUntilStart = formatSlotToTime(phase.startSlot);
            const timeUntilEnd = formatSlotToTime(phase.endSlot);
            return (<div key={`${phase.round}-${phase.name}`} className={`relative p-5 border-5 transition-all ${getColorClasses(phase.color, isCurrent)} ${isCurrent ? 'animate-pulse' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="font-black text-lg uppercase tracking-tight">
                        {phase.name}
                        {isCurrent && (<span className="ml-3 inline-flex items-center px-3 py-1 border-3 border-brand-black bg-chartreuse text-xs font-black uppercase text-brand-black">
                            ACTIVE
                          </span>)}
                      </h3>
                    </div>
                    <p className="text-sm font-bold mb-3">{phase.description}</p>
                    <div className="flex items-center gap-4 text-xs font-bold uppercase">
                      <div>
                        <span className="opacity-75">Slots:</span> {phase.startSlot.toString()} →{' '}
                        {phase.endSlot.toString()}
                      </div>
                      <div>
                        <span className="opacity-75">Target Epochs:</span> {phase.targetEpochStart.toString()}{' '}
                        → {phase.targetEpochEnd.toString()}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {phase.status === 'current' ? (<div className="bg-brand-black border-3 border-current px-4 py-2">
                        <div className="opacity-75 mb-1 text-xs font-black uppercase">Ends In</div>
                        <div className="text-2xl font-black">{timeUntilEnd}</div>
                      </div>) : phase.status === 'future' ? (<div className="bg-brand-black border-3 border-current px-4 py-2">
                        <div className="opacity-75 mb-1 text-xs font-black uppercase">Starts In</div>
                        <div className="text-2xl font-black">{timeUntilStart}</div>
                      </div>) : null}
                  </div>
                </div>

                
                {isCurrent && (<div className="mt-4 pt-4 border-t-3 border-brand-black">
                    <div className="flex items-center gap-2 text-xs font-black uppercase mb-2">
                      <span>Progress</span>
                      <span className="ml-auto">
                        {Math.round((Number(currentSlot - phase.startSlot) /
                        Number(phase.endSlot - phase.startSlot)) *
                        100)}
                        %
                      </span>
                    </div>
                    <div className="w-full bg-brand-black border-3 border-current h-4 overflow-hidden">
                      <div className="bg-chartreuse h-full transition-all duration-500" style={{
                        width: `${Math.min(100, Math.round((Number(currentSlot - phase.startSlot) /
                            Number(phase.endSlot - phase.startSlot)) *
                            100))}%`,
                    }}/>
                    </div>
                  </div>)}
              </div>);
        })}
        </div>

        {timeline.length === 0 && (<div className="text-center text-whisper-white/70 py-8">
            <p className="font-black uppercase">No Upcoming Phases</p>
          </div>)}
      </div>

      
      {!isSlashingEnabled && slashingDisabledUntil !== null && slashingDisabledUntil > 0n && slashingDisableDuration !== null && (() => {
            const now = Math.floor(Date.now() / 1000);
            const disabledUntilSeconds = Number(slashingDisabledUntil);
            const executionDelay = BigInt(config.executionDelayInRounds);
            const lifetime = BigInt(config.lifetimeInRounds);
            const roundSize = BigInt(config.slashingRoundSize);
            const secondsUntilReEnabled = Math.max(0, disabledUntilSeconds - now);
            const slotsUntilReEnabled = Math.floor(secondsUntilReEnabled / config.slotDuration);
            const slotWhenReEnabled = currentSlot + BigInt(slotsUntilReEnabled);
            const roundWhenReEnabled = slotWhenReEnabled / roundSize;
            const pauseStartedSeconds = disabledUntilSeconds - Number(slashingDisableDuration);
            const slotWhenPauseStarted = slotWhenReEnabled - BigInt(Math.floor(Number(slashingDisableDuration) / config.slotDuration));
            const roundWhenPauseStarted = slotWhenPauseStarted / roundSize;
            const firstGroup1Round = roundWhenPauseStarted - executionDelay;
            const lastGroup2Round = roundWhenReEnabled - lifetime - 1n;
            const slashOffset = BigInt(config.slashOffsetInRounds);
            const roundSizeInEpochs = BigInt(config.slashingRoundSizeInEpochs);
            const firstBlockedTargetEpoch = (firstGroup1Round - slashOffset) * roundSizeInEpochs;
            const lastBlockedTargetEpoch = (lastGroup2Round - slashOffset + 1n) * roundSizeInEpochs - 1n;
            const executionDelaySeconds = Number(executionDelay) * Number(roundSize) * config.slotDuration;
            const executionWindowSeconds = (config.lifetimeInRounds - config.executionDelayInRounds) * Number(roundSize) * config.slotDuration;
            const formatTimestamp = (seconds: number) => {
                const date = new Date(seconds * 1000);
                return date.toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                });
            };
            const formatDuration = (seconds: number) => {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                if (hours > config.hoursThresholdForDayDisplay) {
                    const days = Math.floor(hours / config.hoursThresholdForDayDisplay);
                    const remainingHours = hours % config.hoursThresholdForDayDisplay;
                    return `${days}d ${remainingHours}h`;
                }
                if (hours > 0) {
                    return `${hours}h ${minutes}m`;
                }
                return `${minutes}m`;
            };
            return (<div className="mt-6 bg-malachite border-5 border-chartreuse p-6 shadow-brutal-chartreuse">
            
            <div className="flex items-start gap-4 mb-6">
              <div className="bg-chartreuse border-3 border-brand-black p-2">
                <svg className="w-10 h-10 text-brand-black stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8M12 12v8m0 0c0 1.1-.9 2-2 2"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-chartreuse font-black text-2xl uppercase mb-2 tracking-tight">
                  Slashing Execution Halted
                </h3>
                <p className="text-whisper-white text-sm font-bold">
                  Voting continues normally, but slashing will not lead to penalties.
                </p>
              </div>
            </div>

            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-brand-black border-3 border-chartreuse p-4">
                <div className="text-chartreuse text-xs font-black uppercase mb-1">Pause Started</div>
                <div className="text-whisper-white text-lg font-black">
                  {formatTimestamp(pauseStartedSeconds)}
                </div>
                <div className="text-whisper-white/70 text-xs font-bold mt-1">
                  Slot {slotWhenPauseStarted.toString()} • Round {roundWhenPauseStarted.toString()}
                </div>
              </div>

              <div className="bg-brand-black border-3 border-chartreuse p-4">
                <div className="text-chartreuse text-xs font-black uppercase mb-1">Re-enabled At</div>
                <div className="text-whisper-white text-lg font-black">
                  {formatTimestamp(disabledUntilSeconds)}
                </div>
                <div className="text-whisper-white/70 text-xs font-bold mt-1">
                  Slot {slotWhenReEnabled.toString()} • Round {roundWhenReEnabled.toString()}
                </div>
              </div>

              <div className="bg-brand-black border-3 border-chartreuse p-4">
                <div className="text-chartreuse text-xs font-black uppercase mb-1">Time Remaining</div>
                <div className="text-whisper-white text-lg font-black">
                  {secondsUntilReEnabled > 0 ? formatDuration(secondsUntilReEnabled) : 'Ending Soon'}
                </div>
                <div className="text-whisper-white/70 text-xs font-bold mt-1">
                  {slotsUntilReEnabled} slots remaining
                </div>
              </div>
            </div>


            <div className="bg-brand-black/50 border-3 border-chartreuse/50 p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="bg-chartreuse/20 border-2 border-chartreuse p-1.5 flex-shrink-0">
                  <svg className="w-5 h-5 text-chartreuse stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-chartreuse text-xs font-black uppercase mb-1">The Shift Effect</div>
                  <p className="text-whisper-white/90 text-xs font-bold leading-relaxed">
                    Due to the <span className="text-chartreuse">{formatTimeRemaining(executionDelaySeconds)}</span> execution delay, and the <span className="text-chartreuse">{formatTimeRemaining(executionWindowSeconds)}</span> execution window that follows, protected rounds are shifted.
                    Rounds voted on <span className="text-chartreuse">before</span> the pause may still be saved from slashing, while rounds voted on
                    <span className="text-chartreuse"> late in the pause</span> can be slashed after it ends. See below for the effective round numbers under protection.
                  </p>
                </div>
              </div>
            </div>


            <div className="bg-chartreuse border-5 border-brand-black p-6 text-center">
              <div className="text-brand-black text-sm font-black uppercase mb-3 tracking-wider">Total Protected Range</div>
              <div className="space-y-2">
                <div className="text-brand-black text-2xl font-black">
                  Rounds {firstGroup1Round > 0n ? firstGroup1Round.toString() : '0'} → {lastGroup2Round.toString()}
                </div>
                <div className="text-brand-black text-2xl font-black">
                  Epochs {firstBlockedTargetEpoch > 0n ? firstBlockedTargetEpoch.toString() : '0'} → {lastBlockedTargetEpoch.toString()}
                </div>
              </div>
            </div>
          </div>);
        })()}
    </div>);
}
