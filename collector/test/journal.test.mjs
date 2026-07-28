import assert from 'node:assert/strict';
import test from 'node:test';

import { SlashmonRepository, aggregateSlashActions } from '../src/database.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import { OFFENSE_A, VALIDATOR_A } from './helpers.mjs';

const VALIDATOR_B = '0x2222222222222222222222222222222222222222';
const WATCHLIST_ID = '00000000-0000-4000-8000-000000000001';
const PAYLOAD = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('node offenses alert only on first appearance and resolve explicitly', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    const [offense] = parseOffenseSnapshot([OFFENSE_A]);
    repository.recordSuccessfulPoll([offense], {
      network: 'mainnet',
      observedAt: 100,
      resolveAfterMissedPolls: 1,
    });
    repository.recordSuccessfulPoll([offense], {
      network: 'mainnet',
      observedAt: 200,
      resolveAfterMissedPolls: 1,
    });
    assert.deepEqual(
      alertEvents(repository).map((event) => event.type),
      ['node_offense_detected'],
    );

    const resolved = repository.recordSuccessfulPoll([], {
      network: 'mainnet',
      observedAt: 300,
      resolveAfterMissedPolls: 1,
      absenceEvidence: advancingEvidence(),
    });
    assert.equal(resolved.resolved, 1);
    assert.equal(offenseById(repository, offense.id).status, 'resolved');
    assert.equal(offenseById(repository, offense.id).resolvedAt, new Date(300).toISOString());

    const returned = repository.recordSuccessfulPoll([offense], {
      network: 'mainnet',
      observedAt: 400,
    });
    assert.equal(returned.reactivated, 1);
    assert.equal(returned.events, 0);
  } finally {
    repository.close();
  }
});

test('case output keeps raw action provenance but sums duplicate validator actions', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    const actions = [
      action(VALIDATOR_A, '10', 0, '40', 0, 0),
      action(VALIDATOR_A, '20', 1, '40', 0, 1),
      action(VALIDATOR_B, '30', 2, '41', 1, 0),
    ];
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions,
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 100 });

    const monitor = repository.getMonitorSnapshot('mainnet');
    assert.equal(monitor.cases.length, 1);
    assert.equal(monitor.cases[0].phase, 'voting');
    assert.equal(monitor.cases[0].outcome, null);
    assert.deepEqual(monitor.cases[0].targets, [
      { address: VALIDATOR_A, proposedAmount: '30', actionCount: 2 },
      { address: VALIDATOR_B, proposedAmount: '30', actionCount: 1 },
    ]);
    assert.deepEqual(JSON.parse(repository.db.prepare(`
      SELECT actions_json AS actionsJson FROM onchain_rounds WHERE network = 'mainnet'
    `).get().actionsJson), actions, 'raw actions and their committee provenance remain inspectable');
    assert.deepEqual(aggregateSlashActions(actions), monitor.cases[0].targets);
  } finally {
    repository.close();
  }
});

test('validator observedAt only reflects facts for that validator', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    repository.recordSourceSuccess('l1', {}, 500);
    assert.equal(repository.getValidatorSnapshot('mainnet', VALIDATOR_A).observedAt, null);

    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    repository.recordSourceSuccess('l1', {}, 600);

    assert.equal(
      repository.getValidatorSnapshot('mainnet', VALIDATOR_A).observedAt,
      new Date(100).toISOString(),
    );
    assert.equal(repository.getValidatorSnapshot('mainnet', VALIDATOR_B).observedAt, null);
  } finally {
    repository.close();
  }
});

