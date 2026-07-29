import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { BackendOverview } from './components/BackendOverview';
import { Dashboard } from './components/Dashboard';
import { Header } from './components/Header';
import { useSlashingMonitor } from './hooks/useSlashingMonitor';
import {
    parseAppSearch,
    urlForNetwork,
    urlForCase,
    urlForView,
    type AppView,
} from './lib/navigation';
import { clearRpcOverride, getRpcOverride, setRpcOverride } from './lib/rpcOverride';
import { useSlashingStore } from './store/slashingStore';
import type { MonitorConfigInput } from './types/slashing';

const MAINNET_REGISTRY_ADDRESS = '0x35b22e09Ee0390539439E24f06Da43D83f90e298' as Address;
const TESTNET_REGISTRY_ADDRESS = '0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba' as Address;

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
    const resetMonitor = useSlashingStore((state) => state.resetMonitor);
    const isTestnet = location.network === 'testnet';
    const rpcOverride = isTestnet ? rpcOverrides.testnet : rpcOverrides.mainnet;
    const config = useMemo(
        () => createConfig(isTestnet, rpcOverride),
        [isTestnet, rpcOverride],
    );

    const restartScanner = useCallback(() => {
        resetMonitor();
        setScannerGeneration((generation) => generation + 1);
    }, [resetMonitor]);

    const navigateTo = useCallback((view: AppView) => {
        const next = urlForView(window.location.href, view);
        window.history.pushState({}, '', next);
        if (location.view === 'pingme' && view !== 'pingme') {
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

    const selectCase = useCallback((caseId: string | null) => {
        const next = urlForCase(window.location.href, caseId);
        window.history.pushState({}, '', next);
        setLocation(parseAppSearch(next.search));
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
            if (next.network !== location.network || (location.view === 'pingme' && next.view === 'monitor')) {
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
            {location.view === 'pingme' ? (
                <main className="mx-auto max-w-7xl px-4 py-8">
                    <BackendOverview
                        key={location.network}
                        network={location.network}
                        selectedCaseId={location.selectedCaseId}
                        onSelectCase={selectCase}
                        onOpenMonitor={() => navigateTo('monitor')}
                    />
                </main>
            ) : (
                <>
                    <ScannerRuntime key={`${location.network}:${scannerGeneration}`} config={config} />
                    <Dashboard
                        key={location.network}
                        configInput={config}
                        network={location.network}
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
