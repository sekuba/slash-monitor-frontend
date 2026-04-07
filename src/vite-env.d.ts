/// <reference types="vite/client" />
interface ImportMetaEnv {
    // Mainnet Configuration
    readonly VITE_L1_RPC_URL: string;
    readonly VITE_TALLY_PROPOSER_ADDRESS: string;
    readonly VITE_SLASHER_ADDRESS: string;
    readonly VITE_ROLLUP_ADDRESS: string;

    // Testnet Configuration
    readonly VITE_TESTNET_L1_RPC_URL?: string;
    readonly VITE_TESTNET_TALLY_PROPOSER_ADDRESS?: string;
    readonly VITE_TESTNET_SLASHER_ADDRESS?: string;
    readonly VITE_TESTNET_ROLLUP_ADDRESS?: string;

    // Performance & Behavior Configuration
    readonly VITE_L2_POLL_INTERVAL?: string;
    readonly VITE_REALTIME_COUNTDOWN_INTERVAL?: string;
    readonly VITE_L1_ROUND_CACHE_TTL?: string;
    readonly VITE_DETAILS_CACHE_TTL?: string;
    readonly VITE_COPY_FEEDBACK_DURATION?: string;
    readonly VITE_HOURS_THRESHOLD_FOR_DAY_DISPLAY?: string;
    readonly VITE_CONSOLE_LOG_PROBABILITY?: string;

    // Historical Data Configuration
    readonly VITE_LOOKBACK_ROUNDS?: string;
    readonly VITE_TESTNET_LOOKBACK_ROUNDS?: string;
}
interface ImportMeta {
    readonly env: ImportMetaEnv;
}
