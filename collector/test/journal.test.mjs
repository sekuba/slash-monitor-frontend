import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTIFICATION_TEST_COOLDOWN_MS,
  NotificationTestCooldownError,
  NotificationRateLimitError,
  OffenseRepository,
} from '../src/database.mjs';
import { OFFENSE_A, OFFENSE_B, SEQUENCER_A, SEQUENCER_B } from './helpers.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';

const WATCHLIST_ID = '11111111-1111-4111-8111-111111111111';

test('pending offense transitions and matching delivery fanout are atomic and deduplicated', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 10,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'telegram',
      destination: '9007199254740991',
      now: 20,
    });
    const [offense] = parseOffenseSnapshot([OFFENSE_A]);

    repository.recordSuccessfulPoll([offense], { observedAt: 100, network: 'mainnet' });
    repository.recordSuccessfulPoll([offense], { observedAt: 200, network: 'mainnet' });
    repository.recordSuccessfulPoll([{ ...offense, amount: '3000' }], { observedAt: 300, network: 'mainnet' });
    const removal = repository.recordSuccessfulPoll([], {
      observedAt: 400,
      network: 'mainnet',
      withdrawAfterMissedPolls: 1,
      absenceEvidence: {
        epoch: { advanced: true, value: '43' },
        slot: { advanced: true, value: '9002' },
      },
    });
    assert.equal(removal.withdrawn, 1);
    assert.equal(removal.events, 0);
    repository.recordSuccessfulPoll([offense], { observedAt: 500, network: 'mainnet' });

    const events = repository.listEvents({ network: 'mainnet', limit: 20 }).data.reverse();
    assert.deepEqual(
      events.map((event) => event.type),
      [
        'pending_offense_detected',
        'pending_offense_updated',
        'pending_offense_reactivated',
      ],
    );
    assert.deepEqual(events[0].data, {
      offenseId: offense.id,
      sequencer: offense.sequencer,
      amount: offense.amount,
      offenseType: 3,
      offenseTypeName: 'inactivity',
      epochOrSlot: '42',
      timeUnit: 'epoch',
      certainty: 'pending',
    });
    assert.deepEqual(events.map((event) => event.title), [
      'Inactivity offense detected',
      'Inactivity offense changed',
      'Inactivity offense returned',
    ]);
    assert.equal(repository.getDeliveryCounts().pending, 3);
    const deliveries = [];
    while (deliveries.length < 3) {
      const [delivery] = repository.claimDeliveries({ now: 1_000, limit: 20, leaseMs: 100 });
      assert.ok(delivery);
      deliveries.push(delivery);
      repository.completeDelivery(delivery.id, null, 1_000);
    }
    assert.equal(deliveries.length, 3);
    assert.equal(new Set(deliveries.map((delivery) => delivery.event.id)).size, 3);
    assert.equal(deliveries.every((delivery) => delivery.destination === '9007199254740991'), true);
  } finally {
    repository.close();
  }
});

test('pending offenses connect their epoch or slot to offense and proposal rounds when L1 context is ready', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.recordSourceSuccess('l1', {
      epochDuration: '32',
      stacks: [{
        role: 'active',
        parameters: {
          roundSize: '128',
          slashOffsetInRounds: '2',
        },
      }],
    }, 10);
    const [epochOffense] = parseOffenseSnapshot([OFFENSE_A]);
    const [slotOffense] = parseOffenseSnapshot([OFFENSE_B]);

    repository.recordSuccessfulPoll([epochOffense, slotOffense], {
      observedAt: 20,
      network: 'mainnet',
    });

    const events = repository.listEvents({ network: 'mainnet', limit: 10 }).data;
    const epochEvent = events.find((event) => event.data.offenseId === epochOffense.id);
    const slotEvent = events.find((event) => event.data.offenseId === slotOffense.id);
    assert.deepEqual({
      epoch: epochEvent.data.epoch,
      slot: epochEvent.data.slot,
      offenseRound: epochEvent.data.offenseRound,
      proposalRound: epochEvent.data.proposalRound,
    }, {
      epoch: '42',
      slot: '1344',
      offenseRound: '10',
      proposalRound: '12',
    });
    assert.deepEqual({
      epoch: slotEvent.data.epoch,
      slot: slotEvent.data.slot,
      offenseRound: slotEvent.data.offenseRound,
      proposalRound: slotEvent.data.proposalRound,
    }, {
      epoch: '281',
      slot: '9001',
      offenseRound: '70',
      proposalRound: '72',
    });
  } finally {
    repository.close();
  }
});

test('expired outbox leases are recovered on a later claim without restarting the worker', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'telegram',
      destination: '42',
      now: 2,
    });
    const [offense] = parseOffenseSnapshot([OFFENSE_A]);
    repository.recordSuccessfulPoll([offense], { observedAt: 10, network: 'mainnet' });

    const [firstClaim] = repository.claimDeliveries({ now: 100, limit: 10, leaseMs: 50 });
    assert.equal(firstClaim.attempts, 1);
    assert.deepEqual(repository.claimDeliveries({ now: 149, limit: 10, leaseMs: 50 }), []);

    const [recovered] = repository.claimDeliveries({ now: 150, limit: 10, leaseMs: 50 });
    assert.equal(recovered.id, firstClaim.id);
    assert.equal(recovered.attempts, 2);
    assert.equal(repository.releaseDelivery(recovered.id, 151), true);
    assert.equal(repository.isDeliverySendable(recovered.id), false);
    const [reclaimed] = repository.claimDeliveries({ now: 151, limit: 10, leaseMs: 50 });
    assert.equal(reclaimed.id, firstClaim.id);
    assert.equal(reclaimed.attempts, 2);
    assert.deepEqual(repository.getDeliveryCounts(), {
      pending: 0,
      sending: 1,
      retry: 0,
      sent: 0,
      failed: 0,
    });
  } finally {
    repository.close();
  }
});

test('outbox claims prioritize severity and select at most one delivery per endpoint', () => {
  const repository = new OffenseRepository(':memory:');
  const otherWatchlistId = '22222222-2222-4222-8222-222222222222';
  try {
    for (const [id, destination, sequencer] of [
      [WATCHLIST_ID, '42', SEQUENCER_A],
      [otherWatchlistId, '43', SEQUENCER_B],
    ]) {
      repository.createWatchlist({
        id,
        managementTokenHash: 'a'.repeat(64),
        network: 'mainnet',
        addresses: [sequencer],
        now: 1,
      });
      repository.upsertEndpoint({ watchlistId: id, kind: 'telegram', destination, now: 2 });
    }

    const record = (id, severity, observedAt, target) => repository.recordEvent({
      id,
      network: 'mainnet',
      source: 'l1',
      type: `claim_${severity}`,
      severity,
      title: severity,
      body: severity,
      data: {},
      observedAt,
    }, [target]);
    record('old-info-a', 'info', 10, SEQUENCER_A);
    record('warning-b', 'warning', 20, SEQUENCER_B);
    record('new-critical-a', 'critical', 30, SEQUENCER_A);

    const first = repository.claimDeliveries({ now: 100, limit: 10, leaseMs: 1_000 });
    assert.deepEqual(first.map((delivery) => delivery.event.id), ['new-critical-a', 'warning-b']);
    assert.equal(new Set(first.map((delivery) => delivery.endpointId)).size, 2);

    // A second worker cannot claim another alert for either endpoint while the
    // first pair still has a live sending lease.
    assert.deepEqual(repository.claimDeliveries({ now: 100, limit: 10, leaseMs: 1_000 }), []);

    repository.completeDelivery(first[0].id, null, 101);
    const [next] = repository.claimDeliveries({ now: 101, limit: 10, leaseMs: 1_000 });
    assert.equal(next.event.id, 'old-info-a');
    assert.equal(next.endpointId, first[0].endpointId);
  } finally {
    repository.close();
  }
});

