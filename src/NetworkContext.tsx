import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export type NetworkType = 'mainnet' | 'testnet';

interface NetworkContextType {
  network: NetworkType;
  toggleNetwork: () => void;
  clearAllCaches: () => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine initial network based on current path
  const initialNetwork: NetworkType = location.pathname.startsWith('/testnet') ? 'testnet' : 'mainnet';
  const [network, setNetwork] = useState<NetworkType>(initialNetwork);

  const clearAllCaches = useCallback(() => {
    // Clear all localStorage items related to caching
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('cache') || key.includes('slashing'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Force a page reload to clear all in-memory caches
    console.log('Clearing all caches and reloading...');
  }, []);

  const toggleNetwork = useCallback(() => {
    const newNetwork = network === 'mainnet' ? 'testnet' : 'mainnet';
    setNetwork(newNetwork);

    // Clear all caches before switching
    clearAllCaches();

    // Navigate to the appropriate route
    const newPath = newNetwork === 'testnet' ? '/testnet' : '/';
    navigate(newPath);

    // Reload the page to ensure clean state
    window.location.href = newPath;
  }, [network, navigate, clearAllCaches]);

  return (
    <NetworkContext.Provider value={{ network, toggleNetwork, clearAllCaches }}>
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
