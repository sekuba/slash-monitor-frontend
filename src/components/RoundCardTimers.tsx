import type { DetectedSlashing } from '@/types/slashing';
import type { RoundPresentation } from '@/lib/utils';
import { formatTimeRemaining } from '@/lib/utils';

interface RoundCardTimersProps {
    slashing: DetectedSlashing;
    presentation: RoundPresentation;
}

export function RoundCardTimers({
    slashing,
    presentation,
}: RoundCardTimersProps) {
    const { isProtected, status } = presentation;
    const showExecutableTimer = !slashing.isVetoed &&
        !isProtected &&
        status === 'quorum-reached' &&
        presentation.secondsUntilExecutable !== undefined;
    const showExpirationTimer = (
        status === 'newly-executable' ||
        status === 'executable' ||
        status === 'vetoed' ||
        status === 'expired' ||
        (isProtected && status === 'quorum-reached')
    ) && presentation.secondsUntilExpires !== undefined;
    const hasContent = slashing.verificationStatus === 'partial' ||
        isProtected ||
        showExecutableTimer ||
        showExpirationTimer ||
        slashing.isVetoed;

    if (!hasContent) return null;

    return (
        <div className="space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
            {slashing.verificationStatus === 'partial' && (
                <TimerNotice
                    color="vermillion"
                    title="Partial verification"
                    detail={slashing.issues?.[0] ?? 'Round details are incomplete on the current RPCs'}
                    icon="warning"
                />
            )}
            {isProtected && (
                <TimerNotice color="aqua" title="Protected by global pause" icon="shield" />
            )}
            {showExecutableTimer && (
                <TimerNotice
                    color="vermillion"
                    title={`Executable in ${formatTimeRemaining(presentation.secondsUntilExecutable ?? 0)}`}
                    detail="Veto now to prevent execution"
                    icon="clock"
                />
            )}
            {showExpirationTimer && (
                <TimerNotice
                    color="vermillion"
                    title={presentation.isExpired || presentation.secondsUntilExpires === 0
                        ? 'Expired'
                        : `Expires in ${formatTimeRemaining(presentation.secondsUntilExpires ?? 0)}`}
                    icon="clock"
                />
            )}
            {slashing.isVetoed && (
                <TimerNotice color="aqua" title="Vetoed" icon="veto" />
            )}
        </div>
    );
}

function TimerNotice({
    color,
    title,
    detail,
    icon,
}: {
    color: 'aqua' | 'vermillion';
    title: string;
    detail?: string;
    icon: 'clock' | 'shield' | 'veto' | 'warning';
}) {
    const colorClass = color === 'aqua'
        ? 'border-aqua text-aqua'
        : 'border-vermillion text-vermillion';
    return (
        <div className={`flex items-center gap-3 border-3 bg-brand-black p-3 ${colorClass}`}>
            <TimerIcon kind={icon} />
            <div>
                <div className="text-sm font-black uppercase">{title}</div>
                {detail && (
                    <div className="mt-1 text-xs font-bold uppercase text-whisper-white/70">{detail}</div>
                )}
            </div>
        </div>
    );
}

function TimerIcon({ kind }: { kind: 'clock' | 'shield' | 'veto' | 'warning' }) {
    if (kind === 'shield') {
        return (
            <svg className="h-6 w-6 shrink-0 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M9 12l2 2 4-4m5.6-8A12 12 0 0 1 12 3a12 12 0 0 1-8.6-1A12 12 0 0 0 3 5c0 5.6 3.8 10.3 9 11.6C17.2 15.3 21 10.6 21 5c0-1-.1-2-.4-3Z" />
            </svg>
        );
    }
    if (kind === 'veto') {
        return (
            <svg className="h-6 w-6 shrink-0 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M6 18 18 6M6 6l12 12" />
            </svg>
        );
    }
    if (kind === 'warning') {
        return (
            <svg className="h-6 w-6 shrink-0 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M12 9v2m0 4h.01m-7 4h14L12 4 5 19Z" />
            </svg>
        );
    }
    return (
        <svg className="h-6 w-6 shrink-0 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="square" strokeLinejoin="miter" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
    );
}
