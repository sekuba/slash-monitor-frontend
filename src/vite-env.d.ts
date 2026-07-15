/// <reference types="vite/client" />
interface ImportMetaEnv {
    // Mainnet Configuration
    readonly VITE_L1_RPC_URL: string;
    readonly VITE_REGISTRY_ADDRESS?: string;

    // Testnet Configuration
    readonly VITE_TESTNET_L1_RPC_URL?: string;
    readonly VITE_TESTNET_REGISTRY_ADDRESS?: string;

    // Performance & Behavior Configuration
    readonly VITE_POLL_INTERVAL?: string;
    readonly VITE_REALTIME_COUNTDOWN_INTERVAL?: string;
    readonly VITE_HOURS_THRESHOLD_FOR_DAY_DISPLAY?: string;
    readonly VITE_CONSOLE_LOG_PROBABILITY?: string;

}
interface ImportMeta {
    readonly env: ImportMetaEnv;
}
