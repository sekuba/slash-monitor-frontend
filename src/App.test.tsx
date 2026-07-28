import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('top-level monitor views', () => {
    beforeEach(() => installBrowser('https://slashmon.example/'));

    afterEach(() => vi.unstubAllGlobals());

    it('uses the hosted live monitor as the clean default', () => {
        const markup = renderToStaticMarkup(<App />);

        expect(markup).toContain('Live Aztec slashing state');
        expect(markup).toContain('Connecting to the hosted monitor');
        expect(markup).toContain('Live monitor &amp; alerts');
        expect(markup).toContain('Independent L1 check');
        expect(markup).toContain('href="#main-content"');
        expect(markup).not.toContain('protected');
    });

    it('keeps unrelated query parameters on the default live view', () => {
        installBrowser('https://slashmon.example/?utm_source=test');

        const markup = renderToStaticMarkup(<App />);

        expect(markup).toContain('Live Aztec slashing state');
        expect(markup).not.toContain('Independent Ethereum check');
    });

    it('isolates the browser-only fallback behind the independent route', () => {
        installBrowser('https://slashmon.example/?view=independent&network=testnet');

        const markup = renderToStaticMarkup(<App />);

        expect(markup).toContain('Independent Ethereum check');
        expect(markup).toContain('Sepolia testnet');
        expect(markup).toContain('Offchain offense reasons and alerts are unavailable here');
        expect(markup).toContain('Contract details &amp; RPC');
        expect(markup).not.toContain('Connecting to the hosted monitor');
    });

    it('uses only the selected independent network RPC override', () => {
        installBrowser('https://slashmon.example/?view=independent&network=testnet', {
            'slashmon:monitor-rpc:1': 'https://rpc.example/mainnet',
            'slashmon:monitor-rpc:11155111': 'https://rpc.example/sepolia',
        });

        const markup = renderToStaticMarkup(<App />);

        expect(markup).toContain('https://rpc.example/sepolia');
        expect(markup).not.toContain('https://rpc.example/mainnet');
        expect(markup).toContain('Custom');
    });
});

function installBrowser(href: string, initialStorage: Record<string, string> = {}): void {
    const url = new URL(href);
    const storage = new Map(Object.entries(initialStorage));
    const localStorage = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    };
    const windowValue = {
        location: url,
        history: { pushState: vi.fn() },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        scrollTo: vi.fn(),
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
    };
    vi.stubGlobal('window', windowValue);
    vi.stubGlobal('location', url);
    vi.stubGlobal('localStorage', localStorage);
}
