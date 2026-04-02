import { useEffect } from 'react';
import { useSlashingStore } from '@/store/slashingStore';
import { formatNumber, formatTimeRemaining } from '@/lib/utils';

interface SlashingHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const COUNCIL_ISSUES_URL = 'https://github.com/aztec-slash-veto/council/issues';

export function SlashingHelpModal({ isOpen, onClose }: SlashingHelpModalProps) {
    const { config } = useSlashingStore();

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = originalOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen || !config) {
        return null;
    }

    const hoursThresholdForDayDisplay = config.hoursThresholdForDayDisplay;
    const roundSeconds = config.slashingRoundSize * config.slotDuration;
    const votingDelaySeconds = config.slashOffsetInRounds * roundSeconds;
    const executionDelaySeconds = config.executionDelayInRounds * roundSeconds;
    const payloadLifetimeSeconds = config.lifetimeInRounds * roundSeconds;

    const roundDuration = formatTimeRemaining(roundSeconds, {
        approximate: true,
        hoursThresholdForDayDisplay,
    });
    const votingDelay = formatTimeRemaining(votingDelaySeconds, {
        approximate: true,
        hoursThresholdForDayDisplay,
    });
    const executionDelay = formatTimeRemaining(executionDelaySeconds, {
        approximate: true,
        hoursThresholdForDayDisplay,
    });
    const payloadLifetime = formatTimeRemaining(payloadLifetimeSeconds, {
        approximate: true,
        hoursThresholdForDayDisplay,
    });

    return (
        <div
            className="fixed inset-0 z-[70] bg-brand-black/80 p-4 md:p-8"
            onClick={onClose}
        >
            <div
                className="mx-auto max-w-5xl border-6 border-chartreuse bg-malachite shadow-brutal-chartreuse max-h-[calc(100vh-2rem)] overflow-y-auto"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="slashing-help-title"
            >
                <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b-6 border-chartreuse bg-brand-black p-6">
                    <div>
                        <div className="mb-3 inline-flex items-center gap-2 border-3 border-brand-black bg-aqua px-3 py-1 text-xs font-black uppercase tracking-wider text-brand-black">
                            Operator Help
                        </div>
                        <h2 id="slashing-help-title" className="text-3xl font-black text-chartreuse">
                            Am I Getting Slashed?
                        </h2>
                        <p className="mt-2 max-w-3xl text-sm font-bold text-whisper-white">
                            How to tell whether your node is in a slashing payload, when it can show up on this
                            dashboard, and when the SlashVeto council can still step in.
                        </p>
                    </div>

                    <button
                        onClick={onClose}
                        className="shrink-0 border-5 border-vermillion bg-vermillion p-3 text-brand-black shadow-brutal hover:-translate-y-0.5"
                        aria-label="Close help"
                    >
                        <svg className="h-7 w-7 stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="space-y-6 p-6 md:p-8">
                    <div className="border-5 border-aqua bg-lapis p-6 shadow-brutal-aqua">
                        <div className="mb-4 flex items-center gap-3">
                            <div className="border-3 border-brand-black bg-aqua p-2">
                                <svg className="h-8 w-8 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M9 12h6m-3-3v6m9-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h3 className="text-2xl font-black text-aqua">How To Check</h3>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="border-3 border-aqua bg-brand-black p-4">
                                <div className="mb-2 text-xs font-black uppercase tracking-wider text-aqua">
                                    What Counts
                                </div>
                                <p className="text-sm font-bold text-whisper-white">
                                    You are only in a live slashing payload if your sequencer address appears inside a
                                    round card under <span className="text-aqua">Sequencers To Slash</span>.
                                </p>
                            </div>

                            <div className="border-3 border-aqua bg-brand-black p-4">
                                <div className="mb-2 text-xs font-black uppercase tracking-wider text-aqua">
                                    Fastest Way
                                </div>
                                <p className="text-sm font-bold text-whisper-white">
                                    Use your browser find for your sequencer address. Full addresses are indexed even
                                    when cards are collapsed, so page search still works.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="border-5 border-orchid bg-aubergine p-6 shadow-brutal-orchid">
                        <div className="mb-5 flex items-center gap-3">
                            <div className="border-3 border-brand-black bg-orchid p-2">
                                <svg className="h-8 w-8 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M3 12h4l2-7 4 14 2-7h6" />
                                </svg>
                            </div>
                            <h3 className="text-2xl font-black text-orchid">Timeline</h3>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div className="border-5 border-brand-black bg-whisper-white p-4 text-brand-black shadow-brutal">
                                <div className="mb-2 text-xs font-black uppercase tracking-wider">1. Offense Happens</div>
                                <p className="text-sm font-bold">
                                    A node offense or misbehaviour happens first. This dashboard does not show it
                                    instantly because the other sequencers first need to vote on each potential offense.
                                </p>
                            </div>

                            <div className="border-5 border-brand-black bg-chartreuse p-4 text-brand-black shadow-brutal">
                                <div className="mb-2 text-xs font-black uppercase tracking-wider">2. Voting Round Arrives</div>
                                <p className="text-sm font-bold">
                                    The offense is revisited <span>{config.slashOffsetInRounds} round{config.slashOffsetInRounds === 1 ? '' : 's'}</span> later,
                                    roughly <span>{votingDelay}</span>. Each round lasts about <span>{roundDuration}</span>.
                                </p>
                            </div>

                            <div className="border-5 border-brand-black bg-aqua p-4 text-brand-black shadow-brutal">
                                <div className="mb-2 text-xs font-black uppercase tracking-wider">3. It Shows Up Here</div>
                                <p className="text-sm font-bold">
                                    The first time you can expect it here is that later voting round, in which
                                    sequencers vote on the earlier offenders. If the round reaches quorum at <span>{formatNumber(config.quorum)}</span>{' '}
                                    votes, the dashboard shows it as a concrete slashing payload with addresses,
                                    amounts and countdowns.
                                </p>
                            </div>

                            <div className="border-5 border-brand-black bg-vermillion p-4 text-brand-black shadow-brutal">
                                <div className="mb-2 text-xs font-black uppercase tracking-wider">4. Delay Before Execution</div>
                                <p className="text-sm font-bold">
                                    Even after reaching quorum, execution is delayed by another <span>{config.executionDelayInRounds} round{config.executionDelayInRounds === 1 ? '' : 's'}</span>,
                                    about <span>{executionDelay}</span> during which it can be vetoed. The payload&apos;s full lifetime from the end of
                                    its voting round is about <span>{payloadLifetime}</span>.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                        <div className="border-5 border-vermillion bg-oxblood p-6 shadow-brutal-vermillion">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="border-3 border-brand-black bg-vermillion p-2">
                                    <svg className="h-8 w-8 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <h3 className="text-2xl font-black text-vermillion">When Council Can Intervene</h3>
                            </div>

                            <div className="space-y-4">
                                <div className="border-3 border-vermillion bg-brand-black p-4">
                                    <p className="text-sm font-bold text-whisper-white">
                                        The SlashVeto council can veto a slashing payload any time before it is
                                        executed. On this dashboard, treat the first <span className="text-vermillion">Quorum Reached</span> card
                                        as the moment to escalate.
                                    </p>
                                </div>

                                <div className="border-3 border-vermillion bg-brand-black p-4">
                                    <p className="text-sm font-bold text-whisper-white">
                                        The window stays open through <span className="text-vermillion">Newly Executable</span> and <span className="text-vermillion">Executable</span>.
                                        Once a round is <span className="text-vermillion">Executed</span>, it is too late for a veto.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="border-5 border-chartreuse bg-malachite p-6 shadow-brutal-chartreuse">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="border-3 border-brand-black bg-chartreuse p-2">
                                    <svg className="h-8 w-8 text-brand-black stroke-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M8 10h8M8 14h5m8-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <h3 className="text-2xl font-black text-chartreuse">Alert The Council</h3>
                            </div>

                            <p className="mb-4 text-sm font-bold text-whisper-white">
                                If you want the SlashVeto council to review your case, create an issue on their Github and follow the issue template to make your case.
                            </p>

                            <a
                                href={COUNCIL_ISSUES_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex w-full items-center justify-center border-5 border-brand-black bg-chartreuse px-4 py-3 text-center text-sm font-black text-brand-black shadow-brutal transition-transform hover:-translate-y-0.5"
                            >
                                Open council/issues
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
