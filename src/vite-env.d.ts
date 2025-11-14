/// <reference types="vite/client" />
interface ImportMetaEnv {
    // Mainnet Configuration
    readonly VITE_L1_RPC_URL: string;
    readonly VITE_TALLY_PROPOSER_ADDRESS: string;
    readonly VITE_SLASHER_ADDRESS: string;
    readonly VITE_ROLLUP_ADDRESS: string;
    readonly VITE_NODE_ADMIN_URL?: string;

    // Testnet Configuration
    readonly VITE_TESTNET_L1_RPC_URL?: string;
    readonly VITE_TESTNET_TALLY_PROPOSER_ADDRESS?: string;
    readonly VITE_TESTNET_SLASHER_ADDRESS?: string;
    readonly VITE_TESTNET_ROLLUP_ADDRESS?: string;
    readonly VITE_TESTNET_NODE_ADMIN_URL?: string;
}
interface ImportMeta {
    readonly env: ImportMetaEnv;
}