test('case phases separate timing from terminal outcomes and never claim pause protection', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      currentRound: '7',
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
      isVetoed: true,
    }), { observedAt: 100 });
    assert.deepEqual(caseState(repository), {
      phase: 'voting',
      outcome: null,
      currentPayloadVetoed: true,
    });

    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      currentRound: '8',
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
      isVetoed: true,
    }), { observedAt: 200 });
    assert.deepEqual(caseState(repository), {
      phase: 'closed',
      outcome: 'vetoed',
      currentPayloadVetoed: true,
    });
    assert.equal(
      repository.db.prepare('SELECT status FROM onchain_rounds').get().status,
      'vetoed',
      'a final veto is persisted as a terminal outcome',
    );

    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 102,
      currentRound: '12',
      includeRound: false,
    }), { observedAt: 300 });
    assert.deepEqual(caseState(repository), {
      phase: 'closed',
      outcome: 'vetoed',
      currentPayloadVetoed: true,
    });
    assert.deepEqual(
      alertEvents(repository).map((event) => event.type).sort(),
      ['onchain_vetoed'],
    );
  } finally {
    repository.close();
  }

  for (const [status, paused, phase, outcome] of [
    ['quorum-reached', false, 'review', null],
    ['newly-executable', false, 'ready', null],
    ['newly-executable', true, 'paused', null],
    ['executed', false, 'closed', 'executed'],
  ]) {
    const one = new SlashmonRepository(':memory:');
    try {
      one.recordSuccessfulL1Snapshot('mainnet', snapshot({
        block: 110,
        currentRound: status === 'quorum-reached' ? '8' : '10',
        actions: [action(VALIDATOR_A, '10')],
        ballotCount: '3',
        status,
        isExecuted: status === 'executed',
        isExecutionPaused: paused,
        isSlashingEnabled: !paused,
        pauseEndsAtSlot: paused ? '1100' : null,
      }), { observedAt: 100 });
      const current = one.getMonitorSnapshot('mainnet').cases[0];
      assert.equal(current.phase, phase);
      assert.equal(current.outcome, outcome);
      assert.equal(Object.hasOwn(current, 'isProtected'), false);
    } finally {
      one.close();
    }
  }
});

test('a canonical proposal removed by a reorg is cleared while voting remains open', () => {
  const repository = notifiedRepository();
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    assert.equal(repository.getMonitorSnapshot('mainnet').cases.length, 1);
    assert.equal(
      repository.db.prepare(`SELECT COUNT(*) AS count FROM deliveries WHERE status = 'pending'`).get().count,
      1,
    );

    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      currentRound: '7',
      includeRound: false,
    }), { observedAt: 200 });

    assert.equal(repository.getMonitorSnapshot('mainnet').cases.length, 0);
    assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM deliveries').get().count, 0);
    assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, 0);
  } finally {
    repository.close();
  }
});

test('new candidate targets alert once per case and validator without re-alerting earlier targets', () => {
  const repository = notifiedRepository([VALIDATOR_A, VALIDATOR_B]);
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      actions: [
        action(VALIDATOR_A, '10'),
        action(VALIDATOR_B, '20', 1),
      ],
      ballotCount: '4',
      status: 'quorum-reached',
    }), { observedAt: 200 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 102,
      actions: [
        action(VALIDATOR_A, '10'),
        action(VALIDATOR_B, '20', 1),
      ],
      ballotCount: '4',
      status: 'quorum-reached',
    }), { observedAt: 300 });

    assert.deepEqual(repository.db.prepare(`
      SELECT event.observed_at AS observedAt, group_concat(target.validator) AS validators
      FROM events event
      JOIN event_targets target ON target.event_id = event.id
      WHERE event.type = 'onchain_quorum_candidate'
      GROUP BY event.id
      ORDER BY event.observed_at
    `).all().map((row) => ({ ...row })), [
      { observedAt: 100, validators: VALIDATOR_A },
      { observedAt: 200, validators: VALIDATOR_B },
    ]);
    assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM deliveries').get().count, 2);
  } finally {
    repository.close();
  }
});

test('a replacement candidate cancels the stale pending target and alerts the new target', () => {
  const repository = notifiedRepository([VALIDATOR_A, VALIDATOR_B]);
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      actions: [action(VALIDATOR_B, '20')],
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 200 });

    const deliveries = repository.claimDeliveries({ now: 200 });
    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0].event.targets, [VALIDATOR_B]);
    assert.equal(
      repository.db.prepare(`
        SELECT COUNT(*) AS count
        FROM event_targets WHERE validator = ?
      `).get(VALIDATOR_A).count,
      0,
    );
  } finally {
    repository.close();
  }
});

