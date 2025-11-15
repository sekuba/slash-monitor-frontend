import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { clearSlashingCaches } from '@/lib/cacheManager';

export type NetworkType = 'mainnet' | 'testnet';

interface NetworkContextType {
  network: NetworkType;
  toggleNetwork: () => void;
  clearAllCaches: () => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  // Determine initial network based on query parameter
  const params = new URLSearchParams(window.location.search);
  const initialNetwork: NetworkType = params.get('network') === 'testnet' ? 'testnet' : 'mainnet';
  const [network, setNetwork] = useState<NetworkType>(initialNetwork);

  const toggleNetwork = useCallback(() => {
    const newNetwork = network === 'mainnet' ? 'testnet' : 'mainnet';
    setNetwork(newNetwork);

    // Clear all caches before switching
    clearSlashingCaches();

    // Navigate to the appropriate URL with query parameter
    const newUrl = newNetwork === 'testnet' ? '/?network=testnet' : '/';

    // Reload the page to ensure clean state
    window.location.href = newUrl;
  }, [network]);

  return (
    <NetworkContext.Provider value={{ network, toggleNetwork, clearAllCaches: clearSlashingCaches }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
