import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { OffenseRepository } from '../src/database.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import { OFFENSE_A, OFFENSE_B, SEQUENCER_A } from './helpers.mjs';

test('successful snapshots persist, withdraw after a grace count, and reactivate', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-collector-'));
  const databasePath = path.join(directory, 'offenses.sqlite');
  const repository = new OffenseRepository(databasePath);
  t.after(() => {
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const [offenseA, offenseB] = parseOffenseSnapshot([OFFENSE_A, OFFENSE_B]);

  assert.deepEqual(
    repository.recordSuccessfulPoll([offenseA, offenseB], { observedAt: 1_000, withdrawAfterMissedPolls: 2 }),
    { sequence: 1, observed: 2, inserted: 2, reactivated: 0, withdrawn: 0 },
  );
  repository.recordSuccessfulPoll([offenseA], { observedAt: 2_000, withdrawAfterMissedPolls: 2 });
  assert.equal(repository.getOffense(offenseB.id).status, 'active');
  assert.equal(repository.getOffense(offenseB.id).missedPolls, 1);

  const third = repository.recordSuccessfulPoll([offenseA], { observedAt: 3_000, withdrawAfterMissedPolls: 2 });
  assert.equal(third.withdrawn, 1);
  assert.equal(repository.getOffense(offenseB.id).status, 'withdrawn');
  assert.equal(repository.getOffense(offenseB.id).withdrawnAt, new Date(3_000).toISOString());

  const fourth = repository.recordSuccessfulPoll([offenseA, offenseB], { observedAt: 4_000, withdrawAfterMissedPolls: 2 });
  assert.equal(fourth.reactivated, 1);
  assert.equal(repository.getOffense(offenseB.id).status, 'active');
  assert.equal(repository.getOffense(offenseB.id).reactivationCount, 1);
  assert.equal(repository.getCounts().active, 2);
  assert.deepEqual(repository.listOffenses({ status: 'all', sequencers: [offenseB.sequencer] }).map(item => item.id), [offenseB.id]);
  assert.equal(repository.countOffenses({ status: 'active', sequencers: [offenseB.sequencer] }), 1);
});

test('database state survives reopening and failures do not mutate offense snapshots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-collector-'));
  const databasePath = path.join(directory, 'offenses.sqlite');
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);

  let repository = new OffenseRepository(databasePath);
  repository.recordSuccessfulPoll([offense], { observedAt: 1_000 });
  repository.recordFailure('node restarting', 2_000);
  assert.equal(repository.getOffense(offense.id).missedPolls, 0);
  repository.close();

  repository = new OffenseRepository(databasePath);
  assert.equal(repository.getOffense(offense.id).status, 'active');
  assert.equal(repository.getSyncState().consecutiveFailures, 1);
  assert.equal(repository.getSyncState().lastError, 'node restarting');
  repository.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('version 1 databases migrate their address column to sequencer', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-collector-'));
  const databasePath = path.join(directory, 'offenses.sqlite');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE offenses (
      id TEXT PRIMARY KEY,
      validator TEXT NOT NULL,
      amount TEXT NOT NULL,
      offense_type INTEGER NOT NULL,
      offense_type_name TEXT NOT NULL,
      epoch_or_slot TEXT NOT NULL,
      time_unit TEXT NOT NULL,
      status TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      withdrawn_at INTEGER,
      observation_count INTEGER NOT NULL DEFAULT 1,
      reactivation_count INTEGER NOT NULL DEFAULT 0,
      missed_polls INTEGER NOT NULL DEFAULT 0,
      last_poll_sequence INTEGER NOT NULL
    );
    CREATE INDEX offenses_validator_idx ON offenses(validator, last_seen_at DESC);
    CREATE TABLE sync_state (
      singleton INTEGER PRIMARY KEY,
      last_attempt_at INTEGER,
      last_success_at INTEGER,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      successful_polls INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    INSERT INTO sync_state(singleton) VALUES (1);
    INSERT INTO offenses VALUES (
      'legacy-id', '${SEQUENCER_A}', '${OFFENSE_A.amount}', 3, 'inactivity', '42', 'epoch',
      'active', 1000, 1000, NULL, 1, 0, 0, 1
    );
    PRAGMA user_version = 1;
  `);
  database.close();

  const repository = new OffenseRepository(databasePath);
  assert.equal(repository.getOffense('legacy-id').sequencer, SEQUENCER_A);
  const columns = repository.db.prepare('PRAGMA table_info(offenses)').all().map(row => row.name);
  assert.equal(columns.includes('sequencer'), true);
  assert.equal(columns.includes('validator'), false);
  repository.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
