import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { SlashmonRepository } from '../src/database.mjs';
import { parseOffenseSnapshot } from '../src/offenses.mjs';
import { OFFENSE_A, OFFENSE_B, VALIDATOR_A } from './helpers.mjs';

test('successful snapshots persist, resolve after a grace count, and reactivate', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-collector-'));
  const databasePath = path.join(directory, 'slashmon.sqlite');
  const repository = new SlashmonRepository(databasePath);
  t.after(() => {
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const [offenseA, offenseB] = parseOffenseSnapshot([OFFENSE_A, OFFENSE_B]);

  assert.deepEqual(
    repository.recordSuccessfulPoll([offenseA, offenseB], { observedAt: 1_000, resolveAfterMissedPolls: 2 }),
    { sequence: 1, observed: 2, inserted: 2, updated: 0, reactivated: 0, resolved: 0, events: 2 },
  );
  repository.recordSuccessfulPoll([offenseA], {
    observedAt: 2_000,
    resolveAfterMissedPolls: 2,
    absenceEvidence: advancingEvidence(),
  });
  assert.equal(offenseById(repository, offenseB.id).status, 'active');
  assert.equal(offenseById(repository, offenseB.id).missedPolls, 1);

  const third = repository.recordSuccessfulPoll([offenseA], {
    observedAt: 3_000,
    resolveAfterMissedPolls: 2,
    absenceEvidence: advancingEvidence(),
  });
  assert.equal(third.resolved, 1);
  assert.equal(offenseById(repository, offenseB.id).status, 'resolved');
  assert.equal(offenseById(repository, offenseB.id).resolvedAt, new Date(3_000).toISOString());

  const fourth = repository.recordSuccessfulPoll([offenseA, offenseB], { observedAt: 4_000, resolveAfterMissedPolls: 2 });
  assert.equal(fourth.reactivated, 1);
  assert.equal(offenseById(repository, offenseB.id).status, 'active');
  assert.equal(offenseById(repository, offenseB.id).reactivationCount, 1);
  assert.equal(repository.listOffenses({ status: 'active' }).length, 2);
  assert.deepEqual(repository.listOffenses({ status: 'all', validators: [offenseB.validator] }).map(item => item.id), [offenseB.id]);
  assert.equal(repository.listOffenses({
    status: 'active',
    validators: [offenseB.validator],
  }).length, 1);
});

function advancingEvidence() {
  return {
    epoch: { advanced: true, value: '10000' },
    slot: { advanced: true, value: '10000' },
  };
}

test('database state survives reopening and failures do not mutate offense snapshots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-collector-'));
  const databasePath = path.join(directory, 'slashmon.sqlite');
  const [offense] = parseOffenseSnapshot([OFFENSE_A]);

  let repository = new SlashmonRepository(databasePath);
  repository.recordSuccessfulPoll([offense], { observedAt: 1_000 });
  repository.recordFailure('node restarting', 2_000);
  assert.equal(offenseById(repository, offense.id).missedPolls, 0);
  repository.close();

  repository = new SlashmonRepository(databasePath);
  assert.equal(offenseById(repository, offense.id).status, 'active');
  assert.equal(repository.getSyncState().consecutiveFailures, 1);
  assert.equal(repository.getSyncState().lastError, 'node restarting');
  repository.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('database runtime identity persists and refuses network, chain, or Registry reuse', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-collector-'));
  const databasePath = path.join(directory, 'slashmon.sqlite');
  const identity = {
    network: 'mainnet',
    chainId: 1,
    registryAddress: '0xA000000000000000000000000000000000000001',
  };

  let repository = new SlashmonRepository(databasePath);
  assert.deepEqual(repository.bindRuntimeIdentity(identity), {
    ...identity,
    registryAddress: identity.registryAddress.toLowerCase(),
  });
  assert.deepEqual(repository.bindRuntimeIdentity(identity), {
    ...identity,
    registryAddress: identity.registryAddress.toLowerCase(),
  });
  repository.close();

  repository = new SlashmonRepository(databasePath);
  assert.deepEqual(repository.bindRuntimeIdentity(identity), {
    ...identity,
    registryAddress: identity.registryAddress.toLowerCase(),
  });
  assert.throws(
    () => repository.bindRuntimeIdentity({ ...identity, network: 'testnet' }),
    /database is bound to mainnet/,
  );
  assert.throws(
    () => repository.bindRuntimeIdentity({ ...identity, chainId: 11_155_111 }),
    /refusing mainnet chain 11155111/,
  );
  assert.throws(
    () => repository.bindRuntimeIdentity({
      ...identity,
      registryAddress: '0xB000000000000000000000000000000000000002',
    }),
    /Registry 0xb000000000000000000000000000000000000002/,
  );
  repository.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('legacy and nonempty databases are rejected instead of migrated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slashmon-collector-'));
  const databasePath = path.join(directory, 'slashmon.sqlite');
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
      'legacy-id', '${VALIDATOR_A}', '${OFFENSE_A.amount}', 3, 'inactivity', '42', 'epoch',
      'active', 1000, 1000, NULL, 1, 0, 0, 1
    );
    PRAGMA user_version = 1;
  `);
  database.close();

  assert.throws(
    () => new SlashmonRepository(databasePath),
    /requires an empty database; found unsupported schema 1/,
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

function offenseById(repository, id) {
  return repository.listOffenses({ status: 'all', limit: 1_000 })
    .find((offense) => offense.id === id);
}