test('a ready alert supersedes an unsent candidate alert for the same case', () => {
  const repository = notifiedRepository();
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      currentRound: '10',
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'newly-executable',
    }), { observedAt: 200 });

    assert.deepEqual(alertEvents(repository).map((event) => event.type), ['onchain_ready']);
    assert.deepEqual(repository.db.prepare(`
      SELECT event.type
      FROM deliveries delivery
      JOIN events event ON event.id = delivery.event_id
    `).all().map((row) => row.type), ['onchain_ready']);
  } finally {
    repository.close();
  }
});

test('a closed round with no canonical actions becomes no-consensus, not expired', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 100 });

    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      currentRound: '8',
      includeRound: false,
    }), { observedAt: 200 });

    const current = repository.getMonitorSnapshot('mainnet').cases[0];
    assert.equal(current.phase, 'closed');
    assert.equal(current.outcome, 'no-consensus');
    assert.equal(current.votesCast, '0');
    assert.deepEqual(current.targets, []);
    assert.equal(alertEvents(repository).some((event) => event.type === 'onchain_expired'), false);
  } finally {
    repository.close();
  }
});

test('a proposal only becomes expired after its configured lifetime', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'quorum-reached',
    }), { observedAt: 100 });
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 101,
      currentRound: '12',
      includeRound: false,
    }), { observedAt: 200 });

    const current = repository.getMonitorSnapshot('mainnet').cases[0];
    assert.equal(current.phase, 'closed');
    assert.equal(current.outcome, 'expired');
    assert.deepEqual(current.targets, [
      { address: VALIDATOR_A, proposedAmount: '10', actionCount: 1 },
    ]);
    assert.equal(
      alertEvents(repository).filter((event) => event.type === 'onchain_expired').length,
      1,
    );
  } finally {
    repository.close();
  }
});

test('executed targets do not emit proposal alerts', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    const result = repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 100,
      currentRound: '10',
      actions: [action(VALIDATOR_A, '10')],
      ballotCount: '3',
      status: 'executed',
      isExecuted: true,
    }), { observedAt: 100 });
    assert.equal(result.events, 0);
    assert.equal(repository.getMonitorSnapshot('mainnet').cases[0].outcome, 'executed');
  } finally {
    repository.close();
  }
});

test('Slashed logs are grouped by transaction and validator with one alert', () => {
  const repository = notifiedRepository();
  try {
    const logs = [
      slashLog({ block: 100, logIndex: 1, validator: VALIDATOR_A, amount: '10' }),
      slashLog({ block: 100, logIndex: 2, validator: VALIDATOR_A, amount: '20' }),
    ];
    const result = repository.recordSuccessfulL1SlashLogChunk(
      'mainnet',
      slashChunk({ from: 99, to: 100, confirmed: 100, logs }),
      { observedAt: 100 },
    );

    assert.deepEqual(
      {
        logsInserted: result.inserted,
        outcomesInserted: result.outcomesInserted,
        alertsQueued: result.queued,
      },
      { logsInserted: 2, outcomesInserted: 1, alertsQueued: 1 },
    );
    assert.deepEqual(repository.listSlashOutcomes({
      network: 'mainnet',
      canonical: true,
    }), [{
      id: repository.listSlashOutcomes({
        network: 'mainnet',
        canonical: true,
      })[0].id,
      address: VALIDATOR_A,
      actualAmount: '30',
      logCount: 2,
      logIndexes: [1, 2],
      canonical: true,
      chainId: 1,
      rollupAddress: '0x0000000000000000000000000000000000000002',
      blockNumber: '100',
      blockHash: testHash(100),
      transactionHash: testHash(10_100),
      firstObservedAt: new Date(100).toISOString(),
      observedAt: new Date(100).toISOString(),
    }]);
    assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM l1_slash_logs').get().count, 2);
    assert.deepEqual(
      alertEvents(repository).map((event) => event.type),
      ['l1_slash_confirmed'],
    );
  } finally {
    repository.close();
  }
});