test('rapid address edits still catch up state for the address added by the second edit', () => {
  const repository = new OffenseRepository(':memory:');
  const sequencerC = '0x3333333333333333333333333333333333333333';
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'telegram',
      destination: '42',
      now: 2,
    });
    const [offenseB] = parseOffenseSnapshot([OFFENSE_B]);
    repository.recordSuccessfulPoll([offenseB], { observedAt: 10, network: 'mainnet' });
    assert.equal(repository.getDeliveryCounts().pending, 0);

    repository.updateWatchlist(WATCHLIST_ID, {
      addresses: [SEQUENCER_A, sequencerC],
      now: 6_000,
    });
    repository.updateWatchlist(WATCHLIST_ID, {
      addresses: [SEQUENCER_A, SEQUENCER_B, sequencerC],
      now: 6_001,
    });

    const [delivery] = repository.claimDeliveries({ now: 6_001 });
    assert.ok(delivery);
    assert.equal(delivery.event.source, 'catchup');
    assert.equal(delivery.event.data.sequencer, SEQUENCER_B);
    assert.deepEqual(repository.claimDeliveries({ now: 6_001 }), []);
  } finally {
    repository.close();
  }
});

test('a permanent endpoint failure invalidates its remaining queued work', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    const [offense] = parseOffenseSnapshot([OFFENSE_A]);
    repository.recordSuccessfulPoll([offense], { observedAt: 10, network: 'mainnet' });
    repository.recordSuccessfulPoll([{ ...offense, amount: '3000' }], {
      observedAt: 20,
      network: 'mainnet',
    });
    const claimed = repository.claimDeliveries({ now: 30, limit: 10 });
    assert.equal(claimed.length, 1);

    repository.failDeliveryAndDisableEndpoint(claimed[0].id, claimed[0].endpointId, 'gone', 40);
    assert.equal(repository.getWatchlist(WATCHLIST_ID).endpoints[0].enabled, false);
    assert.deepEqual(repository.getDeliveryCounts(), {
      pending: 0,
      sending: 0,
      retry: 0,
      sent: 0,
      failed: 2,
    });
    assert.deepEqual(repository.claimDeliveries({ now: 50 }), []);
  } finally {
    repository.close();
  }
});

test('a channel auth failure stays retryable and marks Telegram unhealthy without disabling its endpoint', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    const [offense] = parseOffenseSnapshot([OFFENSE_A]);
    repository.recordSuccessfulPoll([offense], { observedAt: 10, network: 'mainnet' });
    const [claimed] = repository.claimDeliveries({ now: 20, limit: 1 });

    assert.equal(repository.retryDeliveryForChannelFailure(
      claimed.id,
      'telegram',
      'Telegram sendMessage returned error 401',
      500,
      30,
    ), true);
    assert.equal(repository.getWatchlist(WATCHLIST_ID).endpoints[0].enabled, true);
    assert.deepEqual(repository.getDeliveryCounts(), {
      pending: 0,
      sending: 0,
      retry: 1,
      sent: 0,
      failed: 0,
    });
    assert.deepEqual(repository.claimDeliveries({ now: 499 }), []);
    assert.equal(repository.claimDeliveries({ now: 500, limit: 1 })[0].id, claimed.id);
    const telegram = repository.getSourceState('telegram');
    assert.equal(telegram.consecutiveFailures, 1);
    assert.equal(telegram.lastAttemptAt, 30);
    assert.equal(telegram.lastError, 'Telegram sendMessage returned error 401');
  } finally {
    repository.close();
  }
});

test('notification tests without an active channel do not leave orphan events', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    assert.equal(repository.enqueueWatchlistTest(WATCHLIST_ID, {
      id: 'test-no-channel',
      network: 'mainnet',
      source: 'test',
      type: 'notification_test',
      severity: 'info',
      title: 'test',
      body: 'test',
      data: {},
    }, 2), 0);
    assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, 0);
  } finally {
    repository.close();
  }
});

test('notification tests have an atomic per-watchlist cooldown', () => {
  const repository = new OffenseRepository(':memory:');
  const otherWatchlistId = '22222222-2222-4222-8222-222222222222';
  try {
    for (const [id, destination] of [[WATCHLIST_ID, '42'], [otherWatchlistId, '43']]) {
      repository.createWatchlist({
        id,
        managementTokenHash: 'a'.repeat(64),
        network: 'mainnet',
        addresses: [SEQUENCER_A],
        now: 1,
      });
      repository.upsertEndpoint({ watchlistId: id, kind: 'telegram', destination, now: 2 });
    }

    assert.equal(repository.enqueueWatchlistTest(
      WATCHLIST_ID,
      notificationTestEvent('test-first'),
      100,
    ), 1);
    assert.throws(
      () => repository.enqueueWatchlistTest(
        WATCHLIST_ID,
        notificationTestEvent('test-blocked'),
        100 + NOTIFICATION_TEST_COOLDOWN_MS - 1,
      ),
      (error) => {
        assert.equal(error instanceof NotificationTestCooldownError, true);
        assert.equal(error.retryAfterMs, 1);
        return true;
      },
    );
    assert.equal(repository.db.prepare("SELECT COUNT(*) AS count FROM events WHERE source = 'test'").get().count, 1);
    assert.equal(repository.getDeliveryCounts().pending, 1);

    // Another watchlist has its own slot, and the boundary is inclusive.
    assert.equal(repository.enqueueWatchlistTest(
      otherWatchlistId,
      notificationTestEvent('test-other'),
      100,
    ), 1);
    assert.equal(repository.enqueueWatchlistTest(
      WATCHLIST_ID,
      notificationTestEvent('test-after-cooldown'),
      100 + NOTIFICATION_TEST_COOLDOWN_MS,
    ), 1);
  } finally {
    repository.close();
  }
});

test('durable admission budgets bound Web Push rotation and notification tests', () => {
  const repository = new OffenseRepository(':memory:');
  const otherWatchlistId = '22222222-2222-4222-8222-222222222222';
  try {
    for (const [id, destination] of [[WATCHLIST_ID, '42'], [otherWatchlistId, '43']]) {
      repository.createWatchlist({
        id,
        managementTokenHash: 'a'.repeat(64),
        network: 'mainnet',
        addresses: [SEQUENCER_A],
        now: 1,
      });
      repository.upsertEndpoint({ watchlistId: id, kind: 'telegram', destination, now: 2 });
    }

    const pushLimits = {
      maxPerHourPerWatchlist: 2,
      maxPerDayPerWatchlist: 10,
      maxPerHourGlobal: 10,
      maxPerDayGlobal: 10,
    };
    for (const [index, destination] of ['push-one', 'push-two'].entries()) {
      assert.equal(repository.upsertEndpoint({
        watchlistId: WATCHLIST_ID,
        kind: 'web_push',
        destination,
        now: 100 + index,
        admissionLimits: pushLimits,
      }).verificationQueued, 1);
    }
    assert.throws(
      () => repository.upsertEndpoint({
        watchlistId: WATCHLIST_ID,
        kind: 'web_push',
        destination: 'push-three',
        now: 102,
        admissionLimits: pushLimits,
      }),
      (error) => {
        assert.equal(error instanceof NotificationRateLimitError, true);
        assert.equal(error.code, 'web_push_enrollment_rate_limited');
        return true;
      },
    );
    assert.equal(repository.db.prepare(`
      SELECT COUNT(*) AS count FROM events
      WHERE source = 'test' AND type = 'notification_channel_verification'
    `).get().count, 2);
    assert.equal(repository.db.prepare(`
      SELECT COUNT(*) AS count FROM delivery_endpoints WHERE kind = 'web_push'
    `).get().count, 1);

    const testLimits = { maxPerHourGlobal: 1, maxPerDayGlobal: 10 };
    assert.equal(repository.enqueueWatchlistTest(
      WATCHLIST_ID,
      notificationTestEvent('budget-test-one'),
      200,
      { cooldownMs: 1, admissionLimits: testLimits },
    ), 2);
    assert.throws(
      () => repository.enqueueWatchlistTest(
        otherWatchlistId,
        notificationTestEvent('budget-test-two'),
        201,
        { cooldownMs: 1, admissionLimits: testLimits },
      ),
      (error) => {
        assert.equal(error instanceof NotificationRateLimitError, true);
        assert.equal(error.code, 'notification_test_capacity_limited');
        return true;
      },
    );
  } finally {
    repository.close();
  }
});

