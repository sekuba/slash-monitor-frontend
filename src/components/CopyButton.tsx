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
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center border-3 border-brand-black text-brand-black shadow-[3px_3px_0_var(--color-brand-black)] transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none ${state === 'failed' ? 'bg-vermillion' : state === 'copied' ? 'bg-chartreuse' : 'bg-whisper-white'} ${className}`}
            title={statusLabel}
            aria-label={statusLabel}
            aria-live="polite"
        >
            {state === 'copied' ? (
                <svg className="h-4 w-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="square" strokeLinejoin="miter" d="m5 12 4 4L19 6" />
                </svg>
            ) : state === 'failed' ? (
                <svg className="h-4 w-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="square" strokeLinejoin="miter" d="M6 6l12 12M18 6 6 18" />
                </svg>
            ) : (
                <svg className="h-4 w-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <rect x="8" y="8" width="11" height="11" />
                    <path strokeLinecap="square" d="M16 8V5H5v11h3" />
                </svg>
            )}
        </button>
    );
}