test('historical slash backfill stores outcomes without sending alerts', () => {
  const repository = notifiedRepository();
  try {
    const result = repository.recordSuccessfulL1SlashLogChunk('mainnet', slashChunk({
      from: 90,
      to: 100,
      confirmed: 120,
      logs: [slashLog({ block: 95, logIndex: 1, validator: VALIDATOR_A, amount: '10' })],
      initialBackfill: true,
      hasMore: true,
    }), { observedAt: 100 });
    assert.equal(result.outcomesInserted, 1);
    assert.equal(result.queued, 0);
    assert.equal(alertEvents(repository).length, 0);
  } finally {
    repository.close();
  }
});

test('monitor bounds confirmed and removed slashes independently and reports each scan checkpoint', () => {
  const repository = new SlashmonRepository(':memory:');
  try {
    repository.recordSuccessfulL1Snapshot('mainnet', snapshot({
      block: 90,
      includeRound: false,
    }), { observedAt: 50 });
    repository.recordSuccessfulL1SlashLogChunk(
      'mainnet',
      slashChunk({
        from: 99,
        to: 100,
        confirmed: 100,
        logs: [slashLog({
          block: 100,
          logIndex: 1,
          validator: VALIDATOR_A,
          amount: '10',
        })],
      }),
      { observedAt: 100 },
    );
    repository.recordSuccessfulL1SlashLogChunk(
      'mainnet',
      slashChunk({
        from: 100,
        to: 101,
        confirmed: 101,
        logs: [slashLog({
          block: 101,
          logIndex: 1,
          validator: VALIDATOR_B,
          amount: '20',
        })],
      }),
      { observedAt: 200 },
    );
    repository.recordSuccessfulL1SlashLogChunk(
      'mainnet',
      slashChunk({
        from: 101,
        to: 101,
        confirmed: 101,
        logs: [],
        reorgDetected: true,
      }),
      { observedAt: 300 },
    );

    const monitor = repository.getMonitorSnapshot('mainnet', {
      confirmedSlashLimit: 1,
      removedSlashLimit: 1,
    });
    assert.deepEqual(
      monitor.slashes.confirmed.map((slash) => slash.blockNumber),
      ['100'],
    );
    assert.deepEqual(
      monitor.slashes.removed.map((slash) => slash.blockNumber),
      ['101'],
    );
    assert.deepEqual(monitor.coverage, {
      cases: {
        observedAt: new Date(50).toISOString(),
        blockNumber: '90',
        blockHash: testHash(90),
        complete: true,
      },
      slashes: {
        observedAt: new Date(300).toISOString(),
        fromBlock: '99',
        blockNumber: '101',
        blockHash: testHash(101),
        confirmedBlockNumber: '101',
        complete: true,
      },
    });
  } finally {
    repository.close();
  }
});

test('grouped slash outcomes reorg and reconfirm as one incident', () => {
  const repository = notifiedRepository();
  try {
    const logs = [
      slashLog({ block: 100, logIndex: 1, validator: VALIDATOR_A, amount: '10' }),
      slashLog({ block: 100, logIndex: 2, validator: VALIDATOR_A, amount: '20' }),
    ];
    repository.recordSuccessfulL1SlashLogChunk(
      'mainnet',
      slashChunk({ from: 99, to: 100, confirmed: 100, logs }),
      { observedAt: 100 },
    );
    const removed = repository.recordSuccessfulL1SlashLogChunk(
      'mainnet',
      slashChunk({ from: 99, to: 100, confirmed: 100, logs: [], reorgDetected: true }),
      { observedAt: 200 },
    );
    assert.equal(removed.corrections, 1);
    assert.equal(repository.listSlashOutcomes({
      network: 'mainnet',
      canonical: false,
    })[0].canonical, false);

    const restored = repository.recordSuccessfulL1SlashLogChunk(
      'mainnet',
      slashChunk({ from: 99, to: 100, confirmed: 100, logs, reorgDetected: true }),
      { observedAt: 300 },
    );
    assert.equal(restored.reconfirmed, 1);
    const events = alertEvents(repository);
    assert.deepEqual(
      events.map((event) => event.type).sort(),
      ['l1_slash_confirmed', 'l1_slash_reconfirmed', 'l1_slash_reorged'],
    );
    assert.equal(new Set(events.map((event) => event.incidentId)).size, 1);
  } finally {
    repository.close();
  }
});

