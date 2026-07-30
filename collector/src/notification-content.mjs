const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function formatNotificationBody(transition) {
  const body = typeof transition?.body === 'string' ? transition.body.trim() : '';
  const sequencer = transitionSequencer(transition);
  return sequencer
    ? `Sequencer: ${sequencer}${body ? `\n${body}` : ''}`
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
    lines.push(`Transaction: ${origin}/tx/${data.transactionHash}`);
  }
  return lines;
}

function transitionSequencer(transition) {
  const targets = Array.isArray(transition?.targets) ? transition.targets : [];
  const value = transition?.data?.sequencer ?? (targets.length === 1 ? targets[0] : null);
  const normalized = String(value ?? '').toLowerCase();
  return ADDRESS.test(normalized) ? normalized : null;
}
