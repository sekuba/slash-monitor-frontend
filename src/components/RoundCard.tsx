import { useEffect, useState } from 'react';
import type { DetectedSlashing } from '@/types/slashing';
import { useSlashingStore } from '@/store/slashingStore';
import { deriveRoundPresentation } from '@/lib/utils';
import { getRoundVisual } from '@/lib/presentation';
import { RoundCardDetails } from './RoundCardDetails';
import { RoundCardSummary } from './RoundCardSummary';
import { RoundCardTimers } from './RoundCardTimers';

interface RoundCardProps {
    slashing: DetectedSlashing;
    sequencerOccurrences?: Map<string, number>;
}

export function RoundCard({
    slashing,
    sequencerOccurrences,
}: RoundCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [currentTime, setCurrentTime] = useState<number | null>(null);
    const {
        config,
        isSlashingEnabled,
        pauseStartedAtSlot,
        pauseEndsAtSlot,
    } = useSlashingStore();
    const presentation = deriveRoundPresentation(slashing, {
        config,
        isSlashingEnabled,
        pauseStartedAtSlot,
        pauseEndsAtSlot,
        now: currentTime ?? undefined,
    });
    const visual = getRoundVisual(presentation.status, presentation.isProtected);

    useEffect(() => {
        if (!config) return;
        const interval = window.setInterval(() => setCurrentTime(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, [config]);

    return (
        <article className={`relative border-5 transition-all hover:translate-x-1 hover:translate-y-1 hover:shadow-none ${visual.cardClass} ${
            presentation.isActionable ? `brutal-border-pulse ${visual.pulseClass}` : ''
        }`}>
            <div className="sr-only" aria-hidden="true">
                {slashing.payloadAddress && <span>Payload {slashing.payloadAddress}</span>}
                {slashing.slashActions?.map((action) => (
                    <span key={action.validator}> Sequencer {action.validator}</span>
                ))}
            </div>

            <RoundCardSummary
                slashing={slashing}
                visual={visual}
                isExpanded={isExpanded}
                onToggle={() => setIsExpanded((expanded) => !expanded)}
            />
            <RoundCardTimers slashing={slashing} presentation={presentation} />
            {isExpanded && (
                <RoundCardDetails
                    slashing={slashing}
                    sequencerOccurrences={sequencerOccurrences}
                    quorum={config?.quorum}
                />
            )}
        </article>
    );
}