function notifiedRepository(addresses = [VALIDATOR_A]) {
  const repository = new SlashmonRepository(':memory:');
  repository.createWatchlist({
    id: WATCHLIST_ID,
    managementTokenHash: 'a'.repeat(64),
    network: 'mainnet',
    addresses,
    now: 1,
  });
  repository.upsertEndpoint({
    watchlistId: WATCHLIST_ID,
    kind: 'telegram',
    destination: '42',
    now: 2,
  });
  return repository;
}

function alertEvents(repository) {
  return repository.db.prepare(`
    SELECT type, incident_id AS incidentId
    FROM events WHERE source != 'test'
    ORDER BY observed_at DESC, id DESC
  `).all();
}

function offenseById(repository, id) {
  return repository.listOffenses({ status: 'all', limit: 1_000 })
    .find((offense) => offense.id === id);
}

function snapshot({
  block,
  currentRound = '7',
  actions = [],
  ballotCount = '0',
  status = 'below-quorum',
  isVetoed = false,
  isExecuted = false,
  isSlashingEnabled = true,
  isExecutionPaused = false,
  pauseEndsAtSlot = null,
  includeRound = true,
}) {
  return {
    chainId: 1,
    blockNumber: String(block),
    blockHash: testHash(block),
    blockTimestamp: String(block),
    registryAddress: '0x0000000000000000000000000000000000000001',
    rollupAddress: '0x0000000000000000000000000000000000000002',
    rollupVersion: '1',
    l1GenesisTime: '100',
    slotDuration: '12',
    epochDuration: '32',
    currentSlot: status === 'newly-executable' ? '1000' : '800',
    currentEpoch: '10',
    stackErrors: [],
    degraded: false,
    reorgDetected: false,
    stacks: [{
      role: 'active',
      slasherAddress: '0x0000000000000000000000000000000000000003',
      proposerAddress: '0x0000000000000000000000000000000000000004',
      currentRound,
      isSlashingEnabled,
      slashingDisabledUntil: isSlashingEnabled ? '0' : '123456',
      slashingDisableDuration: '1000',
      pauseStartedAtSlot: isSlashingEnabled ? null : '900',
      pauseEndsAtSlot,
      parameters: {
        quorum: '3',
        roundSize: '128',
        roundSizeInEpochs: '4',
        executionDelayInRounds: '2',
        lifetimeInRounds: '4',
        slashOffsetInRounds: '2',
        committeeSize: '48',
      },
      roundErrors: [],
      rounds: includeRound ? [{
        round: '7',
        ballotCount,
        status,
        isExecuted,
        isVetoed,
        isAuthorized: true,
        isExecutionPaused,
        payloadAddress: actions.length > 0 ? PAYLOAD : null,
        actions,
        targetEpochs: ['40', '41'],
        executableSlot: '1000',
        expirySlot: '1200',
      }] : [],
    }],
  };
}

function action(validator, amount, actionIndex = 0, epoch = '40', epochIndex = 0, committeeIndex = 0) {
  return { validator, amount, actionIndex, epoch, epochIndex, committeeIndex };
}

function caseState(repository) {
  const current = repository.getMonitorSnapshot('mainnet').cases[0];
  return {
    phase: current.phase,
    outcome: current.outcome,
    currentPayloadVetoed: current.currentPayloadVetoed,
  };
}

function slashChunk({
  from,
  to,
  confirmed,
  logs,
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
    initialBackfill,
    hasMore,
    reorgDetected,
  };
}

function slashLog({ block, logIndex, validator, amount }) {
  return {
    rollupAddress: '0x0000000000000000000000000000000000000002',
    blockNumber: String(block),
    blockHash: testHash(block),
    transactionHash: testHash(block + 10_000),
    logIndex,
    validator,
    amount,
  };
}

function testHash(value) {
  return `0x${Number(value).toString(16).padStart(64, '0')}`;
}

function advancingEvidence() {
  return {
    epoch: { advanced: true, value: '10000' },
    slot: { advanced: true, value: '10000' },
  };
}
