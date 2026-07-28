import { formatAztec } from './formatToken';
import type { MonitorEvent } from '@/types/backendApi';

export function describeMonitorEvent(event: MonitorEvent): string {
    const offense = event.offense;
    if (event.type === 'inactivity_first_miss') {
        return `Missed duty${offense?.slot ? ` at slot ${offense.slot}` : ''}` +
            `${offense?.epoch ? ` in epoch ${offense.epoch}` : ''}. ` +
            'This is early Sentinel evidence, not a registered slash offense or an L1 vote.';
    }
    if (event.type === 'inactivity_epoch_completed') {
        return event.body || 'The inactivity threshold was evaluated for this epoch.';
    }
    if (event.type.startsWith('pending_offense_')) {
        const position = offense?.epoch
            ? `epoch ${offense.epoch}`
            : offense?.epochOrSlot
                ? `${offense.timeUnit ?? 'position'} ${offense.epochOrSlot}`
                : 'this position';
        const amount = offense?.amount ? ` Proposed slash: ${formatAztec(offense.amount)} AZTEC.` : '';
        const voteRound = offense?.proposalRound
            ? ` Expected vote round: ${offense.proposalRound}.`
            : '';
        const reason = humanize(offense?.reason ?? 'unknown').toLowerCase();
        const article = /^[aeiou]/i.test(reason) ? 'an' : 'a';
        return `Node registered ${article} ${reason} offense for ${position}.` +
            `${amount}${voteRound} This is a node-local offense, not an L1 vote or slash payload.`;
    }
    const round = roundContext(event);
    const amount = actionAmount(event);
    if (event.type === 'onchain_vote_targeted') {
        return `At least one L1 slash vote named this address${round}. ` +
            'This is vote evidence only; no slash payload exists yet.';
    }
    if (event.type === 'onchain_targeted') {
        return `This address entered the slash payload${round}.${amount}` +
            `${event.l1?.executableSlot ? ` Execution opens at slot ${event.l1.executableSlot}.` : ''}`;
    }
    if (event.type === 'onchain_payload_changed') {
        return payloadChangeDescription(event, round, amount);
    }
    if (event.type === 'onchain_executable') {
        return `The slash payload${round} is executable.${amount}` +
            `${event.l1?.expirySlot ? ` Execution expires at slot ${event.l1.expirySlot}.` : ''}`;
    }
    if (event.type === 'onchain_executable_after_pause' || event.type === 'onchain_execution_paused') {
        return `The global pause blocks execution of the slash payload${round}; ` +
            `expiry${event.l1?.expirySlot ? ` at slot ${event.l1.expirySlot}` : ''} is unchanged.`;
    }
    if (event.type === 'onchain_pause_protected') {
        return `The scheduled pause protects the slash payload${round} through its expiry.`;
    }
    if (event.type === 'onchain_vetoed') return `The slash payload${round} was vetoed.${amount}`;
    if (event.type === 'onchain_veto_reverted') {
        return `The same slash payload${round} is no longer reported as vetoed.${amount}`;
    }
    if (event.type === 'onchain_expired') {
        return `The execution window for the slash payload${round} closed without execution.`;
    }
    if (event.type === 'onchain_executed') {
        return `The slash payload${round} was executed. A Slashed event separately confirms the ` +
            'amount actually removed from this sequencer’s stake.';
    }
    if (event.type === 'l1_slash_confirmed' || event.type === 'l1_slash_reconfirmed') {
        return `${formatAztec(event.l1?.amount)} AZTEC was removed in confirmed L1 block ` +
            `${event.l1?.blockNumber ?? 'unknown'}.`;
    }
    if (event.type === 'l1_slash_reorged') {
        return `The earlier ${formatAztec(event.l1?.amount)} AZTEC slash event is no longer on ` +
            'the canonical L1 chain.';
    }
    return event.body || humanize(event.type);
}

function payloadChangeDescription(event: MonitorEvent, round: string, amount: string): string {
    const changes = event.l1?.actionChanges ?? [];
    let description = `The slash payload changed${round}.${amount}`;
    if (changes.length === 1) {
        const [change] = changes;
        if (change.kind === 'added') {
            description = `This sequencer was added to the slash payload${round}.` +
                amount;
        } else if (change.kind === 'removed') {
            description = `This sequencer was removed from the slash payload${round}. ` +
                'No slash is currently proposed for it in this round.';
        } else {
            description = `The proposed slash for this sequencer changed from ` +
                `${formatAztec(change.previousAmount)} to ` +
                `${formatAztec(change.currentAmount)} AZTEC${round}.`;
        }
    } else if (changes.length > 1) {
        description = `Slash actions changed for ${changes.length} sequencers${round}.${amount}`;
    }
    const previousPayload = event.l1?.previousPayloadAddress;
    const currentPayload = event.l1?.payloadAddress;
    const replacedVeto = event.l1?.previousPayloadWasVetoed === true &&
        previousPayload &&
        currentPayload &&
        previousPayload.toLowerCase() !== currentPayload.toLowerCase() &&
        event.l1?.isVetoed === false;
    return replacedVeto
        ? `${description} The previous payload was vetoed; the new payload is not.`
        : description;
}

function roundContext(event: MonitorEvent): string {
    if (!event.l1?.round) return '';
    const role = event.l1.role ?? 'active';
    const epochs = event.l1.targetEpochs;
    const epochText = epochs.length === 0
        ? ''
        : epochs.length === 1
            ? ` for target epoch ${epochs[0]}`
            : ` for target epochs ${epochs[0]}–${epochs[epochs.length - 1]}`;
    return ` in ${role} round ${event.l1.round}${epochText}`;
}

function actionAmount(event: MonitorEvent): string {
    const amounts = event.l1?.actions
        .filter((action) => event.targets.some(
            (target) => target.toLowerCase() === action.sequencer.toLowerCase(),
        ))
        .map((action) => action.amount) ?? [];
    const unique = [...new Set(amounts)];
    if (unique.length !== 1) return '';
    return ` Proposed slash: ${formatAztec(unique[0])} AZTEC${amounts.length > 1 ? ' each.' : '.'}`;
}

function humanize(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
