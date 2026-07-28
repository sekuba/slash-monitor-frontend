import type { AppView } from '@/lib/navigation';

interface HeaderProps {
    activeView: AppView;
    onNavigate: (view: AppView) => void;
}

const views: ReadonlyArray<{ id: AppView; label: string }> = [
    { id: 'live', label: 'Live monitor & alerts' },
    { id: 'independent', label: 'Independent L1 check' },
];

export function Header({ activeView, onNavigate }: HeaderProps) {
    return (
        <header className="border-b-6 border-chartreuse bg-brand-black shadow-brutal-chartreuse">
            <div className="mx-auto max-w-7xl px-4 py-5 sm:py-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                        <div className="shrink-0 border-5 border-brand-black bg-vermillion p-2 shadow-brutal sm:p-3" aria-hidden="true">
                            <svg className="h-8 w-8 text-brand-black sm:h-10 sm:w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <div className="text-2xl font-black tracking-tight text-chartreuse sm:text-3xl">SLASHMON</div>
                            <p className="text-xs font-bold text-aqua sm:text-sm">
                                Aztec validator slashing, verified on Ethereum
                            </p>
                        </div>
                    </div>

                    <nav aria-label="Monitor views" className="flex flex-wrap items-center gap-3 lg:justify-end">
                        {views.map((view) => (
                            <button
                                key={view.id}
                                type="button"
                                onClick={() => onNavigate(view.id)}
                                className={`brutal-button ${activeView === view.id ? 'brutal-button--nav-selected' : ''}`}
                                aria-current={activeView === view.id ? 'page' : undefined}
                            >
                                {view.label}
                            </button>
                        ))}
                        <a
                            href="https://github.com/sekuba/slashmon"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="brutal-button brutal-button--icon"
                            aria-label="Slashmon source on GitHub"
                        >
                            <svg className="h-6 w-6 text-chartreuse sm:h-7 sm:w-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                            </svg>
                        </a>
                    </nav>
                </div>
            </div>
        </header>
    );
}
