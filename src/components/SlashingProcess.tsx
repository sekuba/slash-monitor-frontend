export interface SlashingProcessTiming {
    slashOffsetRounds: number;
    roundSizeSlots: number;
    roundSizeEpochs: number;
    quorum: number;
    roundDurationSeconds: number;
    executionDelayRounds: number;
    executionDelaySeconds: number;
    executionWindowRounds: number;
    executionWindowSeconds: number;
    inactivity?: {
        targetPercentage: number;
        consecutiveEpochs: number;
    } | null;
}

interface SlashingProcessProps {
    timing: SlashingProcessTiming;
    pause?: {
        active: boolean;
        endsAt?: string | null;
        durationSeconds?: number | null;
    };
    title?: string;
}

interface ProcessStage {
    number: string;
    kind: string;
    title: string;
    detail: string;
    border: string;
    background: string;
    text: string;
}

interface ProcessTransition {
    label: string;
    rounds: number;
    epochs: number;
    seconds: number;
}

export function SlashingProcess({
    timing,
    pause,
    title = 'Offense → vote → execution window',
}: SlashingProcessProps) {
    const inactivityRule = timing.inactivity
        ? `Inactivity: ≥${formatPercent(timing.inactivity.targetPercentage)} missed duties for ${timing.inactivity.consecutiveEpochs} consecutive epoch${timing.inactivity.consecutiveEpochs === 1 ? '' : 's'}`
        : 'Pending node evidence; not an L1 slash';
    const stages: ProcessStage[] = [
        {
            number: '01',
            kind: 'Node · pend',
            title: 'Node records an offense locally',
            detail: inactivityRule,
            border: 'border-orchid',
            background: 'bg-aubergine',
            text: 'text-orchid',
        },
        {
            number: '02',
            kind: 'L1 · voting',
            title: 'Sequencers vote on slashing',
            detail: `min. ${timing.quorum} ballots per target · 1 round / ${timing.roundSizeEpochs} epochs / ${formatProtocolDuration(timing.roundDurationSeconds)}`,
            border: 'border-aqua',
            background: 'bg-lapis',
            text: 'text-aqua',
        },
        {
            number: '03',
            kind: 'L1 · exe',
            title: 'Payload can be executed',
            detail: 'The slashVeto council can block execution',
            border: 'border-vermillion',
            background: 'bg-oxblood',
            text: 'text-vermillion',
        },
        {
            number: '04',
            kind: 'L1 · closed',
            title: 'Payload expires',
            detail: 'If not executed, this payload can no longer slash',
            border: 'border-chartreuse',
            background: 'bg-malachite',
            text: 'text-chartreuse',
        },
    ];
    const transitions: ProcessTransition[] = [
        {
            label: 'Target offset',
            rounds: timing.slashOffsetRounds,
            epochs: timing.slashOffsetRounds * timing.roundSizeEpochs,
            seconds: timing.slashOffsetRounds * timing.roundDurationSeconds,
        },
        {
            label: 'After vote round closes',
            rounds: timing.executionDelayRounds,
            epochs: timing.executionDelayRounds * timing.roundSizeEpochs,
            seconds: timing.executionDelaySeconds,
        },
        {
            label: 'Execution window',
            rounds: timing.executionWindowRounds,
            epochs: timing.executionWindowRounds * timing.roundSizeEpochs,
            seconds: timing.executionWindowSeconds,
        },
    ];

    return (
        <section className="border-5 border-aqua bg-lapis p-4 shadow-brutal-aqua sm:p-5">
            <div className="mb-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-aqua">Protocol path</div>
                <h3 className="mt-1 text-xl font-black text-whisper-white">{title}</h3>
            </div>

            <div className="flex flex-col gap-2 xl:flex-row xl:items-stretch">
                {stages.map((stage, index) => (
                    <div key={stage.number} className="contents">
                        <Stage stage={stage} />
                        {transitions[index] && <Transition transition={transitions[index]} />}
                    </div>
                ))}
            </div>

            {pause?.active && (
                <div className="mt-4 border-3 border-chartreuse bg-malachite p-3 text-xs font-bold text-whisper-white">
                    <span className="font-black uppercase text-chartreuse">Global pause active.</span>{' '}
                    Execution is blocked; expiry is unchanged.
                    {pause.durationSeconds
                        ? ` Fixed pause: ${formatProtocolDuration(pause.durationSeconds)}.`
                        : ''}
                    {pause.endsAt ? ` Scheduled end: ${formatProtocolDate(pause.endsAt)}.` : ''}
                </div>
            )}
        </section>
    );
}

function Stage({ stage }: { stage: ProcessStage }) {
    return (
        <article className={`flex min-h-40 flex-1 flex-col border-3 p-3 ${stage.border} ${stage.background}`}>
            <div className={`flex items-center justify-between gap-2 text-xs font-black uppercase ${stage.text}`}>
                <span className="font-mono">{stage.number}</span>
                <span>{stage.kind}</span>
            </div>
            <p className="mt-5 text-base font-black text-whisper-white">{stage.title}</p>
            <p className="mt-auto pt-4 text-[0.7rem] font-bold text-whisper-white/65">{stage.detail}</p>
        </article>
    );
}

function Transition({ transition }: { transition: ProcessTransition }) {
    return (
        <div className="flex shrink-0 items-center xl:w-44" aria-label={`${transition.label}: ${transition.rounds} rounds`}>
            <div className="relative w-full border-3 border-whisper-white bg-brand-black px-3 py-3 text-center text-whisper-white xl:py-4">
                <span
                    className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-whisper-white px-1 font-black text-brand-black xl:-right-3 xl:bottom-auto xl:left-auto xl:top-1/2 xl:translate-x-0 xl:-translate-y-1/2"
                    aria-hidden="true"
                >
                    →
                </span>
                <div className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-whisper-white/55">
                    {transition.label}
                </div>
                <div className="mt-1 text-xs font-black">
                    {formatCount(transition.rounds, 'round')} · {formatCount(transition.epochs, 'epoch')}
                </div>
                <div className="mt-1 font-mono text-[0.7rem] font-black text-whisper-white">
                    {formatProtocolDuration(transition.seconds)}
                </div>
            </div>
        </div>
    );
}

export function formatProtocolDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    const secondsPart = remainder > 0 ? ` ${remainder}s` : '';
    if (days > 0) return `${days}d ${hours}h ${minutes}m${secondsPart}`;
    if (hours > 0) return `${hours}h ${minutes}m${secondsPart}`;
    if (minutes > 0) return `${minutes}m${secondsPart}`;
    return `${seconds}s`;
}

function formatCount(value: number, unit: string): string {
    return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function formatProtocolDate(value: string): string {
    try {
        return new Date(value).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return value;
    }
}
