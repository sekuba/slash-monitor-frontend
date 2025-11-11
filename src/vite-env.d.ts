/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_L1_RPC_URL: string
  readonly VITE_L1_RPC_URL_SECONDARY?: string
  readonly VITE_NODE_ADMIN_URL?: string // Only used in local development
  readonly VITE_L1_CHAIN_ID: string
  readonly VITE_SLASHER_ADDRESS: string
  readonly VITE_SLASHING_ROUND_SIZE?: string
  readonly VITE_SLASHING_ROUND_SIZE_IN_EPOCHS?: string
  readonly VITE_EXECUTION_DELAY_IN_ROUNDS?: string
  readonly VITE_SLASH_OFFSET_IN_ROUNDS?: string
  readonly VITE_QUORUM?: string
  readonly VITE_SLOT_DURATION?: string
  readonly VITE_VETOER_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
