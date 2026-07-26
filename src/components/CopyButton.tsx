import { useEffect, useRef, useState } from 'react';

interface CopyButtonProps {
    value: string;
    ariaLabel?: string;
    className?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({
    value,
    ariaLabel = 'Copy to clipboard',
    className = '',
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
        ? 'Copied'
        : state === 'failed'
            ? 'Copy failed'
            : ariaLabel;

    return (
        <button
            type="button"
            onClick={() => void copy()}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center bg-transparent transition-colors hover:bg-chartreuse hover:text-brand-black focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-chartreuse ${state === 'failed' ? 'text-vermillion' : 'text-chartreuse'} ${className}`}
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
            ) : (
                <svg className="h-5 w-5 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <rect x="8" y="8" width="11" height="11" />
                    <path strokeLinecap="square" d="M16 8V5H5v11h3" />
                </svg>
            )}
        </button>
    );
}
