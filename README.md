# Aztec Slashing Monitor

A minimalist frontend for monitoring and managing slashing proposals in the Aztec Protocol. This tool watches L1 and the Aztec sequencer node's JSON RPC to detect slashing before it's executed on L1, allowing the veto council to intervene when necessary.

## Features

- **Real-time Monitoring**: Watches L1 events (VoteCast, RoundExecuted) and polls the Aztec node for offenses
- **Early Detection**: Detects slashing rounds as they enter the veto window
- **Payload Precomputation**: Calculates deterministic CREATE2 addresses for slash payloads before execution
- **Veto Interface**: Allows the VETOER to veto harmful slashings with a simple UI
- **Dashboard**: Clear visualization of active slashings, statistics, and timing information

## Architecture

### Key Components

1. **L1 Monitor** (`src/lib/l1Monitor.ts`)
   - Connects to Ethereum L1 via RPC
   - Listens to TallySlashingProposer events
   - Reads contract state (rounds, committees, tallies)
   - Precomputes payload addresses using `getPayloadAddress()`

2. **Node RPC Client** (`src/lib/nodeRpcClient.ts`)
   - Connects to Aztec node JSON RPC (port 8080/8880)
   - Polls for pending offenses via `nodeAdmin_getSlashOffenses`
   - Provides early warnings before quorum is reached

3. **Slashing Detector** (`src/lib/slashingDetector.ts`)
   - Combines L1 and L2 data
   - Calculates round status and timing
   - Detects executable rounds in the veto window
   - Computes deadlines for veto actions

4. **Dashboard UI** (`src/components/Dashboard.tsx`)
   - Displays active slashings
   - Shows validators being slashed and amounts
   - Real-time countdown for veto windows
   - Statistics panel

5. **Veto Interface** (`src/components/VetoButton.tsx`)
   - Wallet connection (WalletConnect, MetaMask, etc.)
   - VETOER role verification
   - Transaction simulation before execution
   - Calls `Slasher.vetoPayload(address)` on L1

## Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# VITE_L1_RPC_URL, contract addresses, etc.
```

## Configuration

Edit `.env` file:

```env
# L1 Configuration
VITE_L1_RPC_URL=http://localhost:8545

# Contract Addresses (get from deployment)
VITE_TALLY_PROPOSER_ADDRESS=0x...
VITE_SLASHER_ADDRESS=0x...
VITE_ROLLUP_ADDRESS=0x...

# L2 Configuration
VITE_NODE_RPC_URL=http://localhost:8080
VITE_NODE_ADMIN_URL=http://localhost:8880

# Optional: VETOER address for UI permissions
VITE_VETOER_ADDRESS=0x...
```

## Usage

### Development

```bash
npm run dev
```

Open http://localhost:5173

### Production Build

```bash
npm run build
npm run preview
```

### Deployment

The app is a static site and can be deployed to:
- Vercel
- Netlify
- GitHub Pages
- Any static hosting service

```bash
npm run build
# Deploy the 'dist' folder
```

## How It Works

### Slashing Flow in Aztec

1. **Voting Phase** (Round N)
   - Block proposers vote on which validators to slash
   - Votes are encoded as bytes (2 bits per validator)
   - Each slot can have one vote from the designated proposer

2. **Execution Delay** (Veto Window)
   - After a round ends, there's a delay (typically 1 round)
   - During this window, the payload address can be precomputed
   - **This is when the veto council must act**

3. **Execution**
   - Once delay passes, anyone can call `executeRound()`
   - Slashes validators that reached quorum
   - Deploys a SlashPayload contract at the precomputed address

4. **Veto**
   - VETOER can call `Slasher.vetoPayload(address)` anytime before execution
   - Prevents the specific payload from being executed
   - Does not affect future rounds

### Payload Address Precomputation

This is the **critical feature** for early detection:

```typescript
// Step 1: Get committees for the round
const committees = await tallyProposer.getSlashTargetCommittees(round)

// Step 2: Get tally (which validators reached quorum)
const { actions } = await tallyProposer.getTally(round, committees)

// Step 3: Precompute payload address using CREATE2
const payloadAddress = await tallyProposer.getPayloadAddress(round, actions)

// Step 4: Veto if needed
await slasher.vetoPayload(payloadAddress)
```

The `getPayloadAddress()` function (TallySlashingProposer.sol:548) returns the deterministic address where the payload **will be** deployed when `executeRound()` is called. This allows vetoing **before** execution.

### Detection Timeline

```
Round N ends
    ↓
Execution Delay (Veto Window)
    ↓ [Monitor detects here]
    ↓ - Polls getCurrentRound()
    ↓ - Checks round N - executionDelay
    ↓ - Calls getTally() to see slashing
    ↓ - Precomputes payload address
    ↓ - Alerts veto council
    ↓ - Council reviews & decides
    ↓ - Council calls vetoPayload() if needed
    ↓
