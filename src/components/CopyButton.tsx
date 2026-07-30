import { useEffect, useRef, useState } from 'react';

interface CopyButtonProps {
    value: string;
    ariaLabel?: string;
    className?: string;
    icon?: 'copy' | 'share';
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({
    value,
    ariaLabel = 'Copy to clipboard',
    className = '',
    icon = 'copy',
}: CopyButtonProps) {
    const [state, setState] = useState<CopyState>('idle');
    const resetTimer = useRef<number | null>(null);

    useEffect(() => () => {
        if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    }, []);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setState('copied');
        } catch {
            setState('failed');
        }
        if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => setState('idle'), 2_000);
    };

    const statusLabel = state === 'copied'
        ? icon === 'share' ? 'Link copied' : 'Copied'
        : state === 'failed'
            ? 'Copy failed'
            : ariaLabel;
    const accent = icon === 'share'
        ? 'hover:bg-aqua focus-visible:outline-aqua'
        : 'hover:bg-chartreuse focus-visible:outline-chartreuse';
    const color = state === 'failed'
        ? 'text-vermillion'
        : icon === 'share'
            ? 'text-aqua'
            : 'text-chartreuse';

    return (
        <button
            type="button"
            onClick={() => void copy()}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center bg-transparent transition-colors hover:text-brand-black focus-visible:outline-3 focus-visible:outline-offset-2 ${accent} ${color} ${className}`}
            title={statusLabel}
            aria-label={statusLabel}
            aria-live="polite"
        >
            {state === 'copied' ? (
                <svg className="h-5 w-5 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="square" strokeLinejoin="miter" d="m5 12 4 4L19 6" />
                </svg>
            ) : state === 'failed' ? (
                <svg className="h-5 w-5 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="square" strokeLinejoin="miter" d="M6 6l12 12M18 6 6 18" />
                </svg>
            ) : icon === 'share' ? (
                <svg className="h-5 w-5 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="square" strokeLinejoin="miter" d="M12 16V4m0 0L7 9m5-5 5 5" />
                    <path strokeLinecap="square" strokeLinejoin="miter" d="M5 13v6h14v-6" />
                </svg>
            ) : (
                <svg className="h-5 w-5 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <rect x="8" y="8" width="11" height="11" />
                    <path strokeLinecap="square" d="M16 8V5H5v11h3" />
                </svg>
            )}
        </button>
    );
}
