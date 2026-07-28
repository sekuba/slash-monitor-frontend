import { useState, type FormEvent } from 'react';
import { getAddress, isAddress, type Address } from 'viem';

interface ValidatorSearchProps {
    value: Address | null;
    onChange: (address: Address | null) => void;
    label?: string;
    description?: string;
}

export function ValidatorSearch({
    value,
    onChange,
    label = 'Find a validator',
    description = 'Open the facts this monitor has for one Aztec validator address.',
}: ValidatorSearchProps) {
    const [draft, setDraft] = useState(() => ({
        source: value,
        text: value ?? '',
    }));
    const [error, setError] = useState<string | null>(null);
    const text = draft.source === value ? draft.text : value ?? '';

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const input = text.trim();
        if (!isAddress(input, { strict: false })) {
            setError('Enter a 20-byte Ethereum address.');
            return;
        }
        setError(null);
        onChange(getAddress(input));
    };

    return (
        <section className="border-5 border-orchid bg-aubergine p-5 shadow-brutal-orchid">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="text-2xl font-black text-whisper-white">{label}</h2>
                    <p className="mt-2 text-sm font-bold text-whisper-white/70">{description}</p>
                </div>
                {value && (
                    <button
                        type="button"
                        onClick={() => onChange(null)}
                        className="brutal-button brutal-button--neutral brutal-button--sm self-start"
                    >
                        Clear
                    </button>
                )}
            </div>
            <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
                <label htmlFor="validator-search" className="sr-only">Validator address</label>
                <input
                    id="validator-search"
                    value={text}
                    onChange={(event) => {
                        setDraft({ source: value, text: event.target.value });
                        setError(null);
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="0x… validator address"
                    className="min-h-12 min-w-0 flex-1 border-3 border-orchid bg-brand-black px-4 font-mono text-sm font-bold text-whisper-white placeholder:text-whisper-white/35"
                />
                <button type="submit" className="brutal-button brutal-button--orchid brutal-button--lg">
                    Show validator
                </button>
            </form>
            {error && <p className="mt-3 text-sm font-bold text-vermillion" role="alert">{error}</p>}
        </section>
    );
}