test('global watch-list admission survives deletion of the admitted watch list', () => {
  const repository = new OffenseRepository(':memory:');
  const limits = { maxPerHourGlobal: 1, maxPerDayGlobal: 10 };
  try {
    assert.ok(repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 100,
      admissionLimits: limits,
    }));
    assert.equal(repository.deleteWatchlist(WATCHLIST_ID), true);
    assert.throws(
      () => repository.createWatchlist({
        id: '22222222-2222-4222-8222-222222222222',
        managementTokenHash: 'b'.repeat(64),
        network: 'mainnet',
        addresses: [SEQUENCER_A],
        now: 101,
        admissionLimits: limits,
      }),
      (error) => {
        assert.equal(error instanceof NotificationRateLimitError, true);
        assert.equal(error.code, 'subscription_capacity_limited');
        return true;
      },
    );
  } finally {
    repository.close();
  }
});

test('retrying a failed Web Push verification consumes the enrollment budget', () => {
  const repository = new OffenseRepository(':memory:');
  const limits = {
    maxPerHourPerWatchlist: 1,
    maxPerDayPerWatchlist: 10,
    maxPerHourGlobal: 10,
    maxPerDayGlobal: 10,
  };
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'failed-push',
      now: 100,
      admissionLimits: limits,
    });
    const [verification] = repository.claimDeliveries({ now: 100 });
    assert.ok(verification);
    repository.failDeliveryAndDisableEndpoint(
      verification.id,
      verification.endpointId,
      'Web Push returned HTTP 410',
      101,
    );

    assert.throws(
      () => repository.upsertEndpoint({
        watchlistId: WATCHLIST_ID,
        kind: 'web_push',
        destination: 'failed-push',
        now: 102,
        admissionLimits: limits,
      }),
      (error) => {
        assert.equal(error instanceof NotificationRateLimitError, true);
        assert.equal(error.code, 'web_push_enrollment_rate_limited');
        return true;
      },
    );
  } finally {
    repository.close();
  }
});

test('notification maintenance bounds journals without deleting live delivery work', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    repository.enqueueWatchlistTest(WATCHLIST_ID, notificationTestEvent('old-test'), 100);
    repository.recordEvent({
      ...notificationTestEvent('old-real-terminal'),
      source: 'aztec_node',
      type: 'pending_offense_detected',
    }, [SEQUENCER_A]);
    repository.recordEvent({
      ...notificationTestEvent('old-real-pending'),
      source: 'aztec_node',
      type: 'pending_offense_updated',
    }, [SEQUENCER_A]);
    repository.recordEvent({
      ...notificationTestEvent('old-catchup'),
      source: 'catchup',
      type: 'pending_offense_detected',
      data: { certainty: 'pending', originSource: 'aztec_node', catchup: true },
    }, [SEQUENCER_A]);

    const claimed = [];
    while (true) {
      const [delivery] = repository.claimDeliveries({ now: 200, limit: 10 });
      if (!delivery) break;
      claimed.push(delivery);
      if (delivery.event.id === 'old-real-pending') repository.releaseDelivery(delivery.id, 201);
      else repository.completeDelivery(delivery.id, null, 200);
    }
    assert.equal(claimed.length, 4);

    repository.createTelegramLink({
      tokenHash: 'b'.repeat(64),
      watchlistId: WATCHLIST_ID,
      expiresAt: 2_000,
      now: 100,
    });
    repository.consumeTelegramLink('b'.repeat(64), '42', 200);
    repository.createTelegramLink({
      tokenHash: 'c'.repeat(64),
      watchlistId: WATCHLIST_ID,
      expiresAt: 300,
      now: 100,
    });
    repository.createTelegramLink({
      tokenHash: 'd'.repeat(64),
      watchlistId: WATCHLIST_ID,
      expiresAt: 950,
      now: 900,
    });
    repository.createTelegramLink({
      tokenHash: 'e'.repeat(64),
      watchlistId: WATCHLIST_ID,
      expiresAt: 2_000,
      now: 900,
    });
    const abandonedWatchlistId = '33333333-3333-4333-8333-333333333333';
    repository.createWatchlist({
      id: abandonedWatchlistId,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_B],
      now: 100,
    });

    const result = repository.pruneNotificationData({
      now: 1_000,
      notificationTestRetentionMs: 500,
      catchupEventRetentionMs: 500,
      terminalDeliveryRetentionMs: 500,
      telegramTokenRetentionMs: 500,
      abandonedWatchlistRetentionMs: 500,
    });
    assert.deepEqual(result, {
      unverifiedEndpoints: 0,
      abandonedWatchlists: 1,
      testEvents: 1,
      catchupEvents: 1,
      terminalDeliveries: 1,
      telegramTokens: 0,
    });
    assert.equal(repository.getWatchlist(abandonedWatchlistId), undefined);
    assert.equal(repository.db.prepare("SELECT COUNT(*) AS count FROM events WHERE source = 'test'").get().count, 0);
    assert.equal(repository.db.prepare("SELECT COUNT(*) AS count FROM events WHERE source = 'catchup'").get().count, 0);
    assert.equal(repository.db.prepare("SELECT COUNT(*) AS count FROM events WHERE source NOT IN ('test', 'catchup')").get().count, 2);
    assert.deepEqual(repository.getDeliveryCounts(), {
      pending: 0,
      sending: 0,
      retry: 1,
      sent: 0,
      failed: 0,
    });
    assert.deepEqual(
      repository.db.prepare('SELECT token_hash AS hash FROM telegram_link_tokens ORDER BY token_hash')
        .all().map((row) => row.hash),
      ['e'.repeat(64)],
    );
  } finally {
    repository.close();
  }
});

test('delivery health degrades for overdue work and recent failures', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    repository.enqueueWatchlistTest(WATCHLIST_ID, notificationTestEvent('health-test'), 100);

    assert.deepEqual(
      repository.getDeliveryHealthStatus({ now: 399, overdueAfterMs: 300 }),
      { status: 'healthy' },
    );
    assert.deepEqual(
      repository.getDeliveryHealthStatus({ now: 400, overdueAfterMs: 300 }),
      { status: 'degraded' },
    );

    const [delivery] = repository.claimDeliveries({ now: 400 });
    repository.failDelivery(delivery.id, 'provider exhausted retries', 401);
    assert.deepEqual(
      repository.getDeliveryHealthStatus({ now: 401, failureWindowMs: 1_000 }),
      { status: 'degraded' },
    );
    assert.deepEqual(
      repository.getDeliveryHealthStatus({ now: 1_402, failureWindowMs: 1_000 }),
      { status: 'healthy' },
    );
  } finally {
    repository.close();
  }
});

test('one dead endpoint does not let a client degrade global delivery health', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'web_push', destination: 'push-42', now: 2 });
    verifyWebPushEndpoint(repository, 50);
    repository.enqueueWatchlistTest(WATCHLIST_ID, notificationTestEvent('permanent-health-test'), 100);
    const [delivery] = repository.claimDeliveries({ now: 400 });

    repository.failDeliveryAndDisableEndpoint(delivery.id, delivery.endpointId, 'Web Push returned HTTP 410', 401);

    assert.equal(repository.getWatchlist(WATCHLIST_ID).endpoints[0].enabled, false);
    assert.deepEqual(
      repository.getDeliveryHealthStatus({ now: 401, failureWindowMs: 1_000 }),
      { status: 'healthy' },
    );
  } finally {
    repository.close();
  }
});

