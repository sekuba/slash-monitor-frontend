import { useEffect, useState } from 'react';
import type { BackendStatus } from '@/types/backendApi';

interface SourceHealthBannerProps {
    status: BackendStatus | null;
    error: string | null;
    isLoading: boolean;
    lastReceivedAt: number | null;
    onRefresh: () => void;
}

export function SourceHealthBanner({
    status,
    error,
    isLoading,
    lastReceivedAt,
    onRefresh,
}: SourceHealthBannerProps) {
    const [clock, setClock] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => setClock(Date.now()), 5_000);
        return () => window.clearInterval(timer);
    }, []);

    if (!status) {
        return (
            <section className="mb-6 border-5 border-orchid bg-aubergine p-5 shadow-brutal-orchid" aria-live="polite">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-xl font-black text-orchid">
                            {isLoading ? 'Connecting To Pingme' : 'Pingme Backend Offline'}
                        </h2>
                        <p className="mt-1 text-sm font-bold text-whisper-white">
                            {error ?? 'Fetching durable L1 and Aztec-node observations…'}
                        </p>
                        <p className="mt-2 text-xs font-bold text-whisper-white/70">
                            Pingme needs the backend to collect events and send alerts while this page is closed.
                        </p>
                    </div>
                    {!isLoading && (
                        <button
                            type="button"
                            onClick={onRefresh}
                            className="brutal-button brutal-button--orchid brutal-button--lg shrink-0"
                        >
                            Retry
                        </button>
                    )}
                </div>
            </section>
        );
    }

    const snapshotAgeMs = clock === 0 ? 0 : Math.max(0, clock - Date.parse(status.generatedAt));
    const responseTooOld = clock > 0 && (snapshotAgeMs > 45_000 || (
        lastReceivedAt !== null && clock - lastReceivedAt > 45_000
    ));
    const backendUnreachable = Boolean(error) || responseTooOld;
    const degraded = backendUnreachable || status.status !== 'healthy' ||
        status.sources.l1.status !== 'healthy' ||
        status.sources.aztec.status !== 'healthy' ||
        status.delivery.status !== 'healthy';
    const palette = degraded
        ? 'border-vermillion bg-oxblood shadow-brutal-vermillion'
        : 'border-aqua bg-lapis shadow-brutal-aqua';
    const accent = degraded ? 'text-vermillion' : 'text-aqua';
    const heading = backendUnreachable
        ? 'Pingme Backend Unreachable'
        : degraded
            ? 'Pingme Coverage Degraded'
            : 'Pingme Online';

    return (
        <section className={`mb-6 border-5 p-5 ${palette}`} aria-live="polite">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className={`text-xl font-black ${accent}`}>
                        {heading}
                    </h2>
                    <p className="mt-1 text-sm font-bold text-whisper-white">
                        Backend alerts continue while the browser is closed. The Monitor page reads L1 independently.
                    </p>
                    {error && <p className="mt-2 text-xs font-bold text-vermillion">Latest refresh: {error}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <SourceBadge label="L1" status={status.sources.l1.status} />
                    <SourceBadge label="Aztec Node" status={status.sources.aztec.status} />
                    <SourceBadge label="Delivery" status={status.delivery.status} />
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="brutal-button brutal-button--sm"
                    >
                        Refresh
                    </button>
                </div>
            </div>
            <p className="mt-3 text-xs font-bold text-whisper-white/60">
                Snapshot {formatRelativeTime(status.generatedAt)}
                {lastReceivedAt ? ` · received ${new Date(lastReceivedAt).toLocaleTimeString()}` : ''}
            </p>
        </section>
    );
}

function SourceBadge({ label, status }: { label: string; status: string }) {
    const healthy = status === 'healthy';
    return (
        <span className={`border-3 border-brand-black px-3 py-2 text-xs font-black uppercase text-brand-black ${healthy ? 'bg-aqua' : 'bg-vermillion'}`}>
            {label}: {status}
        </span>
    );
}

function formatRelativeTime(value: string): string {
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    return `${Math.round(seconds / 60)}m ago`;
}
