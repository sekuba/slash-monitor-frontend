import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '@/types/api';
import { WatchlistPanel } from './WatchlistPanel';

const useWatchlistMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useWatchlist', () => ({
    useWatchlist: useWatchlistMock,
}));

const CONFIG: PublicConfig = {
    network: 'mainnet',
    maxWatchlistAddresses: 100,
    channels: {
        webPush: { available: true, publicKey: 'public-key' },
        telegram: { available: true, botUsername: 'slashmon_bot' },
    },
};

describe('WatchlistPanel channel health', () => {
    afterEach(() => vi.clearAllMocks());

    it('does not call a verified endpoint live while its backend channel is degraded', () => {
        useWatchlistMock.mockReturnValue(watchlistManager());

        const markup = renderToStaticMarkup(
            <WatchlistPanel
                config={CONFIG}
                notificationHealth={{
                    webPush: { status: 'degraded' },
                    telegram: { status: 'healthy' },
                }}
            />,
        );

        expect(markup).toContain('Delivery degraded');
        expect(markup).toContain('Backend degraded');
        expect(markup).toContain('connected alerts may be delayed');
        expect(markup).not.toContain('Alerts live');
        expect(markup).toContain('Disconnect');
    });
});

function watchlistManager() {
    return {
        watchlist: {
            id: '11111111-1111-4111-8111-111111111111',
            addresses: ['0x1111111111111111111111111111111111111111'],
            channels: {
                webPush: { connected: true, enabled: true, verified: true },
                telegram: { connected: false, enabled: false, verified: false },
            },
        },
        pushCapability: 'enabled',
        telegramLink: null,
        isBusy: false,
        isLoading: false,
        error: null,
        notice: null,
        capabilityOriginSafe: true,
        saveAddresses: vi.fn(),
        enableWebPush: vi.fn(),
        disableWebPush: vi.fn(),
        retryWebPushVerification: vi.fn(),
        createTelegramLink: vi.fn(),
        disconnectTelegram: vi.fn(),
        refreshWatchlist: vi.fn(),
        sendTest: vi.fn(),
        deleteWatch: vi.fn(),
    };
}