test('reconnecting an endpoint requeues a failed catch-up without duplicating it', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    const [offense] = parseOffenseSnapshot([OFFENSE_A]);
    repository.recordSuccessfulPoll([offense], { observedAt: 10, network: 'mainnet' });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 20 });
    const [delivery] = repository.claimDeliveries({ now: 30 });
    assert.equal(delivery.event.source, 'catchup');
    assert.equal(repository.getEvent(delivery.event.id).certainty, 'pending');
    assert.deepEqual(
      repository.listEvents({ network: 'mainnet', addresses: [SEQUENCER_A] }).data.map((event) => event.source),
      ['aztec_node'],
    );
    repository.failDelivery(delivery.id, 'temporary exhaustion', 40);
    assert.equal(repository.getDeliveryCounts().failed, 1);

    const reconnect = repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'telegram',
      destination: '42',
      now: 5_100,
    });
    assert.equal(reconnect.catchupQueued, 1);
    assert.deepEqual(repository.getDeliveryCounts(), {
      pending: 1,
      sending: 0,
      retry: 0,
      sent: 0,
      failed: 0,
    });
  } finally {
    repository.close();
  }
});

test('rotating a Web Push destination replaces the stale same-kind endpoint', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    const [offense] = parseOffenseSnapshot([OFFENSE_A]);
    repository.recordSuccessfulPoll([offense], { observedAt: 10, network: 'mainnet' });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/old',
      configJson: '{}',
      now: 20,
    });
    repository.db.prepare(`
      UPDATE delivery_endpoints SET enabled = 0, last_error = 'gone' WHERE watchlist_id = ?
    `).run(WATCHLIST_ID);

    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/new',
      configJson: '{}',
      now: 30,
    });
    verifyWebPushEndpoint(repository, 40);

    assert.deepEqual(
      repository.db.prepare(`
        SELECT destination, enabled FROM delivery_endpoints WHERE watchlist_id = ? AND kind = 'web_push'
      `).all(WATCHLIST_ID).map((row) => ({ ...row })),
      [{ destination: 'https://fcm.googleapis.com/fcm/send/new', enabled: 1 }],
    );
    assert.equal(repository.getWatchlist(WATCHLIST_ID).endpoints.length, 1);
    assert.deepEqual(repository.getDeliveryCounts(), {
      pending: 1,
      sending: 0,
      retry: 0,
      sent: 1,
      failed: 0,
    });
  } finally {
    repository.close();
  }
});

test('rotating an active endpoint preserves nonterminal incidents that are no longer current state', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/old-live',
      configJson: '{}',
      now: 2,
    });
    repository.recordEvent({
      ...notificationTestEvent('resolved-but-unsent-critical'),
      source: 'ethereum_l1',
      type: 'onchain_executed',
      severity: 'critical',
    }, [SEQUENCER_A]);

    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/new-live',
      configJson: '{}',
      now: 3,
    });

    assert.equal(repository.getDeliveryCounts().pending, 2);
    verifyWebPushEndpoint(repository, 200);
    const [delivery] = repository.claimDeliveries({ now: 201 });
    assert.equal(delivery.event.id, 'resolved-but-unsent-critical');
    assert.equal(delivery.destination, 'https://fcm.googleapis.com/fcm/send/new-live');
  } finally {
    repository.close();
  }
});

test('rotating a failed Push endpoint recovers a recent one-shot slash exactly once', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/failed-old',
      configJson: '{}',
      now: 2,
    });
    verifyWebPushEndpoint(repository, 10);
    repository.recordEvent({
      id: 'confirmed-slash-before-push-rotation',
      network: 'mainnet',
      source: 'ethereum_l1',
      type: 'l1_slash_confirmed',
      severity: 'critical',
      title: 'Slash confirmed',
      body: 'A watched sequencer was slashed.',
      data: {},
      observedAt: 100,
    }, [SEQUENCER_A]);
    const [failed] = repository.claimDeliveries({ now: 101 });
    assert.equal(failed.event.id, 'confirmed-slash-before-push-rotation');
    assert.equal(repository.failDeliveryAndDisableEndpoint(
      failed.id,
      failed.endpointId,
      'Web Push returned HTTP 410',
      102,
    ), true);

    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/replacement',
      configJson: '{}',
      now: 103,
    });
    verifyWebPushEndpoint(repository, 104);

    const [recovered] = repository.claimDeliveries({ now: 105 });
    assert.equal(recovered.event.id, 'confirmed-slash-before-push-rotation');
    assert.equal(recovered.destination, 'https://fcm.googleapis.com/fcm/send/replacement');
    assert.equal(repository.completeDelivery(recovered.id, 'provider-id', 106), true);
    assert.deepEqual(repository.claimDeliveries({ now: 107 }), []);
  } finally {
    repository.close();
  }
});

test('rotating a failed Push endpoint never resurrects a slash log reorged out meanwhile', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/reorged-old',
      configJson: '{}',
      now: 2,
    });
    verifyWebPushEndpoint(repository, 10);
    const slash = slashLog({ block: 99, sequencer: SEQUENCER_A });
    repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 95,
      to: 100,
      confirmed: 100,
      logs: [slash],
    }), { observedAt: 100 });
    const [failed] = repository.claimDeliveries({ now: 101 });
    assert.equal(failed.event.type, 'l1_slash_confirmed');
    assert.equal(repository.failDeliveryAndDisableEndpoint(
      failed.id,
      failed.endpointId,
      'Web Push returned HTTP 410',
      102,
    ), true);
    repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 95,
      to: 100,
      confirmed: 100,
      logs: [],
      reorgDetected: true,
    }), { observedAt: 103 });

    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/reorged-replacement',
      configJson: '{}',
      now: 104,
    });
    verifyWebPushEndpoint(repository, 105);

    assert.deepEqual(repository.claimDeliveries({ now: 106 }), []);
    assert.equal(repository.getEvent(failed.event.id).data.canonical, false);
  } finally {
    repository.close();
  }
});

test('rotating a failed Push endpoint does not replay a superseded L1 round view', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/snapshot-old',
      configJson: '{}',
      now: 2,
    });
    verifyWebPushEndpoint(repository, 10);
    const round = {
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      ...round,
      status: 'executed',
      isExecuted: true,
    }), { observedAt: 100 });
    const [failed] = repository.claimDeliveries({ now: 101 });
    assert.equal(failed.event.type, 'onchain_executed');
    assert.equal(repository.failDeliveryAndDisableEndpoint(
      failed.id,
      failed.endpointId,
      'Web Push returned HTTP 410',
      102,
    ), true);
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      ...round,
      status: 'quorum-reached',
      reorgDetected: true,
    }), { observedAt: 103 });

    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/snapshot-replacement',
      configJson: '{}',
      now: 104,
    });
    verifyWebPushEndpoint(repository, 105);

    const [current] = repository.claimDeliveries({ now: 106 });
    assert.equal(current.event.source, 'catchup');
    assert.notEqual(current.event.type, 'onchain_executed');
    assert.deepEqual(repository.claimDeliveries({ now: 106 }), []);
  } finally {
    repository.close();
  }
});

test('an endpoint cannot be rebound across watchlists without channel-specific proof', () => {
  const repository = new OffenseRepository(':memory:');
  const otherWatchlistId = '22222222-2222-4222-8222-222222222222';
  try {
    for (const [id, address] of [[WATCHLIST_ID, SEQUENCER_A], [otherWatchlistId, SEQUENCER_B]]) {
      repository.createWatchlist({
        id,
        managementTokenHash: 'a'.repeat(64),
        network: 'mainnet',
        addresses: [address],
        now: 1,
      });
    }
    const destination = 'https://fcm.googleapis.com/fcm/send/owned';
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination,
      configJson: '{}',
      now: 2,
    });
    verifyWebPushEndpoint(repository, 4);
    repository.recordEvent({
      ...notificationTestEvent('owner-pending'),
      source: 'ethereum_l1',
      type: 'onchain_targeted',
    }, [SEQUENCER_A]);

    const conflict = repository.upsertEndpoint({
      watchlistId: otherWatchlistId,
      kind: 'web_push',
      destination,
      configJson: '{}',
      now: 3,
    });

    assert.deepEqual(conflict, { conflict: true, kind: 'web_push' });
    assert.equal(repository.getWatchlist(WATCHLIST_ID).endpoints.length, 1);
    assert.equal(repository.getWatchlist(otherWatchlistId).endpoints.length, 0);
    const [delivery] = repository.claimDeliveries({ now: 200 });
    assert.equal(delivery.event.id, 'owner-pending');
    assert.equal(delivery.destination, destination);
  } finally {
    repository.close();
  }
});

