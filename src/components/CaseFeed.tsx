import type {
    ProtocolSnapshot,
    SlashingCase,
} from '../../shared/protocol/index.ts';
import { selectCaseFeed } from '@/lib/caseFeed';
import { CaseTimeline } from './CaseTimeline';

export function CaseFeed({
    cases,
    protocol,
    selectedCaseId,
    evidenceMode,
    onOpenProtocolGuide,
}: {
    cases: SlashingCase[];
    protocol: ProtocolSnapshot | null;
    selectedCaseId: string | null;
    evidenceMode: 'l1' | 'backend';
    onOpenProtocolGuide: (protocol: ProtocolSnapshot | null) => void;
}) {
    const feed = selectCaseFeed(cases);
    const count = feed.active.length;

    return (
        <section id="active-case-feed" className="mb-10 scroll-mt-4">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-3xl font-black text-whisper-white">
                        Case feed
                    </h2>
                    <p className="mt-2 max-w-4xl text-sm font-bold text-whisper-white/70">
                        {evidenceMode === 'backend'
                            ? 'Node evidence and L1 status from PINGME.'
                            : 'L1 votes, candidates, execution, and stake outcomes from this browser.'}
                        {' '}Open cases are followed by recent execution outcomes.
                    </p>
                </div>
                <span className="w-fit border-3 border-brand-black bg-vermillion px-3 py-2 text-sm font-black uppercase text-brand-black">
                    {count} active
                </span>
            </div>

            {feed.active.length > 0 ? (
                <div className="grid gap-6">
                    {feed.active.map((item) => (
                        <CaseTimeline
                            key={item.id}
                            item={item}
                            protocol={protocol}
                            selected={selectedCaseId === item.id}
                            showSequencer
                            onOpenProtocolGuide={onOpenProtocolGuide}
                        />
                    ))}
                </div>
            ) : (
                <div className="border-5 border-chartreuse bg-malachite p-6 shadow-brutal-chartreuse">
                    <h3 className="text-xl font-black text-chartreuse">No active cases</h3>
                    <p className="mt-2 text-sm font-bold text-whisper-white/70">
                        No open slashing cases are visible from the current sources.
                    </p>
                </div>
            )}

            {feed.recentlyExecuted.length > 0 && (
                <div className="mt-8">
                    <h3 className="mb-4 text-xl font-black text-aqua">
                        Recent execution outcomes
                    </h3>
                    <div className="grid gap-6">
                        {feed.recentlyExecuted.map((item) => (
                            <CaseTimeline
                                key={item.id}
                                item={item}
                                protocol={protocol}
                                selected={selectedCaseId === item.id}
                                showSequencer
                                onOpenProtocolGuide={onOpenProtocolGuide}
                            />
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}
