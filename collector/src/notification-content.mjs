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
    const formattedWhole = groupDigits(whole.toString());
    return `${negative ? '-' : ''}${formattedWhole}${fraction ? `.${fraction}` : ''}`;
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

export function eventSequencers(event) {
  const candidates = Array.isArray(event?.targets) && event.targets.length > 0
    ? event.targets
    : Array.isArray(event?.data?.sequencers) && event.data.sequencers.length > 0
      ? event.data.sequencers
      : event?.data?.sequencer
        ? [event.data.sequencer]
        : [];
  return [...new Set(
    candidates
      .map((value) => String(value).toLowerCase())
      .filter((value) => ADDRESS_PATTERN.test(value)),
  )];
}

export function formatNotificationBody(event) {
  const body = typeof event?.body === 'string' ? event.body.trim() : '';
  const targets = eventSequencers(event);
  if (targets.length === 0) return body;
  const preview = targets.slice(0, MAX_TARGET_PREVIEW).map(shortAddress).join(', ');
  const remainder = targets.length - MAX_TARGET_PREVIEW;
  const targetLine = targets.length === 1
    ? `Sequencer: ${preview}`
    : `Watched sequencers (${targets.length}): ${preview}${remainder > 0 ? ` (+${remainder} more)` : ''}`;
  return body ? `${targetLine}\n${body}` : targetLine;
}

export function dashtecReferenceLines(event) {
  const targets = eventSequencers(event);
  const origin = event?.network === 'testnet'
    ? 'https://testnet.dashtec.xyz'
    : 'https://dashtec.xyz';
  return targets.slice(0, MAX_TARGET_PREVIEW).map((sequencer) =>
    targets.length === 1
      ? `Dashtec: ${origin}/sequencers/${sequencer}`
      : `Dashtec ${shortAddress(sequencer)}: ${origin}/sequencers/${sequencer}`,
  );
}

export function etherscanReferenceLines(event) {
  const data = event?.data ?? {};
  const origin = etherscanOrigin(data.chainId ?? defaultChainId(event?.network));
  if (!origin) return [];
  const lines = [];
  if (HASH_PATTERN.test(String(data.transactionHash ?? ''))) {
    const label = event?.type === 'l1_slash_reorged'
      ? 'Etherscan original tx (may be unavailable)'
      : 'Etherscan transaction';
    lines.push(`${label}: ${origin}/tx/${data.transactionHash}`);
  }
  const replacementBlock = event?.type === 'l1_slash_reorged'
    ? decimalString(data.replacementCheckpoint?.blockNumber)
    : null;
  const blockNumber = replacementBlock ?? decimalString(data.blockNumber);
  if (blockNumber) {
    const label = replacementBlock ? 'Etherscan replacement block' : 'Etherscan block';
    lines.push(`${label}: ${origin}/block/${blockNumber}`);
  }
  if (ADDRESS_PATTERN.test(String(data.payloadAddress ?? ''))) {
    lines.push(`Etherscan slash payload: ${origin}/address/${data.payloadAddress}`);
  }
  if (
    data.previousPayloadWasVetoed === true &&
    ADDRESS_PATTERN.test(String(data.previousPayloadAddress ?? '')) &&
    String(data.previousPayloadAddress).toLowerCase() !== String(data.payloadAddress ?? '').toLowerCase()
  ) {
    lines.push(
      `Etherscan previous vetoed payload: ${origin}/address/${data.previousPayloadAddress}`,
    );
  }
  const vetoContext = event?.type === 'onchain_vetoed' ||
    event?.type === 'onchain_veto_reverted' ||
    data.previousPayloadWasVetoed === true;
  if (vetoContext && ADDRESS_PATTERN.test(String(data.slasherAddress ?? ''))) {
    lines.push(`Etherscan Slasher contract: ${origin}/address/${data.slasherAddress}`);
  }
  return lines;
}

export function etherscanOrigin(chainId) {
  const normalized = Number(chainId);
  if (normalized === 1) return 'https://etherscan.io';
  if (normalized === 11_155_111) return 'https://sepolia.etherscan.io';
  return null;
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
