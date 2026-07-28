const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const AZTEC_DECIMALS = 18n;
const AZTEC_SCALE = 10n ** AZTEC_DECIMALS;
const MAX_TARGET_PREVIEW = 3;

export function formatAztecAmount(value) {
  try {
    const amount = BigInt(value);
    const negative = amount < 0n;
    const absolute = negative ? -amount : amount;
    const whole = absolute / AZTEC_SCALE;
    const fraction = (absolute % AZTEC_SCALE)
      .toString()
      .padStart(Number(AZTEC_DECIMALS), '0')
      .replace(/0+$/, '');
    return `${negative ? '-' : ''}${groupDigits(whole.toString())}${fraction ? `.${fraction}` : ''}`;
  } catch {
    return String(value);
  }
}

export function shortAddress(address) {
  const value = String(address);
  return ADDRESS_PATTERN.test(value)
    ? `${value.slice(0, 6)}…${value.slice(-4)}`
    : value;
}

export function formatEpochRange(values, { prefix = true } = {}) {
  const normalized = [...new Set((values ?? []).map(String))];
  if (normalized.length === 0) return '';
  const label = normalized.length === 1 ? 'epoch' : 'epochs';
  let range;
  try {
    const epochs = normalized.map(BigInt);
    const consecutive = epochs.every(
      (epoch, index) => index === 0 || epoch === epochs[index - 1] + 1n,
    );
    range = consecutive && normalized.length > 1
      ? `${normalized[0]}–${normalized[normalized.length - 1]}`
      : normalized.join(', ');
  } catch {
    range = normalized.join(', ');
  }
  return prefix ? `${label} ${range}` : range;
}

export function eventValidators(event) {
  const candidates = Array.isArray(event?.targets) && event.targets.length > 0
    ? event.targets
    : Array.isArray(event?.data?.validators) && event.data.validators.length > 0
      ? event.data.validators
      : event?.data?.validator
        ? [event.data.validator]
        : [];
  return [...new Set(candidates
    .map((value) => String(value).toLowerCase())
    .filter((value) => ADDRESS_PATTERN.test(value)))];
}

export function notificationContent(event) {
  const data = event?.data ?? {};
  const targets = eventValidators(event);
  const epochs = formatEpochRange(data.targetEpochs);
  const round = data.round === undefined ? '' : `Round ${data.round}`;
  const position = [round, epochs].filter(Boolean).join(' · ');
  const proposed = proposedAmount(data.actions, targets);
  const proposedText = proposed === null ? '' : ` Proposed slash: ${formatAztecAmount(proposed)} AZTEC.`;
  const actual = data.actualAmount === undefined
    ? ''
    : ` Amount: ${formatAztecAmount(data.actualAmount)} AZTEC.`;
  const expiry = data.expirySlot === null || data.expirySlot === undefined
    ? ''
    : ` Expires at slot ${data.expirySlot}${data.expiryAt ? ` (${data.expiryAt})` : ''}.`;
  const block = data.blockNumber === null || data.blockNumber === undefined
    ? ''
    : ` L1 block ${data.blockNumber}.`;
  const config = {
    node_offense_detected: {
      title: 'Node reported a slash offense',
      body: `${offenseLabel(data)} at ${offensePosition(data)}.${configuredPenaltyText(data)} ` +
        'This is node evidence; no L1 proposal exists yet.',
    },
    onchain_quorum_candidate: {
      title: 'Slash proposal reached quorum',
      body: `The current L1 tally has quorum-backed slash actions${position ? ` in ${position}` : ''}.` +
        `${proposedText}${expiry} ${data.votingOpen
          ? 'Voting is open; actions may change.'
          : 'Voting is closed; the tally is under review.'}`,
    },
    onchain_ready: {
      title: 'Slash proposal ready to execute',
      body: `${position || 'An L1 slash proposal'} can now be executed.${proposedText}${expiry}`,
    },
    onchain_vetoed: {
      title: 'Slash proposal vetoed',
      body: `${position || 'An L1 slash proposal'} closed with its exact payload vetoed.` +
        `${proposedText}${expiry}`,
    },
    onchain_expired: {
      title: 'Slash proposal expired',
      body: `${position || 'An L1 slash proposal'} expired without execution.${proposedText}`,
    },
    l1_slash_confirmed: {
      title: 'Validator slashed on L1',
      body: `A confirmed L1 transaction slashed this validator.${actual}${logCountText(data)}${block}`,
    },
    l1_slash_reorged: {
      title: 'Slash outcome reorged out',
      body: `The previously confirmed slash is no longer canonical.${actual}${block}`,
    },
    l1_slash_reconfirmed: {
      title: 'Slash outcome confirmed again',
      body: `The slash is canonical again after an L1 reorganization.${actual}${block}`,
    },
    notification_channel_verification: {
      title: 'Slashmon notifications connected',
      body: 'This browser can receive Slashmon alerts.',
    },
    notification_test: {
      title: 'Slashmon test alert',
      body: 'Notifications are connected. No slashing event occurred.',
    },
  }[event?.type];
  if (!config) throw new Error(`Unsupported notification event type: ${String(event?.type)}`);
  return config;
}

