# Notification content contract

PINGME alerts must let an operator answer four questions without decoding raw
contract values:

1. Which watched sequencer is affected?
2. Which slashing stage was observed?
3. Which epoch, slot, or round does it concern?
4. Where can the observation be inspected?

## Slashing stages

Copy must keep these stages distinct:

| Stage | What the alert may claim |
| --- | --- |
| Sentinel precursor | A duty was missed or an inactivity threshold was met. This is not yet a registered offense or L1 vote. |
| Node offense | One Aztec node registered an offense and proposed a slash amount. This is not an L1 vote or payload. |
| L1 vote | At least one vote named the sequencer. No slash payload exists until the tally reaches quorum. |
| Slash payload | The L1 tally produced concrete slash actions and amounts. The payload may still be delayed, paused, vetoed, or expire. |
| Executed round | The payload was executed. A separate Rollup `Slashed` event confirms the amount actually removed from stake. |
| Confirmed slash | A canonical Rollup `Slashed` event identifies the sequencer, token amount, transaction, and block. |

Aztec's operator documentation defines the offense → vote → tally → execution
flow and the round offset. It also confirms that slash values such as
`2000000000000000000000` represent `2,000 AZTEC`, not a user-facing “base
units” amount:

- <https://docs.aztec.network/operate/operators/sequencer-management/slashing_and_offenses>
- <https://docs.aztec.network/networks>

## Required context

Every delivered alert identifies the watched sequencer before the event copy.
Telegram also includes:

- the exact Slashmon event URL;
- a Dashtec sequencer URL for up to three affected watched addresses;
- an Etherscan transaction when the event has one;
- otherwise, or additionally when useful, the pinned L1 block and slash
  payload address.

Web Push identifies the watched address in its body and opens the exact
Slashmon event, where the address links to Dashtec and L1 evidence links to the
appropriate mainnet or Sepolia Etherscan.

Event-specific copy includes:

| Event family | Required facts |
| --- | --- |
| Sentinel | epoch, missed slot or slot range, missed/total duties, inactivity streak |
| Node offense | offense type, epoch or slot, AZTEC amount, offense round and expected vote round when available |
| L1 vote | voting round, target epoch range, observation epoch and slot |
| L1 payload lifecycle | round, target epochs, AZTEC amount when known, execution/expiry slots, observation epoch and slot |
| Confirmed slash/reorg | AZTEC amount, L1 block, canonical/reorg status |

Payload-change alerts describe the address-level delta: a sequencer was added,
removed, or had its proposed AZTEC amount changed. They do not include a
generic warning about old veto state. A replacement warning is justified only
when the immediately preceding snapshot proves that the exact previous payload
address was vetoed and the new payload address is not. In that case the alert
names both states and links both payload contracts on Etherscan.

AZTEC formatting always removes the token's 18 onchain decimals, adds digit
grouping, and preserves any nonzero fractional precision. Copy must never use
“base units” for an operator-facing token amount.
