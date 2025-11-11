# Quick Start Guide

This guide will help you get the Aztec Slashing Monitor running locally.

## Prerequisites

- Node.js 18+
- npm or yarn
- Access to an Aztec node (locally or remote)
- Access to an Ethereum L1 RPC endpoint

## 5-Minute Setup

### 1. Install Dependencies

```bash
cd slash-monitor-frontend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Example for local devnet
VITE_L1_RPC_URL=http://localhost:8545
VITE_TALLY_PROPOSER_ADDRESS=0x1234567890123456789012345678901234567890
VITE_SLASHER_ADDRESS=0x1234567890123456789012345678901234567891
VITE_ROLLUP_ADDRESS=0x1234567890123456789012345678901234567892
VITE_NODE_RPC_URL=http://localhost:8080
VITE_NODE_ADMIN_URL=http://localhost:8880
```

**Where to find contract addresses:**

If you're running a local Aztec devnet:

```bash
# In your aztec-packages directory
cat ~/.aztec/devnet/l1-contracts.json | jq '.addresses'
```

Look for:
- `tallySlashingProposerAddress`
- `slasherAddress`
- `rollupAddress`

### 3. Start Development Server

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

## What You Should See

1. **Header**: Shows current round number and quorum
2. **Stats Panel**: Displays active slashings, vetoed payloads, etc.
3. **Active Slashings**: Any rounds currently in the veto window
4. **All Rounds**: Historical view of detected slashings

## Testing Locally

### Scenario 1: Monitor Without Veto Rights

Just browse the interface to see detected slashings. You won't be able to veto without being the VETOER.

### Scenario 2: Test Veto Functionality

1. **Connect wallet** (must be VETOER address)
2. Wait for a slashing to appear in "Active Slashings"
3. Click "Veto This Payload"
4. Confirm the transaction
5. Watch the slashing be marked as "Vetoed"

## Troubleshooting

### "Initializing..." stuck

**Problem**: Frontend can't connect to L1 or contracts

**Solutions**:
- Check L1 RPC URL is accessible: `curl http://localhost:8545`
- Verify contract addresses are correct
- Check browser console for error messages

### "No active slashing rounds"

**Problem**: No slashings to veto yet

**This is normal!** Slashings only happen when:
1. Validators misbehave (inactivity, double-propose, etc.)
2. Enough proposers vote for slashing (reach quorum)
3. The round enters the veto window

### Node RPC not responding

**Problem**: Can't reach Aztec node

**Solutions**:
- Ensure Aztec node is running
- Check node is exposing RPC on ports 8080/8880
- Verify CORS if accessing from different origin:
  ```bash
  # Start node with CORS enabled
  aztec start --node --port 8080 --admin-port 8880
  ```

### Wallet connection issues

**Problem**: Can't connect wallet for veto

**Solutions**:
- Install MetaMask or WalletConnect compatible wallet
- Ensure wallet is on the same network as L1
- Check that connected account matches VETOER address

## Next Steps

- **Monitor in production**: Deploy to Vercel/Netlify
- **Set up alerts**: Add webhook notifications for active slashings
- **Customize**: Modify UI, add features, integrate with your systems

## Development Workflow

```bash
# Run dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

## File Structure Overview

```
src/
├── components/      # React UI components
├── lib/
│   ├── contracts/   # Contract ABIs
│   ├── l1Monitor    # L1 interaction
│   ├── nodeRpcClient # Node RPC calls
│   └── slashingDetector # Detection logic
├── hooks/           # React hooks
├── store/           # Zustand state
└── types/           # TypeScript types
```

## Common Tasks

### Change polling interval

Edit `src/App.tsx`:

```typescript
const slashingConfig: SlashingMonitorConfig = {
  // ...
  l1PollInterval: 12000, // 12s (change this)
  l2PollInterval: 8000,  // 8s (change this)
}
```

### Add custom contract method

1. Add to ABI in `src/lib/contracts/`
2. Add method to `L1Monitor` class
3. Use in detector or components

### Customize UI

All components in `src/components/` use Tailwind CSS. Modify classes to change appearance.

## Production Deployment

### Environment Variables

Set these in your hosting platform (Vercel, Netlify, etc.):

```
VITE_L1_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
VITE_TALLY_PROPOSER_ADDRESS=0x...
VITE_SLASHER_ADDRESS=0x...
VITE_ROLLUP_ADDRESS=0x...
VITE_NODE_RPC_URL=https://your-aztec-node.com:8080
VITE_NODE_ADMIN_URL=https://your-aztec-node.com:8880
```

### Build Command

```bash
npm run build
```

Output is in `dist/` folder.

### Recommended Hosting

- **Vercel**: Connect GitHub repo, auto-deploy on push
- **Netlify**: Same as Vercel
- **CloudFlare Pages**: Fast CDN, free tier
- **GitHub Pages**: Free, but manual deployment

## Getting Help

- Check the [main README](./README.md) for detailed docs
- [Aztec Discord](https://discord.gg/aztec)
- [Aztec Docs](https://docs.aztec.network)

Happy monitoring! 🔍