test('Telegram deep links are hashed, expiring, single-use, and idempotent for the linked chat', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'b'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A, SEQUENCER_B],
      now: 1,
    });
    repository.createTelegramLink({
      tokenHash: 'c'.repeat(64),
      watchlistId: WATCHLIST_ID,
      expiresAt: 100,
      now: 2,
    });
    assert.equal(repository.consumeTelegramLink('c'.repeat(64), '42', 50).id, WATCHLIST_ID);
    assert.equal(repository.consumeTelegramLink('c'.repeat(64), '42', 60).id, WATCHLIST_ID);
    assert.equal(repository.consumeTelegramLink('c'.repeat(64), '43', 60), null);
    assert.equal(repository.getWatchlistByTelegramChat('42').telegramEnabled, true);
    repository.setTelegramEndpointEnabled('42', false, 61);
    assert.equal(repository.consumeTelegramLink('c'.repeat(64), '42', 62).id, WATCHLIST_ID);
    assert.equal(repository.getWatchlistByTelegramChat('42').telegramEnabled, false);
    repository.deleteTelegramEndpoint('42');
    assert.equal(repository.consumeTelegramLink('c'.repeat(64), '42', 63), null);

    repository.createTelegramLink({
      tokenHash: 'd'.repeat(64),
      watchlistId: WATCHLIST_ID,
      expiresAt: 70,
      now: 64,
    });
    assert.equal(repository.consumeTelegramLink('d'.repeat(64), '44', 70), null);
    assert.equal(repository.db.prepare(`
      SELECT token_hash AS hash FROM telegram_link_tokens WHERE token_hash = ?
    `).get('c'.repeat(64)), undefined);
    assert.equal(repository.db.prepare(`
      SELECT token_hash AS hash FROM telegram_link_tokens WHERE token_hash = ?
    `).get('d'.repeat(64)).hash, 'd'.repeat(64));
  } finally {
    repository.close();
  }
});

test('unverified Web Push can receive only its private check before real alerts', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/unverified',
      configJson: '{}',
      now: 2,
    });
    repository.recordEvent({
      ...notificationTestEvent('real-critical-while-verifying'),
      source: 'ethereum_l1',
      type: 'l1_slash_confirmed',
      severity: 'critical',
    }, [SEQUENCER_A]);

    const [check] = repository.claimDeliveries({ now: 100, limit: 10 });
    assert.equal(check.event.type, 'notification_channel_verification');
    assert.equal(repository.claimDeliveries({ now: 100, limit: 10 }).length, 0);
    repository.completeDelivery(check.id, 'provider-check', 101);

    const [incident] = repository.claimDeliveries({ now: 102, limit: 10 });
    assert.equal(incident.event.id, 'real-critical-while-verifying');
    assert.equal(repository.getWatchlist(WATCHLIST_ID).endpoints[0].verified, true);
  } finally {
    repository.close();
  }
});

test('anonymous endpoint caps and unverified retention bound fake Push fanout', () => {
  const secondWatchlistId = '22222222-2222-4222-8222-222222222222';
  const repository = new OffenseRepository(':memory:', { maxUnverifiedEndpoints: 1 });
  try {
    for (const id of [WATCHLIST_ID, secondWatchlistId]) {
      repository.createWatchlist({
        id,
        managementTokenHash: 'a'.repeat(64),
        network: 'mainnet',
        addresses: [SEQUENCER_A],
        now: 1,
      });
    }
    assert.equal(repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/cap-one',
      configJson: '{}',
      now: 2,
    }).capacity, undefined);
    assert.deepEqual(repository.upsertEndpoint({
      watchlistId: secondWatchlistId,
      kind: 'web_push',
      destination: 'https://fcm.googleapis.com/fcm/send/cap-two',
      configJson: '{}',
      now: 3,
    }), { capacity: true, kind: 'web_push' });

    const firstPrune = repository.pruneNotificationData({
      now: 100,
      unverifiedEndpointRetentionMs: 50,
      abandonedWatchlistRetentionMs: 500,
      notificationTestRetentionMs: 10_000,
    });
    assert.equal(firstPrune.unverifiedEndpoints, 1);
    assert.ok(repository.getWatchlist(WATCHLIST_ID), 'endpoint removal starts a fresh disconnect grace');
    assert.equal(repository.getWatchlist(WATCHLIST_ID).endpoints.length, 0);

    repository.pruneNotificationData({
      now: 601,
      unverifiedEndpointRetentionMs: 50,
      abandonedWatchlistRetentionMs: 500,
      notificationTestRetentionMs: 10_000,
    });
    assert.equal(repository.getWatchlist(WATCHLIST_ID), undefined);
  } finally {
    repository.close();
  }
});

test('Telegram capacity failure leaves the one-time link unconsumed and never claims success', () => {
  const secondWatchlistId = '22222222-2222-4222-8222-222222222222';
  const repository = new OffenseRepository(':memory:', { maxDeliveryEndpoints: 1 });
  try {
    for (const id of [WATCHLIST_ID, secondWatchlistId]) {
      repository.createWatchlist({
        id,
        managementTokenHash: 'a'.repeat(64),
        network: 'mainnet',
        addresses: [SEQUENCER_A],
        now: 1,
      });
    }
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'telegram',
      destination: '41',
      now: 2,
    });
    repository.createTelegramLink({
      tokenHash: 'f'.repeat(64),
      watchlistId: secondWatchlistId,
      expiresAt: 1_000,
      now: 3,
    });

    assert.equal(repository.consumeTelegramLink('f'.repeat(64), '42', 4), null);
    const token = repository.db.prepare(`
      SELECT consumed_at AS consumedAt FROM telegram_link_tokens WHERE token_hash = ?
    `).get('f'.repeat(64));
    assert.equal(token.consumedAt, null);
    assert.equal(repository.getWatchlistByTelegramChat('42'), null);
  } finally {
    repository.close();
  }
});

test('disconnect grace starts when the last channel is removed, not when an old watchlist was born', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'a'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({
      watchlistId: WATCHLIST_ID,
      kind: 'telegram',
      destination: '42',
      now: 2,
    });
    repository.deleteTelegramEndpoint('42', 10_000);

    repository.pruneNotificationData({ now: 10_010, abandonedWatchlistRetentionMs: 50 });
    assert.ok(repository.getWatchlist(WATCHLIST_ID));
    repository.pruneNotificationData({ now: 10_051, abandonedWatchlistRetentionMs: 50 });
    assert.equal(repository.getWatchlist(WATCHLIST_ID), undefined);
  } finally {
    repository.close();
  }
});

test('L1 snapshots alert on the first address-level vote, quorum, execution window, veto, and execution', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'e'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });

    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      earlyTargets: [earlyTarget(SEQUENCER_A, 1)],
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      earlyTargets: [earlyTarget(SEQUENCER_A, 2)],
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'quorum-reached',
    }), { observedAt: 200 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 102,
      earlyTargets: [earlyTarget(SEQUENCER_A, 2)],
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'newly-executable',
    }), { observedAt: 300 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 103,
      earlyTargets: [earlyTarget(SEQUENCER_A, 2)],
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'newly-executable',
      isVetoed: true,
    }), { observedAt: 400 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 104,
      earlyTargets: [earlyTarget(SEQUENCER_A, 2)],
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'executed',
      isVetoed: true,
      isExecuted: true,
    }), { observedAt: 500 });

    assert.deepEqual(
      repository.listEvents({ network: 'mainnet', limit: 20 }).data
        .filter((event) => event.source === 'ethereum_l1')
        .map((event) => event.type)
        .reverse(),
      [
        'onchain_vote_targeted',
        'onchain_targeted',
        'onchain_executable',
        'onchain_vetoed',
        'onchain_executed',
      ],
    );
    assert.equal(repository.getDeliveryCounts().pending, 5);
    assert.equal(repository.getSourceState('l1').lastBlockNumber, '104');
  } finally {
    repository.close();
  }
});

