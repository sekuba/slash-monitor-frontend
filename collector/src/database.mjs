import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class OffenseRepository {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.migrate();
    this.prepareStatements();
  }

  migrate() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) {
      throw new Error(`Collector database schema ${version} is newer than this binary supports`);
    }
    if (version === 0) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE offenses (
          id TEXT PRIMARY KEY,
          sequencer TEXT NOT NULL,
          amount TEXT NOT NULL,
          offense_type INTEGER NOT NULL,
          offense_type_name TEXT NOT NULL,
          epoch_or_slot TEXT NOT NULL,
          time_unit TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          withdrawn_at INTEGER,
          observation_count INTEGER NOT NULL DEFAULT 1,
          reactivation_count INTEGER NOT NULL DEFAULT 0,
          missed_polls INTEGER NOT NULL DEFAULT 0,
          last_poll_sequence INTEGER NOT NULL
        );
        CREATE INDEX offenses_status_last_seen_idx ON offenses(status, last_seen_at DESC);
        CREATE INDEX offenses_sequencer_idx ON offenses(sequencer, last_seen_at DESC);
        CREATE TABLE sync_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          last_attempt_at INTEGER,
          last_success_at INTEGER,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          successful_polls INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
        INSERT INTO sync_state(singleton) VALUES (1);
        PRAGMA user_version = 2;
        COMMIT;
      `);
    }
    if (version === 1) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE offenses RENAME COLUMN validator TO sequencer;
        DROP INDEX offenses_validator_idx;
        CREATE INDEX offenses_sequencer_idx ON offenses(sequencer, last_seen_at DESC);
        PRAGMA user_version = 2;
        COMMIT;
      `);
    }
  }

  prepareStatements() {
    this.findInternal = this.db.prepare('SELECT status FROM offenses WHERE id = ?');
    this.upsertOffense = this.db.prepare(`
      INSERT INTO offenses (
        id, sequencer, amount, offense_type, offense_type_name, epoch_or_slot, time_unit,
        status, first_seen_at, last_seen_at, withdrawn_at, observation_count,
        reactivation_count, missed_polls, last_poll_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, 1, 0, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        sequencer = excluded.sequencer,
        amount = excluded.amount,
        offense_type_name = excluded.offense_type_name,
        time_unit = excluded.time_unit,
        last_seen_at = excluded.last_seen_at,
        withdrawn_at = NULL,
        observation_count = offenses.observation_count + 1,
        reactivation_count = offenses.reactivation_count + CASE WHEN offenses.status = 'withdrawn' THEN 1 ELSE 0 END,
        missed_polls = 0,
        last_poll_sequence = excluded.last_poll_sequence,
        status = 'active'
    `);
    this.incrementMissed = this.db.prepare(`
      UPDATE offenses
      SET missed_polls = missed_polls + 1
      WHERE status = 'active' AND last_poll_sequence < ?
    `);
    this.withdrawMissed = this.db.prepare(`
      UPDATE offenses
      SET status = 'withdrawn', withdrawn_at = ?
      WHERE status = 'active' AND missed_polls >= ?
    `);
    this.updateAttempt = this.db.prepare('UPDATE sync_state SET last_attempt_at = ? WHERE singleton = 1');
    this.updateFailure = this.db.prepare(`
      UPDATE sync_state
      SET last_attempt_at = ?, consecutive_failures = consecutive_failures + 1, last_error = ?
      WHERE singleton = 1
    `);
    this.updateSuccess = this.db.prepare(`
      UPDATE sync_state
      SET last_attempt_at = ?, last_success_at = ?, consecutive_failures = 0,
          successful_polls = ?, last_error = NULL
      WHERE singleton = 1
    `);
    this.readSyncState = this.db.prepare(`
      SELECT last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt,
             consecutive_failures AS consecutiveFailures, successful_polls AS successfulPolls,
             last_error AS lastError
      FROM sync_state WHERE singleton = 1
    `);
    this.countByStatus = this.db.prepare('SELECT status, COUNT(*) AS count FROM offenses GROUP BY status');
    this.getByIdStatement = this.db.prepare(`${PUBLIC_SELECT} WHERE id = ?`);
  }

  recordAttempt(at = Date.now()) {
    this.updateAttempt.run(at);
  }

  recordFailure(error, at = Date.now()) {
    this.updateFailure.run(at, String(error).slice(0, 1_000));
  }

  recordSuccessfulPoll(offenses, { observedAt = Date.now(), withdrawAfterMissedPolls = 3 } = {}) {
    const state = this.getSyncState();
    const sequence = state.successfulPolls + 1;
    let inserted = 0;
    let reactivated = 0;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const offense of offenses) {
        const existing = this.findInternal.get(offense.id);
        if (!existing) {
          inserted += 1;
        } else if (existing.status === 'withdrawn') {
          reactivated += 1;
        }
        this.upsertOffense.run(
          offense.id,
          offense.sequencer,
          offense.amount,
          offense.offenseType,
          offense.offenseTypeName,
          offense.epochOrSlot,
          offense.timeUnit,
          observedAt,
          observedAt,
          sequence,
        );
      }

      this.incrementMissed.run(sequence);
      const withdrawalResult = this.withdrawMissed.run(observedAt, withdrawAfterMissedPolls);
      this.updateSuccess.run(observedAt, observedAt, sequence);
      this.db.exec('COMMIT');
      return {
        sequence,
        observed: offenses.length,
        inserted,
        reactivated,
        withdrawn: Number(withdrawalResult.changes),
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getSyncState() {
    return this.readSyncState.get();
  }

  getCounts() {
    const counts = { active: 0, withdrawn: 0, total: 0 };
    for (const row of this.countByStatus.all()) {
      counts[row.status] = Number(row.count);
      counts.total += Number(row.count);
    }
    return counts;
  }

  listOffenses({ status = 'active', sequencers = [], limit = 100, offset = 0 } = {}) {
    const { where, parameters } = buildFilters(status, sequencers);
    const statement = this.db.prepare(`${PUBLIC_SELECT}${where} ORDER BY last_seen_at DESC, id ASC LIMIT ? OFFSET ?`);
    const rows = statement.all(...parameters, limit, offset);
    return rows.map(toPublicOffense);
  }

  countOffenses({ status = 'active', sequencers = [] } = {}) {
    const { where, parameters } = buildFilters(status, sequencers);
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM offenses${where}`).get(...parameters);
    return Number(row.count);
  }

  getOffense(id) {
    const row = this.getByIdStatement.get(id);
    return row ? toPublicOffense(row) : undefined;
  }

  close() {
    this.db.close();
  }
}

const PUBLIC_SELECT = `
  SELECT id, sequencer, amount, offense_type AS offenseType, offense_type_name AS offenseTypeName,
         epoch_or_slot AS epochOrSlot, time_unit AS timeUnit, status,
         first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, withdrawn_at AS withdrawnAt,
         observation_count AS observationCount, reactivation_count AS reactivationCount,
         missed_polls AS missedPolls
  FROM offenses
`;

function toPublicOffense(row) {
  return {
    id: row.id,
    sequencer: row.sequencer,
    amount: row.amount,
    offenseType: row.offenseType,
    offenseTypeName: row.offenseTypeName,
    epochOrSlot: row.epochOrSlot,
    timeUnit: row.timeUnit,
    status: row.status,
    firstSeenAt: toIso(row.firstSeenAt),
    lastSeenAt: toIso(row.lastSeenAt),
    withdrawnAt: toIso(row.withdrawnAt),
    observationCount: row.observationCount,
    reactivationCount: row.reactivationCount,
    missedPolls: row.missedPolls,
  };
}

function toIso(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

function buildFilters(status, sequencers) {
  if (!['active', 'withdrawn', 'all'].includes(status)) {
    throw new Error('status must be active, withdrawn, or all');
  }
  const clauses = [];
  const parameters = [];
  if (status !== 'all') {
    clauses.push('status = ?');
    parameters.push(status);
  }
  if (sequencers.length > 0) {
    clauses.push(`sequencer IN (${sequencers.map(() => '?').join(', ')})`);
    parameters.push(...sequencers);
  }
  return {
    where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    parameters,
  };
}
