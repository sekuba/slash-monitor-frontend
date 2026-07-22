/// <reference types="vite/client" />
interface ImportMetaEnv {
    readonly BASE_URL: string;

    // Optional. Empty means the same origin as the frontend.
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_BASE_PATH?: string;

    // Mainnet Configuration
    readonly VITE_L1_RPC_URL?: string;
    readonly VITE_REGISTRY_ADDRESS?: string;

    // Testnet Configuration
    readonly VITE_TESTNET_L1_RPC_URL?: string;
    readonly VITE_TESTNET_REGISTRY_ADDRESS?: string;

}
interface ImportMeta {
    readonly env: ImportMetaEnv;
}