test('L1 payload events count only tally actions and expose epoch, slot, and UTC execution timing', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      earlyTargets: [earlyTarget(SEQUENCER_A, 100), earlyTarget(SEQUENCER_B, 1)],
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'quorum-reached',
      targetEpochs: ['38', '39'],
      executableSlot: '1100',
      expirySlot: '1200',
    }), { observedAt: 100 });

    const event = repository.listEvents({ network: 'mainnet' }).data
      .find((candidate) => candidate.type === 'onchain_targeted');
    assert.ok(event);
    assert.deepEqual(event.targets, [SEQUENCER_A]);
    assert.match(event.body, /1 sequencer/i);
    assert.doesNotMatch(event.body, /2 sequencers/i);
    assert.deepEqual({
      targetEpochs: event.data.targetEpochs,
      currentEpoch: event.data.currentEpoch,
      currentSlot: event.data.currentSlot,
      executableSlot: event.data.executableSlot,
      executableAt: event.data.executableAt,
      expirySlot: event.data.expirySlot,
      expiryAt: event.data.expiryAt,
    }, {
      targetEpochs: ['38', '39'],
      currentEpoch: '10',
      currentSlot: '1000',
      executableSlot: '1100',
      executableAt: '1970-01-01T03:41:40.000Z',
      expirySlot: '1200',
      expiryAt: '1970-01-01T04:01:40.000Z',
    });
  } finally {
    repository.close();
  }
});

test('L1 payload changes alert only sequencers whose own slash amount changed', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [
        { sequencer: SEQUENCER_A, amount: '1000' },
        { sequencer: SEQUENCER_B, amount: '1000' },
      ],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      actions: [
        { sequencer: SEQUENCER_A, amount: '1000' },
        { sequencer: SEQUENCER_B, amount: '2000' },
      ],
      payloadAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'quorum-reached',
    }), { observedAt: 200 });

    const changed = repository.listEvents({ network: 'mainnet' }).data
      .find((event) => event.type === 'onchain_payload_changed');
    assert.deepEqual(changed.targets, [SEQUENCER_B]);
    assert.match(changed.body, new RegExp(`${SEQUENCER_B.slice(0, 6)}.*${SEQUENCER_B.slice(-4)}`, 'i'));

    // Action ordering and changes affecting no address must not create another alert.
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 102,
      actions: [
        { sequencer: SEQUENCER_B, amount: '2000' },
        { sequencer: SEQUENCER_A, amount: '1000' },
      ],
      payloadAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
      status: 'quorum-reached',
    }), { observedAt: 300 });

    assert.equal(
      repository.listEvents({ network: 'mainnet' }).data
        .filter((event) => event.type === 'onchain_payload_changed').length,
      1,
    );
  } finally {
    repository.close();
  }
});

test('confirmed Slashed log backfill advances a durable checkpoint and overlap-deduplicates fanout', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'e'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    const slash = slashLog({ block: 95, sequencer: SEQUENCER_A, amount: '1234' });

    const first = repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 90,
      to: 99,
      confirmed: 120,
      logs: [slash],
      initial: true,
      initialBackfill: true,
      hasMore: true,
    }), { observedAt: 100 });
    const overlap = repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 94,
      to: 103,
      confirmed: 120,
      logs: [slash],
      initialBackfill: true,
      hasMore: true,
    }), { observedAt: 200 });
    const stableAcrossReorg = repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 94,
      to: 103,
      confirmed: 120,
      logs: [slash],
      reorgDetected: true,
      hasMore: true,
    }), { observedAt: 300 });

    assert.deepEqual(
      { inserted: first.inserted, queued: first.queued, insertedAgain: overlap.inserted, queuedAgain: overlap.queued },
      { inserted: 1, queued: 1, insertedAgain: 0, queuedAgain: 0 },
    );
    assert.equal(stableAcrossReorg.reconfirmed, 0, 'a stable rewind log is not a restoration');
    assert.equal(stableAcrossReorg.queued, 0);
    assert.equal(repository.getDeliveryCounts().pending, 1);
    const [event] = repository.listEvents({ network: 'mainnet' }).data;
    assert.equal(event.type, 'l1_slash_confirmed');
    assert.equal(event.severity, 'critical');
    assert.deepEqual(event.targets, [SEQUENCER_A]);
    assert.equal(event.data.amount, '1234');
    assert.equal(event.data.backfilled, true);
    const source = repository.getSourceState('l1_slash_logs');
    assert.equal(source.lastBlockNumber, '103');
    assert.equal(source.metadata.lookbackStartBlock, '90');
    assert.equal(source.metadata.initialBackfill, true);
    assert.equal(source.metadata.degraded, true, 'health stays degraded until every backlog chunk is committed');
  } finally {
    repository.close();
  }
});

test('Slashed log reorg invalidates unsent work and queues a target-scoped correction', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'e'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    const slash = slashLog({ block: 99, sequencer: SEQUENCER_A });
    repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 95,
      to: 100,
      confirmed: 100,
      logs: [slash],
    }), { observedAt: 100 });
    const [claimedOriginal] = repository.claimDeliveries({ now: 110, leaseMs: 1_000 });
    assert.equal(claimedOriginal.event.type, 'l1_slash_confirmed');

    const correction = repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 95,
      to: 100,
      confirmed: 100,
      logs: [],
      reorgDetected: true,
    }), { observedAt: 200 });

    assert.equal(correction.corrections, 1);
    assert.deepEqual(repository.getDeliveryCounts(), {
      pending: 1,
      sending: 0,
      retry: 0,
      sent: 0,
      failed: 1,
    });
    assert.equal(repository.completeDelivery(claimedOriginal.id, 'too-late', 210), false);
    const events = repository.listEvents({ network: 'mainnet' }).data;
    const reorged = events.find((event) => event.type === 'l1_slash_reorged');
    const original = events.find((event) => event.type === 'l1_slash_confirmed');
    assert.equal(reorged.severity, 'warning');
    assert.deepEqual(reorged.targets, [SEQUENCER_A]);
    assert.equal(reorged.data.canonical, false);
    assert.equal(original.data.canonical, false);
    assert.equal(repository.db.prepare('SELECT canonical FROM l1_slash_logs').get().canonical, 0);

    const [claimedCorrection] = repository.claimDeliveries({ now: 220, leaseMs: 1_000 });
    assert.equal(claimedCorrection.event.type, 'l1_slash_reorged');
    repository.completeDelivery(claimedCorrection.id, 'correction-0', 221);
    const restored = repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 95,
      to: 100,
      confirmed: 100,
      logs: [slash],
      reorgDetected: true,
    }), { observedAt: 300 });
    assert.equal(restored.reconfirmed, 1);
    assert.equal(restored.queued, 1);
    const [claimedRestoration] = repository.claimDeliveries({ now: 310, leaseMs: 1_000 });
    assert.equal(claimedRestoration.event.type, 'l1_slash_reconfirmed');
    assert.equal(claimedRestoration.event.severity, 'critical');
    assert.deepEqual(repository.getEvent(claimedRestoration.event.id).targets, [SEQUENCER_A]);
    assert.equal(claimedRestoration.event.data.forkGeneration, 1);
    repository.completeDelivery(claimedRestoration.id, 'restoration-1', 311);

    const removedAgain = repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 95,
      to: 100,
      confirmed: 100,
      logs: [],
      reorgDetected: true,
    }), { observedAt: 400 });
    assert.equal(removedAgain.corrections, 1);
    assert.equal(removedAgain.queued, 1);
    const [secondCorrection] = repository.claimDeliveries({ now: 410, leaseMs: 1_000 });
    assert.equal(secondCorrection.event.type, 'l1_slash_reorged');
    assert.equal(secondCorrection.event.data.forkGeneration, 1);
    assert.notEqual(secondCorrection.event.id, claimedCorrection.event.id);
  } finally {
    repository.close();
  }
});

