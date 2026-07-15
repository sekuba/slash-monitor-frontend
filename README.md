# Aztec Slashing Monitor

This is a tool by and for the [Slash Veto Council](https://github.com/aztec-slash-veto/council/) and the Aztec community. It shows slashing rounds before they execute, including the targeted validators, amounts, veto status, and precomputed payload address.

The monitor discovers the canonical Rollup, Slasher, and SlashingProposer from Aztec's stable Registry contract. It checks that the contracts point back to each other and follows Registry upgrades automatically.

See [V5_UPGRADE_REVIEW.md](V5_UPGRADE_REVIEW.md) for the contract/source review, cutover details, and monitor impact.

To run it locally:

- Use Node 24.
- Copy [.env.example](.env.example) to `.env` and optionally replace the public RPC endpoints.
- Run `pnpm install` and `pnpm dev`.

Mainnet is the default. Add `?network=testnet` to the URL for Sepolia testnet.
