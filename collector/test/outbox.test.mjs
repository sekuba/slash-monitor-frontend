import assert from 'node:assert/strict';
import test from 'node:test';

import { CaseRepository } from '../src/case-repository.mjs';
import { SEQUENCER_A, SEQUENCER_B } from './helpers.mjs';

const LINEAGE = '0x3333333333333333333333333333333333333333';

function transitionFor(sequencer, { id, severity = 'info', at = 1_000 } = {}) {
  return {
    id: id ?? `transition:${sequencer}:${severity}:${at}`,
    caseId: `case:mainnet:${LINEAGE}:${sequencer}:1`,
    sequencer,
    fromStage: null,
    toStage: 'candidate',
    severity,
    title: `${sequencer} · Candidate`,
    body: 'Event: Quorum reached',
    observedAt: new Date(at).toISOString(),
  };
}

function caseFor(sequencer) {
  return {
    id: `case:mainnet:${LINEAGE}:${sequencer}:1`,
    network: 'mainnet',
    sequencer,
    lineageId: LINEAGE,
    targetEpoch: '1',
    state: { payloadAddress: null },
    observations: [],
  };
}

function watchWithTelegram(repository, addresses, chatId) {
  const watch = repository.createWatch({
    managementTokenHash: `hash-${chatId}`,
    network: 'mainnet',
    addresses,
    now: 1,
  });
  repository.upsertEndpoint({
    watchId: watch.id,
    kind: 'telegram',
    destination: String(chatId),
    now: 1,
  });
  return repository.getWatch(watch.id);
}

test('outbox claims one delivery per endpoint per wave, most severe first', (t) => {
  const repository = new CaseRepository(':memory:');
  t.after(() => repository.close());
  watchWithTelegram(repository, [SEQUENCER_A], 100);

  assert.equal(repository.enqueueTransition(
    transitionFor(SEQUENCER_A, { id: 'info-first', severity: 'info', at: 1_000 }),
    caseFor(SEQUENCER_A),
  ), 1);
  assert.equal(repository.enqueueTransition(
    transitionFor(SEQUENCER_A, { id: 'critical-later', severity: 'critical', at: 2_000 }),
    caseFor(SEQUENCER_A),
  ), 1);

  const firstWave = repository.claimDeliveries({ now: 10_000 });
  assert.equal(firstWave.length, 1);
  assert.equal(firstWave[0].event.severity, 'critical');

  // The endpoint has an active lease, so nothing else can be claimed yet.
  assert.equal(repository.claimDeliveries({ now: 10_001 }).length, 0);

  assert.equal(repository.completeDelivery(firstWave[0].id, 'message-1', 10_002), true);
  const secondWave = repository.claimDeliveries({ now: 10_003 });
  assert.equal(secondWave.length, 1);
  assert.equal(secondWave[0].event.severity, 'info');
});

test('outbox recovers an expired lease instead of stranding the delivery', (t) => {
  const repository = new CaseRepository(':memory:');
  t.after(() => repository.close());
  watchWithTelegram(repository, [SEQUENCER_A], 100);
  repository.enqueueTransition(transitionFor(SEQUENCER_A), caseFor(SEQUENCER_A));

  const [claimed] = repository.claimDeliveries({ now: 10_000, leaseMs: 100 });
  assert.ok(claimed);
  assert.equal(claimed.attempts, 1);

  // Before the lease expires the row stays owned by the crashed worker.
  assert.equal(repository.claimDeliveries({ now: 10_050, leaseMs: 100 }).length, 0);

  const [recovered] = repository.claimDeliveries({ now: 10_200, leaseMs: 100 });
  assert.ok(recovered);
  assert.equal(recovered.id, claimed.id);
  assert.equal(recovered.attempts, 2);
});

test('a permanent failure disables the endpoint and cancels its backlog', (t) => {
  const repository = new CaseRepository(':memory:');
  t.after(() => repository.close());
  const watch = watchWithTelegram(repository, [SEQUENCER_A], 100);

  repository.enqueueTransition(
    transitionFor(SEQUENCER_A, { id: 'first' }),
    caseFor(SEQUENCER_A),
  );
  repository.enqueueTransition(
    transitionFor(SEQUENCER_A, { id: 'second', at: 2_000 }),
    caseFor(SEQUENCER_A),
  );

  const [claimed] = repository.claimDeliveries({ now: 10_000 });
  assert.equal(repository.failDeliveryAndDisableEndpoint(
    claimed.id,
    claimed.endpointId,
    'subscription expired',
    10_001,
  ), true);

  assert.equal(repository.claimDeliveries({ now: 10_002 }).length, 0);
  const endpoint = repository.getWatch(watch.id).endpoints
    .find((item) => item.kind === 'telegram');
  assert.equal(endpoint.enabled, false);
});

test('editing watch addresses cancels queued case alerts for removed sequencers', (t) => {
  const repository = new CaseRepository(':memory:');
  t.after(() => repository.close());
  const watch = watchWithTelegram(repository, [SEQUENCER_A, SEQUENCER_B], 100);

  repository.enqueueTransition(transitionFor(SEQUENCER_A), caseFor(SEQUENCER_A));
  repository.enqueueTransition(transitionFor(SEQUENCER_B), caseFor(SEQUENCER_B));

  const updated = repository.updateWatch(watch.id, {
    addresses: [SEQUENCER_B],
    now: 5_000,
  });
  assert.deepEqual(updated.addresses, [SEQUENCER_B]);

  const claimed = repository.claimDeliveries({ now: 10_000 });
  assert.equal(claimed.length, 1);
  assert.deepEqual(claimed[0].event.targets, [SEQUENCER_B]);
});
