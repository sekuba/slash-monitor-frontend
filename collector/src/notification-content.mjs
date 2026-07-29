const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function formatNotificationBody(transition) {
  const body = typeof transition?.body === 'string' ? transition.body.trim() : '';
  const sequencer = transitionSequencer(transition);
  return sequencer
    ? `Sequencer: ${shortAddress(sequencer)}${body ? `\n${body}` : ''}`
    : body;
}

export function dashtecReferenceLines(transition) {
  const sequencer = transitionSequencer(transition);
  if (!sequencer) return [];
  const origin = transition?.network === 'testnet'
    ? 'https://testnet.dashtec.xyz'
    : 'https://dashtec.xyz';
  return [`Dashtec: ${origin}/sequencers/${sequencer}`];
}

export function etherscanReferenceLines(transition) {
  const data = transition?.data ?? {};
  const origin = transition?.network === 'testnet'
    ? 'https://sepolia.etherscan.io'
    : 'https://etherscan.io';
  const lines = [];
  if (HASH.test(String(data.transactionHash ?? ''))) {
    lines.push(`Etherscan transaction: ${origin}/tx/${data.transactionHash}`);
  }
  if (/^\d+$/.test(String(data.blockNumber ?? ''))) {
    lines.push(`Etherscan block: ${origin}/block/${data.blockNumber}`);
  }
  if (ADDRESS.test(String(data.payloadAddress ?? ''))) {
    lines.push(`Etherscan candidate payload: ${origin}/address/${data.payloadAddress}`);
  }
  return lines;
}

function transitionSequencer(transition) {
  const value = transition?.data?.sequencer ?? transition?.targets?.[0];
  const normalized = String(value ?? '').toLowerCase();
  return ADDRESS.test(normalized) ? normalized : null;
}

function shortAddress(value) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
