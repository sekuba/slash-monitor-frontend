import { useEffect, useState } from 'react';
import { useSlashingStore } from '@/store/slashingStore';
import { formatTimeRemaining } from '@/lib/utils';
import { calculateProtectedRoundRange } from '@/lib/pauseProtection';
import { calculateExecutableSlot } from '@/lib/slashingLifecycle';

interface SlashingTimelineProps {
    onOpenHelp: () => void;
}

export function SlashingTimeline({ onOpenHelp }: SlashingTimelineProps) {
    const { config, currentRound, currentSlot, currentEpoch, detectedSlashings, isSlashingEnabled, slashingDisabledUntil, slashingDisableDuration, pauseStartedAtSlot, pauseEndsAtSlot } = useSlashingStore();
    const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

    useEffect(() => {
        const interval = window.setInterval(() => {
            setNowSeconds(Math.floor(Date.now() / 1000));
        }, 1_000);
        return () => window.clearInterval(interval);
    }, []);

    if (!config) {
        return null;
    }

    // Calculate current round boundaries
    const roundSize = BigInt(config.slashingRoundSize);
    const roundSizeInEpochs = BigInt(config.slashingRoundSizeInEpochs);
    const slashOffset = BigInt(config.slashOffsetInRounds);

    const roundStartSlot = currentRound * roundSize;
    const roundEndSlot = (currentRound + 1n) * roundSize - 1n;
    const executableAtSlot = calculateExecutableSlot(currentRound, config);

    // Calculate target epochs (what we're voting on)
    const targetRound = currentRound - slashOffset;
    const targetEpochStart = targetRound * roundSizeInEpochs;
    const targetEpochEnd = targetEpochStart + roundSizeInEpochs - 1n;

    // Calculate how long ago the target round was
    const roundsAgo = currentRound - targetRound;
    const slotsAgo = Number(roundsAgo) * Number(roundSize);
    const secondsAgo = slotsAgo * config.slotDuration;

    // Get voting data
    const currentRoundSlashing = detectedSlashings.get(currentRound);
    const ballotCount = currentRoundSlashing?.ballotCount.toString() ?? '0';
    const quorum = config.quorum;
    const targetsAtQuorum = currentRoundSlashing?.affectedValidatorCount ?? 0;
    const hasReachedQuorum = targetsAtQuorum > 0;

    // Calculate progress
    const totalSlots = Number(roundEndSlot - roundStartSlot + 1n);
    const slotsElapsed = Math.min(totalSlots, Math.max(0, Number(currentSlot - roundStartSlot + 1n)));
    const progressPercent = Math.min(100, Math.round((slotsElapsed / totalSlots) * 100));

    // Calculate voting metrics
    const slotsLeft = Math.max(0, Number(roundEndSlot - currentSlot + 1n));
    const numBallots = Number(currentRoundSlashing?.ballotCount ?? 0n);
    const ballotParticipation = slotsElapsed > 0 ? Math.round((numBallots / slotsElapsed) * 100) : 0;
    const canStillReachQuorum = numBallots + slotsLeft >= quorum;

    // Calculate time remaining
    const slotsRemaining = Number(roundEndSlot - currentSlot);
    const secondsRemaining = Math.max(0, slotsRemaining * config.slotDuration);

    // Calculate when executable
    const slotsUntilExecutable = Number(executableAtSlot - currentSlot);
    const secondsUntilExecutable = Math.max(0, slotsUntilExecutable * config.slotDuration);

    const timeAgo = formatTimeRemaining(secondsAgo, {
        approximate: true,
        hoursThresholdForDayDisplay: config.hoursThresholdForDayDisplay,
    });

    return (<div className="mb-8">
      <div className="mb-6">
        <h2 className="text-3xl font-black text-whisper-white mb-4 flex items-center gap-4 uppercase">
          <div className="bg-aqua border-3 border-brand-black p-2">
            <svg className="w-8 h-8 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          slash vote progress
        </h2>

        {/* Current State Badges */}
        <div className="flex items-center gap-4 flex-wrap">
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
        <button
          onClick={onOpenHelp}
          className="shrink-0 bg-chartreuse text-brand-black border-5 border-brand-black px-6 py-3 normal-case tracking-normal text-base font-black shadow-brutal hover:-translate-y-0.5 transition-transform"
        >
          am i getting slashed?
        </button>
        </div>
      </div>

      {/* Current Voting Round Section */}
      <div className="bg-lapis border-5 border-aqua p-5 shadow-brutal-aqua animate-pulse">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="font-black text-lg uppercase tracking-tight text-aqua">
                Current Voting Round {currentRound.toString()}
              </h3>
              <span className="inline-flex items-center px-3 py-1 border-3 border-brand-black bg-chartreuse text-xs font-black uppercase text-brand-black">
                ACTIVE
              </span>
            </div>
            <p className="text-sm font-bold text-whisper-white mb-3">
              Sequencers vote on slashing offenses from round {targetRound.toString()} ({timeAgo} ago)
              <br></br>Each slot proposer submits one ballot that votes separately on every potential offender
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="bg-brand-black border-3 border-aqua px-4 py-2">
              <div className="opacity-75 mb-1 text-xs font-black uppercase text-aqua">Ends In</div>
              <div className="text-2xl font-black text-whisper-white">{formatTimeRemaining(secondsRemaining, { approximate: true, hoursThresholdForDayDisplay: config.hoursThresholdForDayDisplay })}</div>
            </div>
          </div>
        </div>

        {/* Round Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div className="bg-brand-black border-3 border-aqua px-3 py-2">
            <div className="text-aqua text-xs font-black uppercase mb-1">Voting Slots</div>
            <div className="text-whisper-white text-sm font-bold">
              {roundStartSlot.toString()} → {roundEndSlot.toString()}
            </div>
          </div>
          <div className="bg-brand-black border-3 border-aqua px-3 py-2">
            <div className="text-aqua text-xs font-black uppercase mb-1">Target Epochs</div>
            <div className="text-whisper-white text-sm font-bold">
              {targetEpochStart.toString()} → {targetEpochEnd.toString()}
            </div>
          </div>
        </div>

        {/* Voting Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className={`bg-brand-black border-3 px-3 py-2 ${hasReachedQuorum ? 'border-vermillion' : 'border-aqua'}`}>
            <div className={`text-xs font-black uppercase mb-1 ${hasReachedQuorum ? 'text-vermillion' : 'text-aqua'}`}>Ballots Cast</div>
            <div className="text-whisper-white text-sm font-bold">
              {ballotCount}
              {hasReachedQuorum && <span className="ml-2 text-chartreuse">✓ {targetsAtQuorum} TARGET{targetsAtQuorum === 1 ? '' : 'S'} AT QUORUM</span>}
            </div>
            <div className="mt-1 text-xs font-bold text-whisper-white/70">{quorum} matching ballots required per validator</div>
          </div>
          <div className={`bg-brand-black border-3 px-3 py-2 ${hasReachedQuorum ? 'border-vermillion' : 'border-aqua'}`}>
            <div className={`text-xs font-black uppercase mb-1 ${hasReachedQuorum ? 'text-vermillion' : 'text-aqua'}`}>Slots Left</div>
            <div className="text-whisper-white text-sm font-bold">
              {slotsLeft} slot{slotsLeft !== 1 ? 's' : ''}
            </div>
            {!hasReachedQuorum && !canStillReachQuorum && <div className="mt-1 text-xs font-bold text-whisper-white/70">No target can newly reach quorum</div>}
          </div>
          <div className={`bg-brand-black border-3 px-3 py-2 ${hasReachedQuorum ? 'border-vermillion' : 'border-aqua'}`}>
            <div className={`text-xs font-black uppercase mb-1 ${hasReachedQuorum ? 'text-vermillion' : 'text-aqua'}`}>Ballot Participation</div>
            <div className="text-whisper-white text-sm font-bold">
              {ballotParticipation}%
              <span className="ml-2 text-whisper-white/70 text-xs">({numBallots}/{slotsElapsed})</span>
            </div>
          </div>
        </div>

        {/* Execution Info */}
        {hasReachedQuorum && (
          <div className="bg-oxblood border-3 border-vermillion p-3 mb-4">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-vermillion stroke-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <div>
                <div className="text-vermillion font-black text-sm uppercase">
                  Executable in {formatTimeRemaining(secondsUntilExecutable, { approximate: true, hoursThresholdForDayDisplay: config.hoursThresholdForDayDisplay })}
                </div>
                <div className="text-whisper-white/70 text-xs font-bold mt-1">
                  Slashing payload can be executed at slot {executableAtSlot.toString()} unless vetoed
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        <div className="pt-4 border-t-3 border-brand-black">
          <div className="flex items-center gap-2 text-xs font-black uppercase mb-2 text-aqua">
            <span>Voting Progress</span>
            <span className="ml-auto">{progressPercent}% ({slotsElapsed}/{totalSlots} slots)</span>
          </div>
          <div className="w-full bg-brand-black border-3 border-aqua h-4 overflow-hidden">
            <div
              className="bg-chartreuse h-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-2 text-whisper-white/70 text-xs font-bold">
            For voting rounds that reach quorum, a {formatTimeRemaining(
              config.executionDelayInRounds * config.slashingRoundSize * config.slotDuration,
              { approximate: true, hoursThresholdForDayDisplay: config.hoursThresholdForDayDisplay }
            )} execution delay applies before they can be executed, if not vetoed.
          </div>
        </div>
      </div>

      {/* Global Pause Section */}
      {!isSlashingEnabled && slashingDisabledUntil > 0n && pauseStartedAtSlot !== null && pauseEndsAtSlot !== null && (() => {
            // Timing calculations
            const pauseEndsAt = Number(slashingDisabledUntil);
            const pauseStartedAt = pauseEndsAt - Number(slashingDisableDuration);
            const secondsUntilPauseEnds = Math.max(0, pauseEndsAt - nowSeconds);
            const slotsUntilPauseEnds = Number(pauseEndsAtSlot > currentSlot ? pauseEndsAtSlot - currentSlot : 0n);

            // Calculate protected round range using shared utility
            const {
              hasProtectedRounds,
              firstProtectedRound,
              lastProtectedRound,
              slotWhenPauseEnds,
              slotWhenPauseStarted,
              roundWhenPauseEnds,
              roundWhenPauseStarted,
              firstProtectedEpoch,
              lastProtectedEpoch,
            } = calculateProtectedRoundRange(config, pauseStartedAtSlot, pauseEndsAtSlot);

            // Calculate timing values for display
            const roundSize = BigInt(config.slashingRoundSize);
            const executionDelay = BigInt(config.executionDelayInRounds);
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
            return (<div className="mt-6 bg-malachite border-5 border-chartreuse p-6 shadow-brutal-chartreuse">

            <div className="flex items-start gap-4 mb-6">
              <div className="bg-chartreuse border-3 border-brand-black p-2">
                <svg className="w-10 h-10 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                  {formatTimestamp(pauseStartedAt)}
                </div>
                <div className="text-whisper-white/70 text-xs font-bold mt-1">
                  Slot {slotWhenPauseStarted.toString()} • Round {roundWhenPauseStarted.toString()}
                </div>
              </div>

              <div className="bg-brand-black border-3 border-chartreuse p-4">
                <div className="text-chartreuse text-xs font-black uppercase mb-1">Re-enabled At</div>
                <div className="text-whisper-white text-lg font-black">
                  {formatTimestamp(pauseEndsAt)}
                </div>
                <div className="text-whisper-white/70 text-xs font-bold mt-1">
                  Slot {slotWhenPauseEnds.toString()} • Round {roundWhenPauseEnds.toString()}
                </div>
              </div>

              <div className="bg-brand-black border-3 border-chartreuse p-4">
                <div className="text-chartreuse text-xs font-black uppercase mb-1">Time Remaining</div>
                <div className="text-whisper-white text-lg font-black">
                  {secondsUntilPauseEnds > 0 ? formatTimeRemaining(secondsUntilPauseEnds, { hoursThresholdForDayDisplay: config.hoursThresholdForDayDisplay }) : 'Ending Soon'}
                </div>
                <div className="text-whisper-white/70 text-xs font-bold mt-1">
                  {slotsUntilPauseEnds} slots remaining
                </div>
              </div>
            </div>


            <div className="bg-brand-black/50 border-3 border-chartreuse/50 p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="bg-chartreuse/20 border-2 border-chartreuse p-1.5 shrink-0">
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
                  {hasProtectedRounds
                    ? `Rounds ${firstProtectedRound > 0n ? firstProtectedRound.toString() : '0'} → ${lastProtectedRound.toString()}`
                    : 'No rounds expire during this pause'}
                </div>
                {hasProtectedRounds && (
                  <div className="text-brand-black text-2xl font-black">
                    Epochs {firstProtectedEpoch > 0n ? firstProtectedEpoch.toString() : '0'} → {lastProtectedEpoch.toString()}
                  </div>
                )}
              </div>
            </div>
          </div>);
        })()}
    </div>);
}