export function formatNotificationBody(event) {
  const { body } = notificationContent(event);
  const targets = eventValidators(event);
  if (targets.length === 0) return body;
  const preview = targets.slice(0, MAX_TARGET_PREVIEW).map(shortAddress).join(', ');
  const remainder = targets.length - MAX_TARGET_PREVIEW;
  const targetLine = targets.length === 1
    ? `Validator: ${preview}`
    : `Watched validators (${targets.length}): ${preview}${remainder > 0 ? ` (+${remainder} more)` : ''}`;
  return `${targetLine}\n${body}`;
}

export function etherscanReferenceLines(event) {
  const data = event?.data ?? {};
  const origin = etherscanOrigin(data.chainId ?? defaultChainId(event?.network));
  if (!origin) return [];
  const lines = [];
  if (HASH_PATTERN.test(String(data.transactionHash ?? ''))) {
    const label = event?.type === 'l1_slash_reorged'
      ? 'Original transaction (may be unavailable)'
      : 'L1 transaction';
    lines.push(`${label}: ${origin}/tx/${data.transactionHash}`);
  }
  const replacementBlock = event?.type === 'l1_slash_reorged'
    ? decimalString(data.replacementCheckpoint?.blockNumber)
    : null;
  const blockNumber = replacementBlock ?? decimalString(data.blockNumber);
  if (blockNumber) {
    lines.push(`${replacementBlock ? 'Replacement L1 block' : 'L1 block'}: ${origin}/block/${blockNumber}`);
  }
  if (ADDRESS_PATTERN.test(String(data.payloadAddress ?? ''))) {
    lines.push(`Slash payload: ${origin}/address/${data.payloadAddress}`);
  }
  return lines;
}

export function etherscanOrigin(chainId) {
  const normalized = Number(chainId);
  if (normalized === 1) return 'https://etherscan.io';
  if (normalized === 11_155_111) return 'https://sepolia.etherscan.io';
  return null;
}

function proposedAmount(actions, targets) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const targetSet = new Set(targets);
  let amount = 0n;
  let matched = false;
  for (const action of actions) {
    const address = String(action.validator ?? '').toLowerCase();
    if (targetSet.size > 0 && !targetSet.has(address)) continue;
    try {
      amount += BigInt(action.amount ?? action.slashAmount);
      matched = true;
    } catch {
      return null;
    }
  }
  return matched ? amount.toString() : null;
}

function offenseLabel(data) {
  const label = String(data.offenseTypeName ?? 'Slash offense');
  return /^unknown_\d+$/.test(label) ? label : label.replaceAll('_', ' ');
}

function offensePosition(data) {
  if (data.timeUnit === 'unknown' && data.epochOrSlot !== undefined) {
    return `position ${data.epochOrSlot}`;
  }
  return data.timeUnit && data.epochOrSlot !== undefined
    ? `${data.timeUnit} ${data.epochOrSlot}`
    : 'an unknown position';
}

function configuredPenaltyText(data) {
  if (data.configuredPenalty === undefined) return '';
  return ` Node-configured penalty: ${formatAztecAmount(data.configuredPenalty)} AZTEC.`;
}

function logCountText(data) {
  const count = Number(data.logCount);
  return Number.isSafeInteger(count) && count > 1 ? ` ${count} Slashed logs were grouped.` : '';
}

function groupDigits(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function defaultChainId(network) {
  if (network === 'mainnet') return 1;
  if (network === 'testnet') return 11_155_111;
  return null;
}

function decimalString(value) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) ? text : null;
}
