import { useEffect, useState } from 'react';
import { SequencerAddressControl } from './SequencerAddressControl';
import type { TargetedSequencer } from '@/types/slashing';

interface SlashingHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
    targetedSequencers: TargetedSequencer[];
}

const COUNCIL_ISSUES_URL = 'https://github.com/aztec-slash-veto/council/issues';

export function SlashingHelpModal({
    isOpen,
    onClose,
    targetedSequencers,
}: SlashingHelpModalProps) {
    const [filter, setFilter] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = overflow;
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const normalized = filter.trim().toLowerCase();
    const visible = targetedSequencers.filter((sequencer) =>
        !normalized || sequencer.address.toLowerCase().includes(normalized));
    const close = () => {
        setFilter('');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[70] bg-brand-black/85 p-3 sm:p-6" onClick={close}>
            <div
                className="mx-auto max-h-[calc(100vh-1.5rem)] max-w-5xl overflow-y-auto border-6 border-chartreuse bg-malachite shadow-brutal-chartreuse"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="slashing-help-title"
            >
                <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b-6 border-chartreuse bg-brand-black p-5">
                    <div>
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-chartreuse">Operator check</div>
                        <h2 id="slashing-help-title" className="mt-1 text-3xl font-black text-whisper-white">
                            Is my sequencer targeted?
                        </h2>
                        <p className="mt-2 text-sm font-bold text-whisper-white/70">
                            Search the live payloads below. A vote alone is not a slash.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={close}
                        className="brutal-button brutal-button--danger brutal-button--icon shrink-0"
                        aria-label="Close help"
                    >
                        <span className="text-2xl leading-none">×</span>
                    </button>
                </header>

                <div className="space-y-5 p-5 sm:p-7">
                    <section className="border-5 border-orchid bg-aubergine p-4 shadow-brutal-orchid">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-orchid">Live payloads</div>
                                <h3 className="mt-1 text-xl font-black text-whisper-white">
                                    {targetedSequencers.length} targeted sequencer{targetedSequencers.length === 1 ? '' : 's'}
                                </h3>
                            </div>
                            <div className="w-full sm:max-w-md">
                                <label htmlFor="targeted-sequencer-filter" className="sr-only">Filter sequencer address</label>
                                <input
                                    id="targeted-sequencer-filter"
                                    value={filter}
                                    onChange={(event) => setFilter(event.target.value)}
                                    placeholder="Find 0x…"
                                    className="min-h-11 w-full border-3 border-orchid bg-brand-black px-3 font-mono text-sm font-bold text-whisper-white placeholder:text-whisper-white/35 focus:outline-hidden"
                                />
                            </div>
                        </div>

                        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                            {visible.length === 0 ? (
                                <p className="border-3 border-orchid bg-brand-black p-4 text-sm font-bold text-whisper-white/70">
                                    {targetedSequencers.length === 0
                                        ? 'No live payload currently targets a sequencer.'
                                        : 'No address matches.'}
                                </p>
                            ) : visible.map((sequencer) => (
                                <div
                                    key={sequencer.address}
                                    className="flex flex-col gap-2 border-3 border-orchid bg-brand-black p-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <SequencerAddressControl
                                        address={sequencer.address}
                                        chars={9}
                                        showCopy
                                        className="font-mono text-sm font-black text-whisper-white"
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        {sequencer.rounds.map((round) => (
                                            <span key={round.toString()} className="border-2 border-chartreuse px-2 py-1 text-xs font-black text-chartreuse">
                                                R{round.toString()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="flex flex-col gap-4 border-5 border-vermillion bg-oxblood p-5 shadow-brutal-vermillion lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h3 className="text-xl font-black text-vermillion">Need a veto review?</h3>
                            <p className="mt-2 max-w-2xl text-sm font-bold text-whisper-white/75">
                                Escalate as soon as a quorum payload appears. Veto remains possible until execution.
                            </p>
                        </div>
                        <a
                            href={COUNCIL_ISSUES_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="brutal-button brutal-button--danger brutal-button--lg shrink-0"
                        >
                            Open council issue
                        </a>
                    </section>
                </div>
            </div>
        </div>
    );
}