test('L1 execution is not hidden when payload creation and execution happen between scans', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      earlyTargets: [earlyTarget(SEQUENCER_A, 1)],
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      earlyTargets: [earlyTarget(SEQUENCER_A, 2)],
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'executed',
      isExecuted: true,
    }), { observedAt: 200 });

    assert.deepEqual(
      repository.listEvents({ network: 'mainnet' }).data
        .filter((event) => event.source === 'ethereum_l1')
        .map((event) => event.type)
        .reverse(),
      ['onchain_vote_targeted', 'onchain_executed'],
    );
    assert.equal(repository.getDeliveryCounts().pending, 2);
  } finally {
    repository.close();
  }
});

test('executing a zero-action round clears early targets without relabelling them as slashed', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      earlyTargets: [earlyTarget(SEQUENCER_A, 1)],
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      earlyTargets: [earlyTarget(SEQUENCER_A, 1)],
      status: 'executed',
      isExecuted: true,
    }), { observedAt: 200 });

    const events = repository.listEvents({ network: 'mainnet' }).data;
    assert.equal(events.some((event) => event.type === 'onchain_executed'), false);
    assert.deepEqual(
      events.map((event) => event.type).sort(),
      ['onchain_execution_target_cleared', 'onchain_vote_targeted'],
    );
    assert.deepEqual(
      events.find((event) => event.type === 'onchain_execution_target_cleared').targets,
      [SEQUENCER_A],
    );
    assert.equal(repository.getDeliveryCounts().pending, 2);
    assert.equal(repository.listOnchainRounds({ network: 'mainnet' })[0].status, 'executed');
  } finally {
    repository.close();
  }
});

test('simultaneous target replacement and execution separates slashed and cleared sequencers', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A, SEQUENCER_B],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      actions: [{ sequencer: SEQUENCER_B, amount: '2000' }],
      payloadAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'executed',
      isExecuted: true,
    }), { observedAt: 200 });

    const events = repository.listEvents({ network: 'mainnet' }).data;
    const executed = events.find((event) => event.type === 'onchain_executed');
    const cleared = events.find((event) => event.type === 'onchain_execution_target_cleared');
    assert.deepEqual(executed.targets, [SEQUENCER_B]);
    assert.deepEqual(cleared.targets, [SEQUENCER_A]);
    assert.equal(executed.targets.includes(SEQUENCER_A), false);
    assert.equal(repository.getDeliveryCounts().pending, 3);
  } finally {
    repository.close();
  }
});

test('L1 pause transitions distinguish protection, temporary blocking, and actual executability', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    const executable = {
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'executable',
    };

    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      ...executable,
      isSlashingEnabled: false,
      isExecutionPaused: true,
      isProtected: true,
      pauseEndsAtSlot: '1200',
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      ...executable,
    }), { observedAt: 200 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 102,
      ...executable,
      isSlashingEnabled: false,
      isExecutionPaused: true,
      isProtected: false,
      pauseEndsAtSlot: '1100',
    }), { observedAt: 300 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 103,
      ...executable,
    }), { observedAt: 400 });

    const events = repository.listEvents({ network: 'mainnet', limit: 20 }).data
      .filter((event) => event.source === 'ethereum_l1')
      .reverse();
    assert.deepEqual(events.map((event) => event.type), [
      'onchain_pause_protected',
      'onchain_executable',
      'onchain_execution_paused',
      'onchain_executable',
    ]);
    assert.equal(events[0].title, 'Round protected through expiry');
    assert.equal(events[1].severity, 'critical');
    assert.equal(events[2].data.isExecutionPaused, true);
    assert.equal(repository.getDeliveryCounts().pending, 4);
  } finally {
    repository.close();
  }
});

test('a paused executable round that survives scheduled resume warns immediately', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'newly-executable',
      isSlashingEnabled: false,
      isExecutionPaused: true,
      isProtected: false,
      pauseEndsAtSlot: '1100',
    }), { observedAt: 100 });

    const [event] = repository.listEvents({ network: 'mainnet' }).data;
    assert.equal(event.type, 'onchain_executable_after_pause');
    assert.equal(event.severity, 'critical');
    assert.doesNotMatch(event.body, /can now be slashed/i);
  } finally {
    repository.close();
  }
});

test('L1 catch-up IDs cannot replay stale pause semantics after an early resume', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    const executable = {
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'executable',
    };
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      ...executable,
      isSlashingEnabled: false,
      isExecutionPaused: true,
      isProtected: true,
      pauseEndsAtSlot: '1200',
    }), { observedAt: 100 });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 200 });
    const [pausedCatchup] = repository.claimDeliveries({ now: 201 });
    assert.equal(pausedCatchup.event.type, 'onchain_pause_protected');

    repository.removeEndpoint(WATCHLIST_ID, 'telegram');
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({ block: 101, ...executable }), { observedAt: 300 });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 400 });
    const [resumedCatchup] = repository.claimDeliveries({ now: 401 });
    assert.equal(resumedCatchup.event.type, 'onchain_executable');
    assert.notEqual(resumedCatchup.event.id, pausedCatchup.event.id);
  } finally {
    repository.close();
  }
});

test('payload changes notify both removed and newly targeted sequencers', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A, SEQUENCER_B],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      actions: [{ sequencer: SEQUENCER_B, amount: '1000' }],
      payloadAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'quorum-reached',
    }), { observedAt: 200 });

    const changed = repository.listEvents({ network: 'mainnet' }).data
      .find((event) => event.type === 'onchain_payload_changed');
    assert.deepEqual(changed.targets, [SEQUENCER_A, SEQUENCER_B]);
    assert.equal(repository.getDeliveryCounts().pending, 2);
  } finally {
    repository.close();
  }
});

test('a reorg that removes an executed round emits a targeted correction', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'executed',
      isExecuted: true,
    }), { observedAt: 100 });
    const reorg = snapshot({ block: 101, reorgDetected: true });
    reorg.stacks[0].rounds = [];
    repository.recordSuccessfulL1Snapshot('mainnet', reorg, { observedAt: 200 });

    const correction = repository.listEvents({ network: 'mainnet' }).data
      .find((event) => event.type === 'onchain_reorg_correction');
    assert.deepEqual(correction.targets, [SEQUENCER_A]);
    assert.equal(repository.getDeliveryCounts().pending, 2);
  } finally {
    repository.close();
  }
});

test('an identical targeted round restoration and second removal each notify with a new generation', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    const targeted = {
      earlyTargets: [earlyTarget(SEQUENCER_A, 1)],
      status: 'below-quorum',
    };
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({ block: 100, ...targeted }), {
      observedAt: 100,
    });
    const removed = snapshot({ block: 101, reorgDetected: true });
    removed.stacks[0].rounds = [];
    repository.recordSuccessfulL1Snapshot('mainnet', removed, { observedAt: 200 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 102,
      reorgDetected: true,
      ...targeted,
    }), { observedAt: 300 });
    const removedAgain = snapshot({ block: 103, reorgDetected: true });
    removedAgain.stacks[0].rounds = [];
    repository.recordSuccessfulL1Snapshot('mainnet', removedAgain, { observedAt: 400 });

    const targetedEvents = repository.listEvents({ network: 'mainnet', limit: 30 }).data
      .filter((event) => event.targets.includes(SEQUENCER_A))
      .reverse();
    assert.deepEqual(targetedEvents.map((event) => event.type), [
      'onchain_vote_targeted',
      'onchain_reorg_correction',
      'onchain_reorg_restored',
      'onchain_reorg_correction',
    ]);
    assert.equal(targetedEvents[2].severity, 'critical');
    assert.equal(targetedEvents[2].data.forkGeneration, 2);
    assert.notEqual(targetedEvents[1].id, targetedEvents[3].id);
    assert.equal(repository.getDeliveryCounts().pending, 4);
    assert.equal(
      repository.db.prepare('SELECT transition_generation AS generation FROM onchain_rounds').get().generation,
      3,
    );
  } finally {
    repository.close();
  }
});

