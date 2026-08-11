import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { BackendOverview } from './components/BackendOverview';
import { Dashboard } from './components/Dashboard';
import { Header } from './components/Header';
import { ProtocolGuide } from './components/ProtocolGuide';
import { useSlashingMonitor } from './hooks/useSlashingMonitor';
import {
    parseAppSearch,
    urlForNetwork,
    urlForView,
    urlForWatchlist,
    type AppView,
} from './lib/navigation';
import { clearRpcOverride, getRpcOverride, setRpcOverride } from './lib/rpcOverride';
import { useSlashingStore } from './store/slashingStore';
import type { MonitorConfigInput } from './types/slashing';
import type { ProtocolSnapshot } from '@shared/protocol/index.ts';

const MAINNET_REGISTRY_ADDRESS = '0x35b22e09Ee0390539439E24f06Da43D83f90e298' as Address;
const TESTNET_REGISTRY_ADDRESS = '0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba' as Address;
const MONITOR_SESSION_CACHE_MS = 10 * 60 * 1_000;

const createConfig = (isTestnet: boolean, rpcOverride: string | null): MonitorConfigInput => {
    const chainId = isTestnet ? 11155111 : 1;
    const defaultL1RpcUrl = isTestnet
        ? (import.meta.env.VITE_TESTNET_L1_RPC_URL || import.meta.env.VITE_L1_RPC_URL || '')
        : (import.meta.env.VITE_L1_RPC_URL || '');

    return {
        l1RpcUrl: (rpcOverride || defaultL1RpcUrl).trim(),
        chainId,
        registryAddress: (
            isTestnet
                ? (import.meta.env.VITE_TESTNET_REGISTRY_ADDRESS || TESTNET_REGISTRY_ADDRESS)
                : (import.meta.env.VITE_REGISTRY_ADDRESS || MAINNET_REGISTRY_ADDRESS)
        ) as Address,
    };
};

