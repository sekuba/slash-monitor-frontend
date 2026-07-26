import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const scannerSpy = vi.hoisted(() => vi.fn());

vi.mock('./hooks/useSlashingMonitor', () => ({
    useSlashingMonitor: scannerSpy,
}));

describe('top-level view isolation', () => {
    beforeEach(() => {
        scannerSpy.mockClear();
        installBrowser('https://slashmon.example/');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders PINGME and permanent navigation without initializing the client scanner', () => {
        installBrowser('https://slashmon.example/?view=pingme&network=mainnet');

        const markup = renderToStaticMarkup(<App />);

        expect(scannerSpy).not.toHaveBeenCalled();
        expect(markup).toContain('Connecting To Pingme');
        expect(markup).toContain('Watch sequencers');
        expect(markup).not.toContain('PWA Web Push');
        expect(markup).not.toContain('>Telegram</h3>');
        expect(markup).not.toContain('Address-First Alerts');
        expect(markup).not.toContain('Pick the mainnet sequencers');
        expect(markup).toContain('Monitor');
        expect(markup).toContain('>PINGME</button>');
        expect(markup).not.toContain('Debug');
        expect(markup).not.toContain('On-chain details &amp; RPC');
        expect(markup).not.toContain('Client scanner network');
        expect(markup).toContain('brutal-button--nav-selected');
    });

    it('treats removed and unknown views as the Monitor', () => {
        installBrowser('https://slashmon.example/?view=unknown&network=testnet');

        const markup = renderToStaticMarkup(<App />);

        expect(scannerSpy).toHaveBeenCalledOnce();
        expect(markup).not.toContain('Debug');
        expect(markup).toContain('On-chain details &amp; RPC');
        expect(markup).not.toContain('Client scanner network');
        expect(markup).toContain('Switch client scanner to Mainnet');
        expect(markup).toContain('INITIALIZING CLIENTSIDE L1 MONITOR');
    });

    it('uses the saved RPC override only for the selected Monitor network', () => {
        installBrowser('https://slashmon.example/', {
            'slashmon:monitor-rpc:1': 'https://rpc.example/mainnet',
            'slashmon:monitor-rpc:11155111': 'https://rpc.example/testnet',
        });

        renderToStaticMarkup(<App />);

        expect(scannerSpy).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 1,
            l1RpcUrl: 'https://rpc.example/mainnet',
        }));
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