test('an exact executed-fork oscillation emits fresh correction and restoration events', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.createWatchlist({
      id: WATCHLIST_ID,
      managementTokenHash: 'f'.repeat(64),
      network: 'mainnet',
      addresses: [SEQUENCER_A],
      now: 1,
    });
    repository.upsertEndpoint({ watchlistId: WATCHLIST_ID, kind: 'telegram', destination: '42', now: 2 });
    const actions = [{ sequencer: SEQUENCER_A, amount: '1000' }];
    const payloadAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const forkA = () => snapshot({
      block: 100,
      actions,
      payloadAddress,
      status: 'executed',
      isExecuted: true,
      reorgDetected: true,
    });
    const forkB = () => snapshot({
      block: 101,
      actions,
      payloadAddress,
      status: 'quorum-reached',
      reorgDetected: true,
    });
    const initial = forkA();
    initial.reorgDetected = false;
    repository.recordSuccessfulL1Snapshot('mainnet', initial, { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', forkB(), { observedAt: 200 });
    repository.recordSuccessfulL1Snapshot('mainnet', forkA(), { observedAt: 300 });
    repository.recordSuccessfulL1Snapshot('mainnet', forkB(), { observedAt: 400 });

    const events = repository.listEvents({ network: 'mainnet', limit: 30 }).data
      .filter((event) => event.targets.includes(SEQUENCER_A))
      .reverse();
    assert.deepEqual(events.map((event) => event.type), [
      'onchain_executed',
      'onchain_reorg_correction',
      'onchain_executed',
      'onchain_reorg_correction',
    ]);
    assert.equal(new Set(events.map((event) => event.id)).size, 4);
    assert.deepEqual(events.slice(1).map((event) => event.data.forkGeneration), [1, 2, 3]);
    assert.equal(repository.getDeliveryCounts().pending, 4);
  } finally {
    repository.close();
  }
});

test('a failed L1 round refresh retains the prior state instead of expiring it', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    const degraded = snapshot({ block: 101 });
    degraded.degraded = true;
    degraded.stacks[0].rounds = [];
    degraded.stacks[0].roundErrors = [{ round: '7', error: 'timeout' }];
    repository.recordSuccessfulL1Snapshot('mainnet', degraded, { observedAt: 200 });

    assert.equal(repository.listOnchainRounds({ network: 'mainnet' })[0].status, 'quorum-reached');
    assert.equal(repository.getSourceState('l1').metadata.degraded, true);
  } finally {
    repository.close();
  }
});

test('a failed legacy scan retains rows first observed under the active role', () => {
  const repository = new OffenseRepository(':memory:');
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [{ sequencer: SEQUENCER_A, amount: '1000' }],
      payloadAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'quorum-reached',
    }), { observedAt: 100 });

    const degraded = snapshot({ block: 101 });
    const oldSlasherAddress = degraded.stacks[0].slasherAddress;
    degraded.degraded = true;
    degraded.stackErrors = [{
      role: 'legacy',
      slasherAddress: oldSlasherAddress,
      error: 'timeout during first legacy scan',
    }];
    degraded.stacks[0] = {
      ...degraded.stacks[0],
      slasherAddress: '0x0000000000000000000000000000000000000005',
      proposerAddress: '0x0000000000000000000000000000000000000006',
      rounds: [],
    };
    repository.recordSuccessfulL1Snapshot('mainnet', degraded, { observedAt: 200 });

    const [retained] = repository.listOnchainRounds({ network: 'mainnet' });
    assert.equal(retained.role, 'active');
    assert.equal(retained.status, 'quorum-reached');
    assert.equal(
      repository.listEvents({ network: 'mainnet' }).data.some((event) => event.type === 'onchain_expired'),
      false,
    );
  } finally {
    repository.close();
  }
});

function snapshot({
  block,
  earlyTargets = [],
  actions = [],
  payloadAddress = null,
  status = 'below-quorum',
  isVetoed = false,
  isExecuted = false,
  reorgDetected = false,
  isSlashingEnabled = true,
  isExecutionPaused = false,
  isProtected = false,
  pauseStartedAtSlot = null,
  pauseEndsAtSlot = null,
  targetEpochs = [],
  executableSlot = '900',
  expirySlot = '1200',
}) {
  return {
    chainId: 1,
    blockNumber: String(block),
    blockHash: `0x${block.toString(16).padStart(64, '0')}`,
    blockTimestamp: String(block),
    registryAddress: '0x0000000000000000000000000000000000000001',
    rollupAddress: '0x0000000000000000000000000000000000000002',
    rollupVersion: '1',
    l1GenesisTime: '100',
    slotDuration: '12',
    epochDuration: '32',
    currentSlot: '1000',
    currentEpoch: '10',
    stackErrors: [],
    degraded: false,
    reorgDetected,
    stacks: [{
      role: 'active',
      slasherAddress: '0x0000000000000000000000000000000000000003',
      proposerAddress: '0x0000000000000000000000000000000000000004',
      currentRound: '7',
      isSlashingEnabled,
      slashingDisabledUntil: isSlashingEnabled ? '0' : '123456',
      pauseStartedAtSlot,
      pauseEndsAtSlot,
      parameters: {},
      roundErrors: [],
      rounds: [{
        round: '7',
        ballotCount: String(Math.max(earlyTargets[0]?.voteCount ?? 0, actions.length ? 2 : 0)),
        status,
        isExecuted,
        isVetoed,
        isAuthorized: true,
        isExecutionPaused,
        isProtected,
        payloadAddress,
        earlyTargets,
        actions,
        committees: [],
        targetEpochs,
        executableSlot,
        expirySlot,
      }],
    }],
  };
}

function earlyTarget(sequencer, voteCount) {
  return { sequencer, voteCount, maxSlashUnits: 1, unitVoteCounts: [voteCount, 0, 0] };
}

function slashChunk({
  from,
  to,
  confirmed,
  logs,
  initial = false,
  initialBackfill = false,
  hasMore = false,
  reorgDetected = false,
}) {
  return {
    chainId: 1,
    fromBlock: String(from),
    toBlock: String(to),
    toBlockHash: testHash(to),
    confirmedBlockNumber: String(confirmed),
    registryAddress: '0x0000000000000000000000000000000000000001',
    rollupAddresses: ['0x0000000000000000000000000000000000000002'],
    logs,
    initial,
    initialBackfill,
    hasMore,
    reorgDetected,
  };
}

function slashLog({ block, sequencer, amount = '1000' }) {
  return {
    rollupAddress: '0x0000000000000000000000000000000000000002',
    blockNumber: String(block),
    blockHash: testHash(block),
    transactionHash: testHash(block + 10_000),
    logIndex: 1,
    sequencer,
    amount,
  };
}

function testHash(value) {
  return `0x${Number(value).toString(16).padStart(64, '0')}`;
}

function notificationTestEvent(id) {
  return {
    id,
    network: 'mainnet',
    source: 'test',
    type: 'notification_test',
    severity: 'info',
    title: 'test',
    body: 'test',
    data: {},
    observedAt: 100,
  };
}

function verifyWebPushEndpoint(repository, now) {
  const [delivery] = repository.claimDeliveries({ now, limit: 1 });
  assert.ok(delivery, 'a Web Push verification delivery should be claimable');
  assert.equal(delivery.event.type, 'notification_channel_verification');
  assert.equal(repository.completeDelivery(delivery.id, 'verified', now), true);
  return delivery;
}
