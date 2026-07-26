import { SlashingProcess } from './SlashingProcess';
import { useSlashingStore } from '@/store/slashingStore';
import { calculateExecutableSlot } from '@/lib/slashingLifecycle';
import { formatTimeRemaining } from '@/lib/utils';

interface SlashingTimelineProps {
    onOpenHelp: () => void;
}

export function SlashingTimeline({ onOpenHelp }: SlashingTimelineProps) {
    const {
        config,
        currentRound,
        currentSlot,
        currentEpoch,
        detectedSlashings,
        isSlashingEnabled,
        slashingDisabledUntil,
        slashingDisableDuration,
    } = useSlashingStore();

    if (!config) return null;

    const roundSize = BigInt(config.slashingRoundSize);
    const roundStartSlot = currentRound * roundSize;
    const roundEndSlot = (currentRound + 1n) * roundSize - 1n;
    const totalSlots = config.slashingRoundSize;
    const elapsedSlots = Math.min(
        totalSlots,
        Math.max(0, Number(currentSlot - roundStartSlot + 1n)),
    );
    const remainingSlots = Math.max(0, Number(roundEndSlot - currentSlot));
    const progress = Math.round((elapsedSlots / totalSlots) * 100);
    const round = detectedSlashings.get(currentRound);
    const ballots = Number(round?.ballotCount ?? 0n);
    const targetsAtQuorum = round?.affectedValidatorCount ?? 0;
    const targetRound = currentRound >= BigInt(config.slashOffsetInRounds)
        ? currentRound - BigInt(config.slashOffsetInRounds)
        : null;
    const targetEpochStart = targetRound === null
        ? null
        : targetRound * BigInt(config.slashingRoundSizeInEpochs);
    const targetEpochEnd = targetEpochStart === null
        ? null
        : targetEpochStart + BigInt(config.slashingRoundSizeInEpochs) - 1n;
    const executableSlot = calculateExecutableSlot(currentRound, config);
    const pauseEndsAt = !isSlashingEnabled && slashingDisabledUntil > 0n
        ? new Date(Number(slashingDisabledUntil) * 1_000).toISOString()
        : null;

    return (
        <section className="mb-8 space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-aqua">Client-side L1</div>
                    <h2 className="mt-1 text-3xl font-black text-whisper-white">Current slash vote</h2>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <ChainBadge label="Slot" value={currentSlot.toString()} color="aqua" />
                        <ChainBadge label="Epoch" value={currentEpoch.toString()} color="orchid" />
                        <ChainBadge label="Round" value={currentRound.toString()} color="chartreuse" />
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onOpenHelp}
                    className="brutal-button brutal-button--lg self-start sm:self-auto"
                >
                    Am I targeted?
                </button>
            </div>

            <article className="brutal-border-pulse border-5 border-aqua bg-lapis p-5 shadow-brutal-aqua [--pulse-color:var(--color-aqua)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h3 className="text-xl font-black text-aqua">Round {currentRound.toString()}</h3>
                            <span className="border-3 border-brand-black bg-chartreuse px-2 py-1 text-xs font-black uppercase text-brand-black">
                                Voting
                            </span>
                        </div>
                        <p className="mt-2 text-sm font-bold text-whisper-white/75">
                            {targetEpochStart === null
                                ? 'Voting is not open yet.'
                                : `Votes cover target epochs ${targetEpochStart.toString()}–${targetEpochEnd!.toString()}. Quorum is counted separately for each sequencer.`}
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[34rem]">
                        <RoundFact label="Ballots" value={`${ballots}`} note={`${config.quorum} needed`} />
                        <RoundFact label="At quorum" value={`${targetsAtQuorum}`} note="sequencers" danger={targetsAtQuorum > 0} />
                        <RoundFact label="Slots left" value={`${Math.max(0, Number(roundEndSlot - currentSlot + 1n))}`} note={`${formatTimeRemaining(remainingSlots * config.slotDuration, { approximate: true })}`} />
                        <RoundFact label="Opens" value={executableSlot.toString()} note="execution slot" danger={targetsAtQuorum > 0} />
                    </div>
                </div>

                <div className="mt-5">
                    <div className="mb-2 flex justify-between gap-3 text-xs font-black uppercase text-aqua">
                        <span>Round progress</span>
                        <span>{elapsedSlots}/{totalSlots} slots</span>
                    </div>
                    <div className="h-4 border-3 border-aqua bg-brand-black">
                        <div className="h-full bg-chartreuse transition-[width] duration-500" style={{ width: `${progress}%` }} />
                    </div>
                </div>
            </article>

            <SlashingProcess
                timing={{
                    slashOffsetRounds: config.slashOffsetInRounds,
                    roundSizeSlots: config.slashingRoundSize,
                    roundSizeEpochs: config.slashingRoundSizeInEpochs,
                    quorum: config.quorum,
                    roundDurationSeconds: config.slashingRoundSize * config.slotDuration,
                    executionDelayRounds: config.executionDelayInRounds,
                    executionDelaySeconds: config.executionDelayInRounds *
                        config.slashingRoundSize *
                        config.slotDuration,
                    executionWindowRounds: config.lifetimeInRounds -
                        config.executionDelayInRounds,
                    executionWindowSeconds: (config.lifetimeInRounds - config.executionDelayInRounds) *
                        config.slashingRoundSize *
                        config.slotDuration,
                }}
                pause={{
                    active: !isSlashingEnabled,
                    endsAt: pauseEndsAt,
                    durationSeconds: Number(slashingDisableDuration),
                }}
            />
        </section>
    );
}

function ChainBadge({
    label,
    value,
    color,
}: {
    label: string;
    value: string;
    color: 'aqua' | 'orchid' | 'chartreuse';
}) {
    const palette = {
        aqua: 'border-aqua text-aqua',
        orchid: 'border-orchid text-orchid',
        chartreuse: 'border-chartreuse text-chartreuse',
    }[color];
    return (
        <span className={`border-3 bg-brand-black px-3 py-2 text-xs font-black uppercase ${palette}`}>
            {label} <span className="ml-1 text-whisper-white">{value}</span>
        </span>
    );
}

function RoundFact({
    label,
    value,
    note,
    danger = false,
}: {
    label: string;
    value: string;
    note: string;
    danger?: boolean;
}) {
    return (
        <div className={`border-3 bg-brand-black p-3 ${danger ? 'border-vermillion' : 'border-aqua'}`}>
            <div className={`text-[0.65rem] font-black uppercase ${danger ? 'text-vermillion' : 'text-aqua'}`}>{label}</div>
            <div className="mt-1 text-lg font-black text-whisper-white">{value}</div>
            <div className="text-[0.65rem] font-bold text-whisper-white/55">{note}</div>
        </div>
    );
}
