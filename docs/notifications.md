# Notification content contract

PINGME alerts are transitions in a per-sequencer slashing case. An operator
should be able to answer, without decoding contract data:

1. Which watched sequencer is affected?
2. Where is it on the slashing path?
3. What changed, and what happens next?
4. Is the reason local evidence or an L1 fact?
5. Where can the underlying evidence be inspected?

An alert links to the exact case whose transition triggered it, not just the
PINGME landing page.

The heading keeps the compact `sequencer · case status` form. The body states
the event, full sequencer address, relevant slot, epoch or round, UTC
observation time, and reason provenance without repeating explanatory prose.

## Claims allowed at each stage

| Stage | What the alert may claim |
| --- | --- |
| Duty miss | This node observed a missed duty or a qualifying inactive epoch. State the progress, such as `1 of 2`; this is not yet a node offense or L1 vote. |
| Node offense | This node registered a named offense and local penalty. It is not network consensus and has not necessarily been voted on L1. |
| Awaiting target round | The node evidence maps to the stated future slashing round under current contract parameters. It may never receive a vote. |
| L1 mention | One or more onchain votes mention the address and exact target epoch with a penalty unit. L1 supplies no reason. |
| Candidate | The current tally yields an action and deterministic predicted payload address. The payload is not deployed and the tally can change until the round closes. |
| Execution delay / executable | The stable candidate is before or inside its execution window. State veto, pause, start, and expiry independently. |
| Executed | `executeRound` marked the round executed and, for a nonempty action list, deployed and called its payload. This does not by itself prove that stake was removed from this sequencer. |
| Stake removed | A canonical Rollup `Slashed` log confirms the address and actual amount deducted. |
| Ejection / exiting | Canonical stake state confirms removal from the active set or entry into the delayed exit flow. |
| Vetoed / expired / reorged | The exact candidate was vetoed, its execution window ended, or prior L1 evidence left the canonical chain. Describe this as a state change, not as if the earlier warning never existed. |

Never use “slash payload exists” before execution. Before then use “candidate
action” and “predicted payload address.”

## Reason and correlation wording

L1 votes contain no offense type. Alerts may attach a reason only as separately
labelled node evidence matched by address and exact target epoch or slot:

> Event: Quorum reached for a 2,000 AZTEC slash
>
> Epoch: 123
>
> Reason: Inactivity (node evidence)

They must not say:

> L1 confirmed a 2,000 AZTEC inactivity slash.

If several local offenses match the same L1 action, list them rather than
choosing one. If no evidence matches, say `Reason: Not encoded on L1`. An
approximate timestamp match is insufficient.

## Required context

Every alert includes:

- watched sequencer address;
- current case status in the heading;
- exact slot, epoch, or slashing round as applicable;
- UTC observation time;
- reason and its node-evidence provenance, or that no reason is encoded on L1;
- actual AZTEC amount or candidate AZTEC amount, explicitly distinguished;
- the next transition and countdown, when deterministic; and
- for Telegram, the exact slashveto.me case URL.

Stage-specific evidence is:

| Event family | Required facts |
| --- | --- |
| Sentinel | missed slot or range, epoch, missed/total duties, target, streak progress, and coverage health |
| Node offense | offense type, evidence slot/epoch, local penalty, registration state, and expected target round |
| L1 vote | contract lineage, voting round, exact target epoch, unit/support, pinned block, and matching node evidence if any |
| Candidate lifecycle | action amount, predicted address, round-close stability, execution start, expiry, veto, and pause |
| Execution / slash | transaction, round, deployed payload, requested action, canonical `Slashed` amount, and post-slash/ejection state when known |
| Reorg / correction | orphaned block or transaction and the case state that replaced it |

Telegram includes the exact case link, a Dashtec sequencer link, and an
Etherscan transaction link when a transaction hash exists. Web Push contains no
links in its copy and opens the exact case when selected.

## Alert transitions and noise control

Alert on meaningful path changes, not every poll:

- first missed duty in an epoch;
- newly qualifying inactive epoch or changed streak progress;
- offense registration or safe withdrawal;
- first L1 vote and slash quorum; intermediate ballot counts update the case
  without sending alerts;
- candidate addition, removal, amount change, or address change;
- round close, execution start, veto, materially changed pause protection, or
  expiry;
- execution, actual stake deduction, or ejection; and
- canonical reorg correction.

A candidate-address change describes the affected address's action delta. A
previous veto is relevant only if the immediately preceding exact address was
vetoed and the replacement is not.

Repeated observations of the same stable state update freshness without
sending another alert. Stable transition IDs support at-least-once delivery and
allow a duplicate provider delivery to be recognized.

## Amounts and time

AZTEC has 18 onchain decimals. Operator copy renders token units with digit
grouping and required fractional precision; it never calls the raw integer
“base units.”

Countdowns are derived from live slot duration and contract parameters. Include
the absolute slot and estimated wall-clock time because L1 inclusion can move
the observed transition. “Pause protected” is allowed only when the scheduled
pause extends through the entire remaining execution window.

The protocol definitions behind these claims are in
[Slashing and ejection](slashing.md).
