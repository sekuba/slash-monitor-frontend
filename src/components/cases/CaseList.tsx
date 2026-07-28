import { useId } from 'react';
import { categorizeCases, type SlashingCase } from '@/domain/slashingCase';
import { CaseCard } from './CaseCard';

interface CaseListProps {
    cases: readonly SlashingCase[];
    title?: string;
}

export function CaseList({
    cases,
    title = 'Slashing cases',
}: CaseListProps) {
    const categorized = categorizeCases(cases);
    const headingId = useId();

    return (
        <section aria-labelledby={headingId}>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-aqua">
                        Pinned Ethereum evidence
                    </div>
                    <h2 id={headingId} className="mt-1 text-3xl font-black text-whisper-white">
                        {title}
                    </h2>
                </div>
                <span className="border-3 border-brand-black bg-aqua px-3 py-2 text-xs font-black uppercase text-brand-black">
                    {cases.length} shown
                </span>
            </div>

            {cases.length === 0 ? (
                <p className="border-5 border-aqua bg-lapis p-5 text-sm font-bold text-whisper-white shadow-brutal-aqua">
                    No slashing cases were provided by this source snapshot.
                </p>
            ) : (
                <div className="space-y-8">
                    <CaseSection
                        heading="Open cases"
                        cases={categorized.open}
                        empty="No open slashing cases are present in this source snapshot."
                    />
                    {categorized.closed.length > 0 && (
                        <CaseSection heading="Closed cases" cases={categorized.closed} />
                    )}
                </div>
            )}
        </section>
    );
}

function CaseSection({
    heading,
    cases,
    empty,
}: {
    heading: string;
    cases: readonly SlashingCase[];
    empty?: string;
}) {
    return (
        <section>
            <div className="mb-4 flex items-center gap-3">
                <h3 className="text-xl font-black text-whisper-white">{heading}</h3>
                <span className="border-3 border-whisper-white/30 bg-brand-black px-2 py-1 text-xs font-black text-aqua">
                    {cases.length}
                </span>
            </div>
            {cases.length === 0 ? (
                empty && (
                    <p className="border-3 border-aqua bg-brand-black p-4 text-sm font-bold text-whisper-white/75">
                        {empty}
                    </p>
                )
            ) : (
                <div className="grid gap-6">
                    {cases.map((slashingCase) => (
                        <CaseCard key={slashingCase.id} slashingCase={slashingCase} />
                    ))}
                </div>
            )}
        </section>
    );
}
