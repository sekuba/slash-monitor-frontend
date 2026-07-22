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
        expect(markup).toContain('Watch My Sequencers');
        expect(markup.indexOf('Connecting To Pingme')).toBeLessThan(markup.indexOf('Watch My Sequencers'));
        expect(markup).toContain('Monitor');
        expect(markup).toContain('>PINGME</button>');
        expect(markup).not.toContain('Debug');
        expect(markup).not.toContain('Client scanner network');
        expect(markup).toContain('brutal-button--nav-selected');
    });

    it('treats removed and unknown views as the Monitor', () => {
        installBrowser('https://slashmon.example/?view=unknown&network=testnet');

        const markup = renderToStaticMarkup(<App />);

        expect(scannerSpy).toHaveBeenCalledOnce();
        expect(markup).not.toContain('Debug');
        expect(markup).toContain('Client scanner network');
        expect(markup).toContain('INITIALIZING CLIENTSIDE L1 MONITOR');
    });

});

function installBrowser(href: string): void {
    const url = new URL(href);
    const storage = new Map<string, string>();
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
