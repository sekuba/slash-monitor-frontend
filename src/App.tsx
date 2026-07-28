import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { Header } from './components/Header';
import { IndependentMonitor } from './components/IndependentMonitor';
import { LiveMonitor } from './components/LiveMonitor';
import {
    parseAppSearch,
    urlForNetwork,
    urlForValidator,
    urlForView,
    type AppView,
} from './lib/navigation';
import { normalizeRpcUrls } from './lib/rpc';
import { clearRpcOverride, getRpcOverride, setRpcOverride } from './lib/rpcOverride';
import type { MonitorConfigInput } from './types/slashing';

const MAINNET_REGISTRY_ADDRESS = '0x35b22e09Ee0390539439E24f06Da43D83f90e298' as Address;
const TESTNET_REGISTRY_ADDRESS = '0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba' as Address;

const createConfig = (isTestnet: boolean, rpcOverride: string | null): MonitorConfigInput => {
    const chainId = isTestnet ? 11_155_111 : 1;
    const defaultL1RpcUrl = isTestnet
        ? (import.meta.env.VITE_TESTNET_L1_RPC_URL || '')
        : (import.meta.env.VITE_L1_RPC_URL || '');

    return {
        l1RpcUrl: normalizeRpcUrls(rpcOverride || defaultL1RpcUrl),
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
    const isTestnet = location.network === 'testnet';
    const rpcOverride = isTestnet ? rpcOverrides.testnet : rpcOverrides.mainnet;
    const config = useMemo(
        () => createConfig(isTestnet, rpcOverride),
        [isTestnet, rpcOverride],
    );

    const commitLocation = useCallback((next: URL) => {
        window.history.pushState({}, '', next);
        setLocation(parseAppSearch(next.search));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const navigateTo = useCallback((view: AppView) => {
        commitLocation(urlForView(window.location.href, view));
    }, [commitLocation]);

    const toggleNetwork = useCallback(() => {
        commitLocation(urlForNetwork(
            window.location.href,
            isTestnet ? 'mainnet' : 'testnet',
        ));
    }, [commitLocation, isTestnet]);

    const selectValidator = useCallback((validator: Address | null) => {
        commitLocation(urlForValidator(window.location.href, validator));
    }, [commitLocation]);

    const updateRpc = useCallback((url: string) => {
        const savedUrl = setRpcOverride(config.chainId, url);
        setRpcOverrides((current) => ({ ...current, [location.network]: savedUrl }));
    }, [config.chainId, location.network]);

    const resetRpc = useCallback(() => {
        clearRpcOverride(config.chainId);
        setRpcOverrides((current) => ({ ...current, [location.network]: null }));
    }, [config.chainId, location.network]);

    useEffect(() => {
        const handlePopState = () => setLocation(parseAppSearch(window.location.search));
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    return (
        <div className="min-h-screen bg-brand-black text-white">
            <a href="#main-content" className="skip-link">Skip to monitor</a>
            <Header activeView={location.view} onNavigate={navigateTo} />
            <main id="main-content" className="mx-auto max-w-7xl px-4 py-8">
                {location.view === 'live' ? (
                    <LiveMonitor
                        selectedValidator={location.selectedValidator}
                        onSelectValidator={selectValidator}
                        onOpenIndependent={() => navigateTo('independent')}
                    />
                ) : (
                    <IndependentMonitor
                        configInput={config}
                        network={location.network}
                        selectedValidator={location.selectedValidator}
                        onSelectValidator={selectValidator}
                        onOpenLive={() => navigateTo('live')}
                        onResetRpc={resetRpc}
                        onToggleNetwork={toggleNetwork}
                        onUpdateRpc={updateRpc}
                    />
                )}
            </main>
            <footer className="border-t-5 border-aqua bg-brand-black px-4 py-6 text-center text-xs font-bold text-whisper-white/65">
                Slashmon reports observed facts. Ethereum transactions and canonical Aztec contracts remain the source of truth.
            </footer>
        </div>
    );
}