export function App() {
    const [location, setLocation] = useState(() => parseAppSearch(window.location.search));
    const [rpcOverrides, setRpcOverrides] = useState(() => ({
        mainnet: getRpcOverride(1),
        testnet: getRpcOverride(11_155_111),
    }));
    const [scannerGeneration, setScannerGeneration] = useState(0);
    const [isScannerMounted, setIsScannerMounted] = useState(
        () => location.view === 'monitor',
    );
    const [protocolGuide, setProtocolGuide] = useState<{
        isOpen: boolean;
        protocol: ProtocolSnapshot | null;
    }>({ isOpen: false, protocol: null });
    const [currentProtocol, setCurrentProtocol] = useState<ProtocolSnapshot | null>(null);
    const resetMonitor = useSlashingStore((state) => state.resetMonitor);
    const isTestnet = location.network === 'testnet';
    const rpcOverride = isTestnet ? rpcOverrides.testnet : rpcOverrides.mainnet;
    const config = useMemo(
        () => createConfig(isTestnet, rpcOverride),
        [isTestnet, rpcOverride],
    );

    const restartScanner = useCallback(() => {
        resetMonitor();
        setCurrentProtocol(null);
        setScannerGeneration((generation) => generation + 1);
    }, [resetMonitor]);

    const navigateTo = useCallback((view: AppView) => {
        const next = urlForView(window.location.href, view);
        window.history.pushState({}, '', next);
        if (location.view !== view) setCurrentProtocol(null);
        if (view === 'monitor') setIsScannerMounted(true);
        setLocation(parseAppSearch(next.search));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [location.view]);

    const toggleNetwork = useCallback(() => {
        const network = isTestnet ? 'mainnet' : 'testnet';
        const next = urlForNetwork(window.location.href, network);
        window.history.pushState({}, '', next);
        restartScanner();
        setLocation(parseAppSearch(next.search));
    }, [isTestnet, restartScanner]);

    const updateWatchlist = useCallback((addresses: readonly string[]) => {
        const next = urlForWatchlist(
            window.location.href,
            location.view,
            location.network,
            addresses,
        );
        window.history.pushState({}, '', next);
        setLocation(parseAppSearch(next.search));
    }, [location.network, location.view]);

    const openProtocolGuide = useCallback((protocol: ProtocolSnapshot | null = null) => {
        setProtocolGuide({ isOpen: true, protocol });
    }, []);
    const closeProtocolGuide = useCallback(() => {
        setProtocolGuide((current) => ({ ...current, isOpen: false }));
    }, []);
    const openCurrentProtocolGuide = useCallback(() => {
        openProtocolGuide(currentProtocol);
    }, [currentProtocol, openProtocolGuide]);
    const updateCurrentProtocol = useCallback((next: ProtocolSnapshot | null) => {
        setCurrentProtocol((current) => {
            if (current === next) return current;
            if (
                current &&
                next &&
                current.network === next.network &&
                current.blockHash === next.blockHash
            ) {
                return current;
            }
            return next;
        });
    }, []);

    const updateRpc = useCallback((url: string) => {
        const savedUrl = setRpcOverride(config.chainId, url);
        setRpcOverrides((current) => ({ ...current, [location.network]: savedUrl }));
        restartScanner();
    }, [config.chainId, location.network, restartScanner]);

    const resetRpc = useCallback(() => {
        clearRpcOverride(config.chainId);
        setRpcOverrides((current) => ({ ...current, [location.network]: null }));
        restartScanner();
    }, [config.chainId, location.network, restartScanner]);

    useEffect(() => {
        const handlePopState = () => {
            const next = parseAppSearch(window.location.search);
            if (next.network !== location.network) {
                restartScanner();
            }
            if (next.view === 'monitor') setIsScannerMounted(true);
            setLocation(next);
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [location.network, restartScanner]);

    useEffect(() => {
        if (location.view === 'monitor' || !isScannerMounted) return;
        const timeout = window.setTimeout(() => {
            resetMonitor();
            setIsScannerMounted(false);
        }, MONITOR_SESSION_CACHE_MS);
        return () => window.clearTimeout(timeout);
    }, [isScannerMounted, location.view, resetMonitor]);

    return (
        <div className="min-h-screen bg-brand-black text-white">
            <ProtocolGuide
                isOpen={protocolGuide.isOpen}
                protocol={protocolGuide.protocol}
                onClose={closeProtocolGuide}
            />
            <Header
                activeView={location.view}
                onNavigate={navigateTo}
                onOpenProtocolGuide={openCurrentProtocolGuide}
            />
            {isScannerMounted && (
                <ScannerRuntime
                    key={`${location.network}:${scannerGeneration}`}
                    config={config}
                    active={location.view === 'monitor'}
                />
            )}
            {location.view === 'pingme' ? (
                <main className="mx-auto max-w-7xl px-4 py-8">
                    <BackendOverview
                        key={location.network}
                        network={location.network}
                        configInput={config}
                        selectedCaseId={location.selectedCaseId}
                        onOpenMonitor={() => navigateTo('monitor')}
                        linkedAddresses={location.watchlistAddresses}
                        onWatchlistChange={updateWatchlist}
                        onOpenProtocolGuide={openProtocolGuide}
                        onProtocolChange={updateCurrentProtocol}
                    />
                </main>
            ) : (
                <Dashboard
                    key={`${location.network}:${location.watchlistAddresses.join(',')}`}
                    configInput={config}
                    network={location.network}
                    linkedAddresses={location.watchlistAddresses}
                    selectedCaseId={location.selectedCaseId}
                    onResetRpc={resetRpc}
                    onToggleNetwork={toggleNetwork}
                    onUpdateRpc={updateRpc}
                    onWatchlistChange={updateWatchlist}
                    onOpenProtocolGuide={openProtocolGuide}
                    onProtocolChange={updateCurrentProtocol}
                />
            )}
        </div>
    );
}

function ScannerRuntime({
    config,
    active,
}: {
    config: MonitorConfigInput;
    active: boolean;
}) {
    useSlashingMonitor(config, active);
    return null;
}
