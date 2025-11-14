/// <reference types="vite/client" />
interface ImportMetaEnv {
    // Mainnet Configuration
    readonly VITE_L1_RPC_URL: string;
    readonly VITE_L1_RPC_URL_SECONDARY?: string;
    readonly VITE_NODE_ADMIN_URL?: string;
    readonly VITE_L1_CHAIN_ID: string;
    readonly VITE_SLASHER_ADDRESS: string;
    readonly VITE_TALLY_PROPOSER_ADDRESS: string;
    readonly VITE_ROLLUP_ADDRESS: string;
    readonly VITE_SLASHING_ROUND_SIZE?: string;
    readonly VITE_SLASHING_ROUND_SIZE_IN_EPOCHS?: string;
    readonly VITE_EXECUTION_DELAY_IN_ROUNDS?: string;
    readonly VITE_SLASH_OFFSET_IN_ROUNDS?: string;
    readonly VITE_QUORUM?: string;
    readonly VITE_SLOT_DURATION?: string;

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
