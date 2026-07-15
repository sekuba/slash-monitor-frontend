# Aztec v5 upgrade review

Reviewed on 2026-07-15 from the verified contract sources and discovery output in
`l2beat/packages/config/src/projects/aztecnetwork/.flat` and `discovered.json`, followed by direct Ethereum and
Sepolia RPC reads.

## Canonical deployments

The Registry addresses remain stable. The monitor must resolve the active stack from the Registry rather than keep
Rollup, Slasher, or SlashingProposer addresses in configuration.

### Ethereum

| Contract | Address |
| --- | --- |
| Registry | `0x35b22e09Ee0390539439E24f06Da43D83f90e298` |
| Rollup | `0x91fF8bbD8Ebb07893010D50A48A1609e5EBd8E34` |
| Slasher | `0xCD6855470A01aBcd989126A1183Fb50673952548` |
| SlashingProposer | `0x8A36b8F2Ca71D8d8Bd98e03Ebf8B4D0939Daf0bA` |

The cutover transaction was
`0xff2db4e4bba583f2451478bfe4703e16afc79f0b463fb60615ebe3494142437b` in block 25,533,241 at
2026-07-14 20:22:47 UTC. The Rollup reports version `4248422647`. At the review head, the proposer was at round 140
with 3,462 active attesters, and both the pending and legacy slasher slots were empty.
All rounds in the active lifetime window (106 through 140 at the review head) reported zero ballots, so there was no
live v5 slashing payload to review.

### Sepolia

| Contract | Address |
| --- | --- |
| Registry | `0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba` |
| Rollup | `0xD73A91bdcF6891C7642F3e460036e1ef2CC23178` |
| Slasher | `0xBFa3625CfC7cdDAbF29961e12C4399c5bd8D8763` |
| SlashingProposer | `0x504331248Eb1359C247a0e6895fFfeA70ecdb9a8` |

The cutover transaction was
`0xa5fea6306e52e2b69d7b413b89aba0bf83f900cac1cd50d30da79a7f704ab043` in block 11,263,954 at
2026-07-13 12:53:00 UTC. The Rollup reports version `1821665230`.

## Relevant v5 changes

- Aztec upgrades append a Rollup to the Registry; historical Rollups intentionally remain callable. The old
  slashmon addresses therefore continued returning plausible rounds instead of failing after the cutover.
- `TallySlashingProposer` is now `SlashingProposer`. The read methods used by slashmon remain compatible, but the
  monitor only supports the v5 contract stack and ABI.
- `getRound().voteCount` is the total number of ballots cast in the round. It is not evidence that any individual
  validator reached quorum. Only a nonempty `getTally()` result proves that at least one target accumulated quorum.
- Mainnet timing stays at 128 slots per round, 28 rounds of execution delay, 34 rounds of lifetime, a two-round
  target offset, committee size 48, and quorum 65. Slash amounts changed from 2,000/2,000/2,000 AZTEC to
  2,000/5,000/5,000 AZTEC. Slashmon reads these values and tally amounts from the contracts.
- v5 Rollup staking supports a queued Slasher replacement after 60 days and authorizes the outgoing Slasher for a
  30-day drain window. `getPendingSlasher()` and `getLegacySlasher()` expose those states.
- Votes and slash actions do not encode an offense reason on L1, so slashmon cannot reliably infer or display one.

The retired hardcoded stack was Rollup `0xAe2001f7e21d5EcABf6234E9FDd1E76F50F74962`, Slasher
`0x64E6e9Bb9f1E33D319578B9f8a9C719Ca6D46eBb`, and proposer
`0xa4a38fD0108C00983E75616b638Ff3321FD26958`. Its time-derived slot and round continued advancing, while its active
attester count was zero. That combination explains why the old monitor looked healthy and empty rather than
reporting an address failure.

The retired proposer still exposes an old round 1213 tally with 127 ballots and one 2,000 AZTEC action. It is not a
v5 pending slash: the target has no effective stake in the retired Rollup, and the v5 Rollup does not authorize the
old Slasher as a legacy Slasher. There is therefore no old payload to carry into the v5 monitor.

The official background is in Aztec's [network upgrade documentation](https://docs.aztec.network/participate/governance/upgrades),
[AZUP-2 overview](https://forum.aztec.network/t/azup-2-is-ready-for-proposal/8605), and
[v5 deployment verification](https://forum.aztec.network/t/proposal-v5-payload-deployed/8606).

## Monitor changes

- Resolve Registry → Rollup → Slasher → SlashingProposer at startup and before every scan.
- Verify the RPC chain ID, a head age of at most 15 minutes, contract bytecode, and active, pending, and legacy
  proposer backreferences.
- Pin topology, current state, round metadata, tallies, payload addresses, and veto reads to one L1 snapshot block.
- Automatically discard the old scan and initialize the newly canonical stack when the Registry topology changes.
- Treat an unverifiable topology, stale head, or total round-scan failure as stale/unavailable and suppress alerts.
- Use total ballots only as an optimization gate before computing the tally; use slash actions as quorum evidence.
- Correct the first executable and expiry boundaries, pause protection range, unique-validator counts, and changing
  payload notifications.
- Remove the ineffective immutable caches, ignored lookback setting, direct contract address configuration, and
  unused bootstrap/veto instruction components.
- Keep RPC overrides separate by chain so a testnet override cannot leak into mainnet monitoring.

An active pending Slasher is shown as a deployment warning. If a legacy Slasher drain window is active, slashmon
reports partial coverage because the primary round list follows the active v5 SlashingProposer and does not merge
the outgoing proposer's draining rounds. The current Ethereum v5 deployment has neither state active.
