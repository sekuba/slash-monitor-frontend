import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { BackendOverview } from './components/BackendOverview';
import { Dashboard } from './components/Dashboard';
import { Header } from './components/Header';
import { useSlashingMonitor } from './hooks/useSlashingMonitor';
import { parseAppSearch, urlForNetwork, urlForView, type AppView } from './lib/navigation';
import { normalizeRpcUrls } from './lib/rpc';
import { clearCustomRpcUrl, getCustomRpcUrl, setCustomRpcUrl } from './lib/rpcOverride';
import { useSlashingStore } from './store/slashingStore';
import type { MonitorConfigInput } from './types/slashing';

const MAINNET_REGISTRY_ADDRESS = '0x35b22e09Ee0390539439E24f06Da43D83f90e298' as Address;
const TESTNET_REGISTRY_ADDRESS = '0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba' as Address;

const createConfig = (isTestnet: boolean): MonitorConfigInput => {
    const chainId = isTestnet ? 11155111 : 1;
    const customRpcUrl = getCustomRpcUrl(chainId);
    const defaultL1RpcUrl = isTestnet
        ? (import.meta.env.VITE_TESTNET_L1_RPC_URL || import.meta.env.VITE_L1_RPC_URL || '')
        : (import.meta.env.VITE_L1_RPC_URL || '');

    return {
        l1RpcUrl: normalizeRpcUrls(customRpcUrl || defaultL1RpcUrl),
        chainId,
        registryAddress: (
            isTestnet
                ? (import.meta.env.VITE_TESTNET_REGISTRY_ADDRESS || TESTNET_REGISTRY_ADDRESS)
                : (import.meta.env.VITE_REGISTRY_ADDRESS || MAINNET_REGISTRY_ADDRESS)
        ) as Address,
        pollInterval: Number(import.meta.env.VITE_POLL_INTERVAL) || 180000,
        realtimeCountdownInterval: Number(import.meta.env.VITE_REALTIME_COUNTDOWN_INTERVAL) || 1000,
        hoursThresholdForDayDisplay: Number(import.meta.env.VITE_HOURS_THRESHOLD_FOR_DAY_DISPLAY) || 24,
        consoleLogProbability: Number(import.meta.env.VITE_CONSOLE_LOG_PROBABILITY) || 0.2,
    };
};

export function App() {
    const [location, setLocation] = useState(() => parseAppSearch(window.location.search));
    const [scannerGeneration, setScannerGeneration] = useState(0);
    const resetMonitor = useSlashingStore((state) => state.resetMonitor);
    const isTestnet = location.network === 'testnet';
    const config = useMemo(
        () => createConfig(isTestnet),
        // The generation is intentionally a dependency: RPC overrides live in
        // localStorage and changing one must create a fresh config object.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [isTestnet, scannerGeneration],
    );

    const restartScanner = useCallback(() => {
        resetMonitor();
        setScannerGeneration((generation) => generation + 1);
    }, [resetMonitor]);

    const navigateTo = useCallback((view: AppView) => {
        const next = urlForView(window.location.href, view);
        window.history.pushState({}, '', next);
        if (location.view === 'watch' && view !== 'watch') {
            restartScanner();
        }
        setLocation(parseAppSearch(next.search));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [location.view, restartScanner]);

    const toggleNetwork = useCallback(() => {
        const network = isTestnet ? 'mainnet' : 'testnet';
        const next = urlForNetwork(window.location.href, network);
        window.history.pushState({}, '', next);
        restartScanner();
        setLocation(parseAppSearch(next.search));
    }, [isTestnet, restartScanner]);

    const updateRpc = useCallback((url: string) => {
        setCustomRpcUrl(config.chainId, url);
        restartScanner();
    }, [config.chainId, restartScanner]);

    const resetRpc = useCallback(() => {
        clearCustomRpcUrl(config.chainId);
        restartScanner();
    }, [config.chainId, restartScanner]);

    useEffect(() => {
        const handlePopState = () => {
            const next = parseAppSearch(window.location.search);
            if (next.network !== location.network || (location.view === 'watch' && next.view !== 'watch')) {
                restartScanner();
            }
            setLocation(next);
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [location.network, location.view, restartScanner]);

    return (
        <div className="min-h-screen bg-brand-black text-white">
            <Header
                activeView={location.view}
                onNavigate={navigateTo}
            />
            {location.view === 'watch' ? (
                <main className="mx-auto max-w-7xl px-4 py-8">
                    <BackendOverview
                        key={`${location.network}:${location.selectedEventId ?? ''}`}
                        network={location.network}
                        view="watch"
                    />
                </main>
            ) : (
                <>
                    <ScannerRuntime key={`${location.network}:${scannerGeneration}`} config={config} />
                    <Dashboard
                        configInput={config}
                        network={location.network}
                        page={location.view}
                        onResetRpc={resetRpc}
                        onToggleNetwork={toggleNetwork}
                        onUpdateRpc={updateRpc}
                    />
                </>
            )}
        </div>
    );
}

function ScannerRuntime({ config }: { config: MonitorConfigInput }) {
    useSlashingMonitor(config);
    return null;
}