Round becomes executable
    ↓
Anyone calls executeRound()
    ↓ [If vetoed, execution fails]
    ↓ [If not vetoed, slashing happens]
```

## API Reference

### L1 Contracts

#### TallySlashingProposer

```solidity
// Get current round number
function getCurrentRound() external view returns (uint256)

// Get round information
function getRound(uint256 _round) external view returns (bool isExecuted, uint256 voteCount)

// Check if round is ready to execute
function isRoundReadyToExecute(uint256 _round, uint256 _slot) external view returns (bool)

// Get committees for epochs being slashed
function getSlashTargetCommittees(uint256 _round) external returns (address[][] memory)

// Get tally (slash actions that reached quorum)
function getTally(uint256 _round, address[][] calldata _committees) external view returns (SlashAction[] memory)

// Precompute payload address (CREATE2)
function getPayloadAddress(uint256 _round, SlashAction[] memory _actions) external view returns (address)
```

#### Slasher

```solidity
// Check if payload is vetoed
function vetoedPayloads(address payload) external view returns (bool)

// Veto a payload (VETOER only)
function vetoPayload(address _payload) external returns (bool)

// Check if slashing is enabled
function isSlashingEnabled() external view returns (bool)
```

### Node RPC

```bash
# Get slash offenses
curl -X POST http://localhost:8880 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"nodeAdmin_getSlashOffenses","params":["current"],"id":1}'

# Get L2 tips (for slot/epoch info)
curl -X POST http://localhost:8080 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"node_getL2Tips","params":[],"id":1}'
```

## Security Considerations

1. **Vetoer Authentication**
   - Only the VETOER address from `Slasher.VETOER()` can veto
   - Wallet connection verified against contract
   - Transaction simulated before execution

2. **Payload Verification**
   - Always recompute payload address on-chain
   - Never trust client-computed addresses
   - Verify against L1 contract state

3. **Transaction Safety**
   - Gas estimates shown before veto
   - Confirmation dialog with details
   - Simulation to detect errors early

## Troubleshooting

### "Failed to initialize"

- Check L1 RPC URL is correct and accessible
- Verify contract addresses are deployed and correct
- Ensure network is running (anvil, mainnet, etc.)

### "Node RPC not responding"

- Check Aztec node is running on port 8080/8880
- Verify `--port` and `--admin-port` flags on node
- Check CORS settings if running from different origin

### "Veto simulation failed"

- Ensure connected wallet is the VETOER
- Check payload is not already vetoed
- Verify payload exists and is not yet executed

## Development

### Project Structure

```
slash-monitor-frontend/
├── src/
│   ├── components/         # UI components
│   │   ├── Dashboard.tsx
│   │   ├── RoundCard.tsx
│   │   ├── StatsPanel.tsx
│   │   ├── Header.tsx
│   │   └── VetoButton.tsx
│   ├── lib/
│   │   ├── contracts/      # Contract ABIs
│   │   ├── l1Monitor.ts    # L1 interaction
│   │   ├── nodeRpcClient.ts
│   │   ├── slashingDetector.ts
│   │   └── utils.ts
│   ├── hooks/
│   │   └── useSlashingMonitor.ts
│   ├── store/
│   │   └── slashingStore.ts  # Zustand state
│   ├── types/
│   │   └── slashing.ts
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

### Key Technologies

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Viem** - Ethereum library (lightweight, tree-shakeable)
- **Wagmi** - React hooks for Ethereum
- **TanStack Query** - Data fetching and caching
- **Zustand** - State management
- **Tailwind CSS** - Styling
- **Vite** - Build tool

### Adding New Features

1. **Add a new contract function**:
   - Update ABI in `src/lib/contracts/`
   - Add method to `L1Monitor`
   - Use in detector or components

2. **Add a new RPC method**:
   - Add to `NodeRpcClient`
   - Update types in `slashing.ts`
   - Use in polling or hooks

3. **Add a new UI component**:
   - Create in `src/components/`
   - Import types from `@/types/slashing`
   - Use store via `useSlashingStore()`

## References

- **TallySlashingProposer.sol**: l1-contracts/src/core/slashing/TallySlashingProposer.sol:548 (getPayloadAddress)
- **Slasher.sol**: l1-contracts/src/core/slashing/Slasher.sol:40 (vetoPayload)
- **Node API**: docs/docs/the_aztec_network/reference/node_api_reference.md:957 (getSlashOffenses)
- **Tally Slasher Client**: yarn-project/slasher/src/tally_slasher_client.ts:234 (example usage)

## License

Apache-2.0 (same as Aztec Protocol)

## Support

For issues or questions:
- [Aztec Discord](https://discord.gg/aztec)
- [Aztec Forum](https://forum.aztec.network)
- [GitHub Issues](https://github.com/AztecProtocol/aztec-packages/issues)
