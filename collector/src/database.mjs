import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  CRITICAL_DELIVERY_LIFETIME_MS,
  WARNING_DELIVERY_LIFETIME_MS,
} from './delivery-policy.mjs';

const SCHEMA_VERSION = 1;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_WATCHLISTS = 50_000;
const MAX_UNCONNECTED_WATCHLISTS = 1_000;
const MAX_DELIVERY_ENDPOINTS = 100_000;
const MAX_UNVERIFIED_ENDPOINTS = 2_000;

export const NOTIFICATION_TEST_COOLDOWN_MS = 60_000;
export const NOTIFICATION_TEST_RETENTION_MS = 7 * DAY_MS;
export const CATCHUP_EVENT_RETENTION_MS = 30 * DAY_MS;
export const TERMINAL_DELIVERY_RETENTION_MS = 30 * DAY_MS;
export const TELEGRAM_TOKEN_RETENTION_MS = DAY_MS;
export const DELIVERY_OVERDUE_AFTER_MS = 5 * 60_000;
export const DELIVERY_FAILURE_HEALTH_WINDOW_MS = HOUR_MS;
export const UNVERIFIED_ENDPOINT_RETENTION_MS = DAY_MS;
export const CATCHUP_REPLAY_COOLDOWN_MS = 60_000;
export const CATCHUP_SCAN_COOLDOWN_MS = 5_000;

export class NotificationTestCooldownError extends Error {
  constructor(retryAfterMs) {
    super('A notification test was already queued for this subscription; try again shortly');
    this.name = 'NotificationTestCooldownError';
    this.retryAfterMs = Math.max(1, Math.ceil(Number(retryAfterMs)));
  }
}

export class OffenseRepository {
  constructor(databasePath, {
    maxWatchlists = MAX_WATCHLISTS,
    maxUnconnectedWatchlists = MAX_UNCONNECTED_WATCHLISTS,
    maxDeliveryEndpoints = MAX_DELIVERY_ENDPOINTS,
    maxUnverifiedEndpoints = MAX_UNVERIFIED_ENDPOINTS,
  } = {}) {
    this.capacity = {
      maxWatchlists,
      maxUnconnectedWatchlists,
      maxDeliveryEndpoints,
      maxUnverifiedEndpoints,
    };
    for (const [name, value] of Object.entries(this.capacity)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
    }
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = FULL');
      this.db.exec('PRAGMA foreign_keys = ON');
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.initializeSchema();
      this.prepareStatements();
      this.enqueueUnverifiedWebPushChecks();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  initializeSchema() {
    const version = Number(this.db.prepare('PRAGMA user_version').get().user_version);
    if (version === SCHEMA_VERSION) {
      const currentSchema = this.db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN ('offenses', 'watchlists', 'events', 'deliveries')
      `).get().count === 4;
      const offenseColumns = currentSchema
        ? this.db.prepare('PRAGMA table_info(offenses)').all().map((column) => column.name)
        : [];
      if (currentSchema && offenseColumns.includes('sequencer')) return;
      throw new Error(`Slashmon requires an empty database; found unsupported schema ${version}`);
    }
    const tableCount = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).get().count);
    if (version !== 0 || tableCount !== 0) {
      throw new Error(`Slashmon requires an empty database; found unsupported schema ${version}`);
    }

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

      CREATE TABLE source_state (
        source TEXT PRIMARY KEY,
        last_attempt_at INTEGER,
        last_success_at INTEGER,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        successful_polls INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_block_number TEXT,
        last_block_hash TEXT,
        metadata_json TEXT
      );
      INSERT INTO source_state(source) VALUES ('l1'), ('telegram');

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        observed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_replayed_at INTEGER
      );
      CREATE INDEX events_network_cursor_idx ON events(network, observed_at DESC, id DESC);
      CREATE TABLE event_targets (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        sequencer TEXT NOT NULL,
        PRIMARY KEY(event_id, sequencer)
      );
      CREATE INDEX event_targets_sequencer_idx ON event_targets(sequencer, event_id);

      CREATE TABLE watchlists (
        id TEXT PRIMARY KEY,
        management_token_hash TEXT NOT NULL,
        network TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_test_at INTEGER,
        unconnected_since INTEGER
      );
      CREATE INDEX watchlists_created_idx ON watchlists(created_at);
      CREATE TABLE watchlist_addresses (
        watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
        sequencer TEXT NOT NULL,
        PRIMARY KEY(watchlist_id, sequencer)
      );
      CREATE INDEX watchlist_addresses_match_idx ON watchlist_addresses(sequencer, watchlist_id);

      CREATE TABLE delivery_endpoints (
        id TEXT PRIMARY KEY,
        watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('web_push', 'telegram')),
        destination TEXT NOT NULL,
        config_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        verified_at INTEGER,
        last_catchup_at INTEGER,
        UNIQUE(kind, destination)
      );
      CREATE INDEX delivery_endpoints_watchlist_idx ON delivery_endpoints(watchlist_id, kind);
      CREATE INDEX delivery_endpoints_verification_idx ON delivery_endpoints(verified_at, created_at);

      CREATE TABLE deliveries (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        endpoint_id TEXT NOT NULL REFERENCES delivery_endpoints(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        lease_expires_at INTEGER,
        last_attempt_at INTEGER,
        sent_at INTEGER,
        provider_message_id TEXT,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(event_id, endpoint_id)
      );
      CREATE INDEX deliveries_due_idx ON deliveries(status, next_attempt_at, created_at);
      CREATE INDEX deliveries_endpoint_status_idx ON deliveries(endpoint_id, status);
      CREATE INDEX deliveries_status_lease_idx ON deliveries(status, lease_expires_at);
      CREATE INDEX deliveries_status_updated_idx ON deliveries(status, updated_at);

      CREATE TABLE telegram_link_tokens (
        token_hash TEXT PRIMARY KEY,
        watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        consumed_at INTEGER,
        consumed_chat_id TEXT
      );
      CREATE INDEX telegram_link_expiry_idx ON telegram_link_tokens(expires_at);
      CREATE TABLE telegram_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        update_offset INTEGER
      );
      INSERT INTO telegram_state(singleton) VALUES (1);

      CREATE TABLE onchain_rounds (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        block_number TEXT NOT NULL,
        block_hash TEXT NOT NULL,
        stack_role TEXT NOT NULL,
        slasher_address TEXT NOT NULL,
        proposer_address TEXT NOT NULL,
        round TEXT NOT NULL,
        status TEXT NOT NULL,
        ballot_count TEXT NOT NULL,
        is_executed INTEGER NOT NULL CHECK (is_executed IN (0, 1)),
        is_vetoed INTEGER NOT NULL CHECK (is_vetoed IN (0, 1)),
        payload_address TEXT,
        actions_json TEXT NOT NULL,
        committees_json TEXT NOT NULL,
        early_targets_json TEXT NOT NULL DEFAULT '[]',
        details_json TEXT NOT NULL,
        transition_generation INTEGER NOT NULL DEFAULT 0,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(network, proposer_address, round)
      );
      CREATE INDEX onchain_rounds_network_status_idx ON onchain_rounds(network, status, last_seen_at DESC);

      CREATE TABLE l1_slash_logs (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
        network TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        rollup_address TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        sequencer TEXT NOT NULL,
        amount TEXT NOT NULL,
        canonical INTEGER NOT NULL DEFAULT 1 CHECK (canonical IN (0, 1)),
        reconfirmation_count INTEGER NOT NULL DEFAULT 0,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(chain_id, block_hash, transaction_hash, log_index)
      );
      CREATE INDEX l1_slash_logs_target_idx
        ON l1_slash_logs(network, sequencer, canonical, block_number DESC);
      CREATE INDEX l1_slash_logs_canonical_block_idx
        ON l1_slash_logs(network, canonical, block_number);

      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  prepareStatements() {
    this.findInternal = this.db.prepare(`
      SELECT id, sequencer, amount, offense_type AS offenseType,
             offense_type_name AS offenseTypeName, epoch_or_slot AS epochOrSlot,
             time_unit AS timeUnit, status, missed_polls AS missedPolls
      FROM offenses WHERE id = ?
    `);
    this.upsertOffense = this.db.prepare(`
      INSERT INTO offenses (
        id, sequencer, amount, offense_type, offense_type_name, epoch_or_slot, time_unit,
        status, first_seen_at, last_seen_at, withdrawn_at, observation_count,
        reactivation_count, missed_polls, last_poll_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, 1, 0, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        sequencer = excluded.sequencer,
        amount = excluded.amount,
        offense_type = excluded.offense_type,
        offense_type_name = excluded.offense_type_name,
        epoch_or_slot = excluded.epoch_or_slot,
        time_unit = excluded.time_unit,
        last_seen_at = excluded.last_seen_at,
        withdrawn_at = NULL,
        observation_count = offenses.observation_count + 1,
        reactivation_count = offenses.reactivation_count + CASE WHEN offenses.status = 'withdrawn' THEN 1 ELSE 0 END,
        missed_polls = 0,
        last_poll_sequence = excluded.last_poll_sequence,
        status = 'active'
    `);
    this.listMissingOffenses = this.db.prepare(`
      SELECT id, sequencer, amount, offense_type AS offenseType,
        offense_type_name AS offenseTypeName, epoch_or_slot AS epochOrSlot,
        time_unit AS timeUnit, missed_polls AS missedPolls
      FROM offenses WHERE status = 'active' AND last_poll_sequence < ?
    `);
    this.incrementOneMissed = this.db.prepare(`
      UPDATE offenses SET missed_polls = missed_polls + 1
      WHERE id = ? AND status = 'active'
    `);
    this.updateAttempt = this.db.prepare('UPDATE sync_state SET last_attempt_at = ? WHERE singleton = 1');
    this.updateFailure = this.db.prepare(`
      UPDATE sync_state SET last_attempt_at = ?, consecutive_failures = consecutive_failures + 1, last_error = ?
      WHERE singleton = 1
    `);
    this.updateSuccess = this.db.prepare(`
      UPDATE sync_state SET last_attempt_at = ?, last_success_at = ?, consecutive_failures = 0,
        successful_polls = ?, last_error = NULL WHERE singleton = 1
    `);
    this.readSyncState = this.db.prepare(`
      SELECT last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt,
        consecutive_failures AS consecutiveFailures, successful_polls AS successfulPolls,
        last_error AS lastError FROM sync_state WHERE singleton = 1
    `);
    this.countByStatus = this.db.prepare('SELECT status, COUNT(*) AS count FROM offenses GROUP BY status');
    this.getByIdStatement = this.db.prepare(`${PUBLIC_OFFENSE_SELECT} WHERE id = ?`);
  }

  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recordAttempt(at = Date.now()) {
    this.updateAttempt.run(at);
  }

  recordFailure(error, at = Date.now()) {
    this.updateFailure.run(at, truncateError(error));
  }

  recordSuccessfulPoll(offenses, {
    observedAt = Date.now(),
    withdrawAfterMissedPolls = 3,
    network = 'mainnet',
    absenceEvidence,
    syncCursor,
    degradedError,
  } = {}) {
    return this.transaction(() => {
      // Read the sequence under the same write lock as the snapshot. This keeps
      // two collector processes from assigning the same successful-poll number.
      const sequence = this.getSyncState().successfulPolls + 1;
      const result = {
        sequence,
        observed: offenses.length,
        inserted: 0,
        updated: 0,
        reactivated: 0,
        withdrawn: 0,
        events: 0,
      };
      for (const offense of offenses) {
        const existing = this.findInternal.get(offense.id);
        let eventType;
        if (!existing) {
          result.inserted += 1;
          eventType = 'pending_offense_detected';
        } else if (existing.status === 'withdrawn') {
          result.reactivated += 1;
          eventType = 'pending_offense_reactivated';
        } else if (
          existing.amount !== offense.amount ||
          existing.offenseType !== offense.offenseType ||
          existing.offenseTypeName !== offense.offenseTypeName ||
          existing.epochOrSlot !== offense.epochOrSlot ||
          existing.timeUnit !== offense.timeUnit
        ) {
          result.updated += 1;
          eventType = 'pending_offense_updated';
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
        if (eventType) {
          const timing = pendingOffenseTiming(offense, this.getSourceState('l1')?.metadata);
          const insertion = this.insertEvent(
            pendingEvent(eventType, offense, network, observedAt, undefined, timing),
            [offense.sequencer],
          );
          result.events += Number(insertion.inserted);
        }
      }

      const missing = hasAdvancingAbsenceEvidence(absenceEvidence)
        ? this.listMissingOffenses.all(sequence)
        : [];
      for (const offense of missing) {
        if (!canAdvanceAbsence(offense, absenceEvidence)) continue;
        this.incrementOneMissed.run(offense.id);
        if (Number(offense.missedPolls) + 1 < withdrawAfterMissedPolls) continue;
        this.db.prepare(`
          UPDATE offenses SET status = 'withdrawn', withdrawn_at = ? WHERE id = ? AND status = 'active'
        `).run(observedAt, offense.id);
        result.withdrawn += 1;
      }
      if (syncCursor !== undefined) {
        this.ensureSource('aztec_sync');
        this.db.prepare(`
          UPDATE source_state SET metadata_json = ? WHERE source = 'aztec_sync'
        `).run(JSON.stringify(syncCursor));
      }
      if (degradedError) {
        this.updateFailure.run(observedAt, truncateError(degradedError));
        result.degraded = true;
        result.error = truncateError(degradedError);
      } else {
        this.updateSuccess.run(observedAt, observedAt, sequence);
      }
      return result;
    });
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
    const { where, parameters } = buildOffenseFilters(status, sequencers);
    return this.db.prepare(`${PUBLIC_OFFENSE_SELECT}${where} ORDER BY last_seen_at DESC, id ASC LIMIT ? OFFSET ?`)
      .all(...parameters, limit, offset)
      .map(toPublicOffense);
  }

  countOffenses({ status = 'active', sequencers = [] } = {}) {
    const { where, parameters } = buildOffenseFilters(status, sequencers);
    return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM offenses${where}`).get(...parameters).count);
  }

  getOffense(id) {
    const row = this.getByIdStatement.get(id);
    return row ? toPublicOffense(row) : undefined;
  }

  ensureSource(source) {
    this.db.prepare('INSERT OR IGNORE INTO source_state(source) VALUES (?)').run(source);
  }

  bindRuntimeIdentity(identity) {
    const normalized = normalizeRuntimeIdentity(identity);
    return this.transaction(() => {
      const row = this.db.prepare(`
        SELECT metadata_json AS metadataJson FROM source_state WHERE source = 'runtime_identity'
      `).get();
      if (!row) {
        this.db.prepare(`
          INSERT INTO source_state(source, metadata_json) VALUES ('runtime_identity', ?)
        `).run(JSON.stringify(normalized));
        return normalized;
      }

      let existing;
      try {
        existing = normalizeRuntimeIdentity(JSON.parse(row.metadataJson));
      } catch {
        throw new Error('Slashmon database runtime identity is missing or corrupt');
      }
      if (
        existing.network !== normalized.network ||
        existing.chainId !== normalized.chainId ||
        existing.registryAddress !== normalized.registryAddress
      ) {
        throw new Error(
          `Slashmon database is bound to ${existing.network} chain ${existing.chainId} Registry ${existing.registryAddress}; ` +
          `refusing ${normalized.network} chain ${normalized.chainId} Registry ${normalized.registryAddress}`,
        );
      }
      return existing;
    });
  }

  recordSourceAttempt(source, at = Date.now()) {
    this.ensureSource(source);
    this.db.prepare('UPDATE source_state SET last_attempt_at = ? WHERE source = ?').run(at, source);
  }

  recordSourceFailure(source, error, at = Date.now()) {
    this.ensureSource(source);
    this.db.prepare(`
      UPDATE source_state SET last_attempt_at = ?, consecutive_failures = consecutive_failures + 1,
        last_error = ? WHERE source = ?
    `).run(at, truncateError(error), source);
  }

  recordSourceSuccess(source, metadata = {}, at = Date.now()) {
    this.ensureSource(source);
    this.db.prepare(`
      UPDATE source_state SET last_attempt_at = ?, last_success_at = ?, consecutive_failures = 0,
        successful_polls = successful_polls + 1, last_error = NULL,
        metadata_json = ? WHERE source = ?
    `).run(at, at, JSON.stringify(metadata ?? {}), source);
  }

  getSourceState(source) {
    const row = this.db.prepare(`
      SELECT source, last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt,
        consecutive_failures AS consecutiveFailures, successful_polls AS successfulPolls,
        last_error AS lastError, last_block_number AS lastBlockNumber,
        last_block_hash AS lastBlockHash, metadata_json AS metadataJson
      FROM source_state WHERE source = ?
    `).get(source);
    if (!row) return undefined;
    return { ...row, metadata: parseJson(row.metadataJson, {}) };
  }

  recordEvent(event, targets = []) {
    return this.transaction(() => this.insertEvent(event, targets));
  }

  insertEvent(event, targets = [], directEndpointIds = undefined) {
    const observedAt = Number(event.observedAt ?? Date.now());
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        id, network, source, type, severity, title, body, data_json, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.network,
      event.source,
      event.type,
      event.severity,
      event.title,
      event.body,
      JSON.stringify(event.data ?? {}),
      observedAt,
      Number(event.createdAt ?? observedAt),
    );
    if (Number(result.changes) === 0) return { inserted: false, queued: 0 };

    const normalizedTargets = [...new Set(targets.map((value) => String(value).toLowerCase()))];
    const insertTarget = this.db.prepare('INSERT OR IGNORE INTO event_targets(event_id, sequencer) VALUES (?, ?)');
    for (const target of normalizedTargets) insertTarget.run(event.id, target);

    let endpointRows;
    if (directEndpointIds) {
      endpointRows = directEndpointIds.length === 0 ? [] : this.db.prepare(`
        SELECT endpoint.id FROM delivery_endpoints endpoint
        WHERE endpoint.enabled = 1
          AND endpoint.id IN (${directEndpointIds.map(() => '?').join(',')})
      `).all(...directEndpointIds);
    } else if (normalizedTargets.length > 0) {
      endpointRows = this.db.prepare(`
        SELECT DISTINCT endpoint.id
        FROM delivery_endpoints endpoint
        JOIN watchlists watchlist ON watchlist.id = endpoint.watchlist_id
        JOIN watchlist_addresses address ON address.watchlist_id = watchlist.id
        WHERE endpoint.enabled = 1 AND watchlist.network = ?
          AND address.sequencer IN (${normalizedTargets.map(() => '?').join(',')})
      `).all(event.network, ...normalizedTargets);
    } else {
      endpointRows = [];
    }

    let queued = 0;
    const insertDelivery = this.db.prepare(`
      INSERT OR IGNORE INTO deliveries (
        id, event_id, endpoint_id, status, attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
    `);
    for (const endpoint of endpointRows) {
      const deliveryId = stableId('delivery', event.id, endpoint.id);
      queued += Number(insertDelivery.run(deliveryId, event.id, endpoint.id, observedAt, observedAt, observedAt).changes);
    }
    return { inserted: true, queued };
  }

  listEvents({ network, addresses = [], sources = [], cursor, limit = 50 } = {}) {
    // Catch-up rows are endpoint-scoped delivery artifacts. Publishing them in
    // a feed would create duplicate incidents and reveal when somebody linked
    // or reconnected a channel.
    const clauses = ["event.source NOT IN ('test', 'catchup')"];
    const parameters = [];
    if (network) {
      clauses.push('event.network = ?');
      parameters.push(network);
    }
    if (sources.length > 0) {
      clauses.push(`event.source IN (${sources.map(() => '?').join(',')})`);
      parameters.push(...sources);
    }
    let prefix = '';
    let from = 'events event';
    if (addresses.length > 0) {
      // Drive address-scoped reads from (sequencer,event_id), not from the
      // unbounded event timeline with a correlated target probe. A nonexistent
      // attacker-chosen address then returns from the index immediately.
      prefix = `WITH matched_ids AS MATERIALIZED (
        SELECT DISTINCT event_id FROM event_targets INDEXED BY event_targets_sequencer_idx
        WHERE sequencer IN (${addresses.map(() => '?').join(',')})
      )`;
      // CROSS JOIN prevents SQLite from reordering back to a full timeline
      // scan for an address that has no events.
      from = 'matched_ids CROSS JOIN events event ON event.id = matched_ids.event_id';
      parameters.unshift(...addresses.map((value) => value.toLowerCase()));
    }
    const decodedCursor = decodeCursor(cursor);
    if (decodedCursor) {
      clauses.push('(event.observed_at < ? OR (event.observed_at = ? AND event.id < ?))');
      parameters.push(decodedCursor.observedAt, decodedCursor.observedAt, decodedCursor.id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      ${prefix}
      SELECT event.* FROM ${from} ${where}
      ORDER BY event.observed_at DESC, event.id DESC LIMIT ?
    `).all(...parameters, limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const targets = this.loadEventTargets(pageRows.map((row) => row.id));
    const selected = pageRows.map((row) => this.toPublicEvent(row, targets.get(row.id) ?? []));
    const last = rows[Math.min(rows.length, limit) - 1];
    return {
      data: selected,
      nextCursor: hasMore && last ? encodeCursor(last.observed_at, last.id) : null,
    };
  }

  getEvent(id) {
    const row = this.db.prepare(`
      SELECT event.* FROM events event WHERE event.id = ? AND event.source != 'test'
    `).get(id);
    return row ? this.toPublicEvent(row) : undefined;
  }

  loadEventTargets(eventIds) {
    const result = new Map();
    if (eventIds.length === 0) return result;
    const rows = this.db.prepare(`
      SELECT event_id AS eventId, sequencer FROM event_targets
      WHERE event_id IN (${eventIds.map(() => '?').join(',')})
      ORDER BY event_id, sequencer
    `).all(...eventIds);
    for (const row of rows) {
      const targets = result.get(row.eventId) ?? [];
      targets.push(row.sequencer);
      result.set(row.eventId, targets);
    }
    return result;
  }

  toPublicEvent(row, knownTargets) {
    const targets = knownTargets ?? this.db.prepare(`
      SELECT sequencer FROM event_targets WHERE event_id = ? ORDER BY sequencer
    `).all(row.id).map((item) => item.sequencer);
    const data = parseJson(row.data_json, {});
    return {
      id: row.id,
      network: row.network,
      source: row.source,
      type: row.type,
      severity: row.severity,
      title: row.title,
      body: row.body,
      data,
      certainty: data.certainty === 'pending' ? 'pending' : 'confirmed',
      targets,
      sequencer: targets[0] ?? null,
      observedAt: toIso(row.observed_at),
      occurredAt: toIso(row.observed_at),
      createdAt: toIso(row.created_at),
    };
  }

  createWatchlist({ id, managementTokenHash, network, addresses, now = Date.now() }) {
    return this.transaction(() => {
      // Anonymous lists that never connect a channel are cheap to create but
      // should not become permanent storage-amplification debris.
      this.db.prepare(`
        DELETE FROM watchlists
        WHERE unconnected_since < ? AND NOT EXISTS (
          SELECT 1 FROM delivery_endpoints endpoint WHERE endpoint.watchlist_id = watchlists.id
        )
      `).run(now - 24 * 60 * 60_000);
      const total = Number(this.db.prepare('SELECT COUNT(*) AS count FROM watchlists').get().count);
      if (total >= this.capacity.maxWatchlists) return null;
      const unconnected = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM watchlists
        WHERE NOT EXISTS (
          SELECT 1 FROM delivery_endpoints endpoint WHERE endpoint.watchlist_id = watchlists.id
        )
      `).get().count);
      if (unconnected >= this.capacity.maxUnconnectedWatchlists) return null;
      this.db.prepare(`
        INSERT INTO watchlists(
          id, management_token_hash, network, created_at, updated_at, unconnected_since
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, managementTokenHash, network, now, now, now);
      this.replaceWatchlistAddresses(id, addresses);
      return this.getWatchlist(id);
    });
  }

  getWatchlist(id) {
    const row = this.db.prepare(`
      SELECT id, management_token_hash AS managementTokenHash, network,
        created_at AS createdAt, updated_at AS updatedAt FROM watchlists WHERE id = ?
    `).get(id);
    if (!row) return undefined;
    const addresses = this.db.prepare(`
      SELECT sequencer FROM watchlist_addresses WHERE watchlist_id = ? ORDER BY sequencer
    `).all(id).map((item) => item.sequencer);
    const endpoints = this.db.prepare(`
      SELECT id, kind, enabled, verified_at AS verifiedAt,
        created_at AS createdAt, updated_at AS updatedAt
      FROM delivery_endpoints WHERE watchlist_id = ? ORDER BY kind
    `).all(id).map((endpoint) => ({
      ...endpoint,
      enabled: Boolean(endpoint.enabled),
      verified: endpoint.verifiedAt !== null,
    }));
    return { ...row, addresses, endpoints };
  }

  updateWatchlist(id, { addresses, now = Date.now() } = {}) {
    return this.transaction(() => {
      const previous = this.getWatchlist(id);
      if (!previous) return undefined;
      const nextAddresses = addresses === undefined
        ? previous.addresses
        : [...new Set(addresses.map((value) => value.toLowerCase()))].sort();
      const addressesChanged = addresses !== undefined && (
        nextAddresses.length !== previous.addresses.length ||
        nextAddresses.some((value, index) => value !== previous.addresses[index])
      );
      const addedAddresses = addressesChanged
        ? nextAddresses.filter((value) => !previous.addresses.includes(value))
        : [];

      if (addressesChanged) {
        this.db.prepare('UPDATE watchlists SET updated_at = ? WHERE id = ?').run(now, id);
      }
      if (addressesChanged) {
        this.replaceWatchlistAddresses(id, nextAddresses);
        this.discardUnmatchedDeliveries(id);
      }
      // A real scope expansion must not be swallowed by the endpoint-wide scan
      // cooldown: query only the newly added addresses, which keeps random edit
      // churn from replaying incidents for the stable part of the watch list.
      if (addedAddresses.length > 0) {
        this.enqueueCatchupForWatchlist(id, now, {
          addresses: addedAddresses,
          bypassScanCooldown: true,
        });
      }
      return this.getWatchlist(id);
    });
  }

  replaceWatchlistAddresses(id, addresses) {
    this.db.prepare('DELETE FROM watchlist_addresses WHERE watchlist_id = ?').run(id);
    const insert = this.db.prepare('INSERT INTO watchlist_addresses(watchlist_id, sequencer) VALUES (?, ?)');
    for (const address of [...new Set(addresses.map((value) => value.toLowerCase()))]) insert.run(id, address);
  }

  discardUnmatchedDeliveries(watchlistId) {
    this.db.prepare(`
      DELETE FROM deliveries
      WHERE status IN ('pending', 'sending', 'retry')
        AND endpoint_id IN (
          SELECT id FROM delivery_endpoints WHERE watchlist_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM event_targets target WHERE target.event_id = deliveries.event_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM event_targets target
          JOIN watchlist_addresses address ON address.sequencer = target.sequencer
          WHERE target.event_id = deliveries.event_id AND address.watchlist_id = ?
        )
    `).run(watchlistId, watchlistId);
  }

  deleteWatchlist(id) {
    return Number(this.db.prepare('DELETE FROM watchlists WHERE id = ?').run(id).changes) > 0;
  }

  upsertEndpoint({
    watchlistId,
    kind,
    destination,
    configJson = null,
    now = Date.now(),
    allowRebind = false,
  }) {
    return this.transaction(() => this.upsertEndpointInternal({
      watchlistId,
      kind,
      destination,
      configJson,
      now,
      allowRebind,
    }));
  }

  upsertEndpointInternal({ watchlistId, kind, destination, configJson = null, now, allowRebind = false }) {
    const id = stableId('endpoint', kind, destination);
    const existing = this.db.prepare(`
      SELECT id, watchlist_id AS watchlistId, enabled, verified_at AS verifiedAt,
        last_error AS lastError
      FROM delivery_endpoints
      WHERE kind = ? AND destination = ?
    `).get(kind, destination);
    const reboundFromWatchlistId = existing && existing.watchlistId !== watchlistId
      ? existing.watchlistId
      : null;
    if (existing && existing.watchlistId !== watchlistId) {
      if (!allowRebind) return { conflict: true, kind };
      // A Telegram chat or Web Push endpoint can only belong to one watchlist.
      // Never let delivery history from its previous owner cross that boundary.
      this.db.prepare('DELETE FROM deliveries WHERE endpoint_id = ?').run(existing.id);
    }
    const staleEndpoints = this.db.prepare(`
      SELECT id, enabled, verified_at AS verifiedAt, last_error AS lastError
      FROM delivery_endpoints
      WHERE watchlist_id = ? AND kind = ? AND id != ?
    `).all(watchlistId, kind, id);
    const endpointCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM delivery_endpoints').get().count);
    if (!existing && endpointCount - staleEndpoints.length >= this.capacity.maxDeliveryEndpoints) {
      return { capacity: true, kind };
    }
    const willAddUnverified = kind === 'web_push' && !existing;
    if (willAddUnverified) {
      const unverifiedCount = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM delivery_endpoints WHERE verified_at IS NULL
      `).get().count);
      const replacedUnverified = staleEndpoints.filter((endpoint) => endpoint.verifiedAt === null).length;
      if (unverifiedCount - replacedUnverified >= this.capacity.maxUnverifiedEndpoints) {
        return { capacity: true, kind };
      }
    }
    // The API models one endpoint per channel kind for each watchlist. Browser
    // push services rotate destinations. Create the replacement first so live
    // Transfer live outbox work before deleting the stale endpoint.
    this.db.prepare(`
      INSERT INTO delivery_endpoints (
        id, watchlist_id, kind, destination, config_json, enabled, last_error,
        created_at, updated_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)
      ON CONFLICT(kind, destination) DO UPDATE SET
        watchlist_id = excluded.watchlist_id,
        config_json = excluded.config_json,
        enabled = 1,
        last_error = NULL,
        verified_at = COALESCE(delivery_endpoints.verified_at, excluded.verified_at),
        updated_at = excluded.updated_at
    `).run(id, watchlistId, kind, destination, configJson, now, now, kind === 'telegram' ? now : null);
    this.db.prepare(`
      UPDATE watchlists SET unconnected_since = NULL, updated_at = ? WHERE id = ?
    `).run(now, watchlistId);
    if (reboundFromWatchlistId) this.markWatchlistUnconnectedIfEmpty(reboundFromWatchlistId, now);
    const staleEndpointIds = staleEndpoints.map((endpoint) => endpoint.id);
    const activeStaleEndpointIds = staleEndpoints
      .filter((endpoint) => Boolean(endpoint.enabled))
      .map((endpoint) => endpoint.id);
    // Real incident work always follows a rotated destination. Catch-up work
    // follows an active destination too; for a disabled destination, rebuild
    // only the still-current catch-up below so stale and current summaries do
    // not both fire.
    this.transferEndpointDeliveries(staleEndpointIds, id, now, 'non-catchup');
    this.transferEndpointDeliveries(activeStaleEndpointIds, id, now, 'catchup');
    const reconnectEndpoints = staleEndpoints.length > 0
      ? staleEndpoints.filter((endpoint) => !Boolean(endpoint.enabled) && endpoint.lastError)
      : existing?.watchlistId === watchlistId && !Boolean(existing.enabled) && existing.lastError
        ? [existing]
        : [];
    // A provider can permanently reject an endpoint after a one-shot slash or
    // correction has already entered its outbox. Current-state catch-up cannot
    // reconstruct those incidents, so a proven reconnect gets one fresh try
    // while the event is still inside the worker's normal retry lifetime.
    this.recoverFailedUrgentDeliveries(reconnectEndpoints, id, now);
    if (staleEndpoints.length > 0) {
      const placeholders = staleEndpoints.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM delivery_endpoints WHERE id IN (${placeholders})`)
        .run(...staleEndpoints.map((endpoint) => endpoint.id));
    }
    const verified = kind === 'telegram' || (existing?.verifiedAt !== null && existing?.verifiedAt !== undefined);
    // A random syntactically-valid Push URL is not a recipient yet. Real-time
    // incident rows may wait behind its challenge, but state catch-up is only
    // created after a provider has proved the endpoint can receive.
    const catchupQueued = !verified
      ? 0
      : activeStaleEndpointIds.length > 0
      ? 0
      : this.enqueueCatchupForEndpoint(watchlistId, id, now);
    const verificationQueued = kind === 'web_push' && !verified && !this.hasActiveEndpointVerification(id)
      ? this.enqueueEndpointVerification(watchlistId, id, now)
      : 0;
    return {
      id,
      kind,
      enabled: true,
      verified,
      catchupQueued,
      verificationQueued,
    };
  }

  transferEndpointDeliveries(endpointIds, replacementId, now, sourceMode = 'all') {
    if (endpointIds.length === 0) return 0;
    const placeholders = endpointIds.map(() => '?').join(',');
    const sourceClause = sourceMode === 'catchup'
      ? "AND event.source = 'catchup'"
      : sourceMode === 'non-catchup'
        ? "AND event.source NOT IN ('catchup', 'test')"
        : '';
    const rows = this.db.prepare(`
      SELECT delivery.event_id AS eventId, delivery.status, delivery.attempts,
        delivery.next_attempt_at AS nextAttemptAt,
        delivery.last_attempt_at AS lastAttemptAt, delivery.last_error AS lastError,
        delivery.created_at AS createdAt
      FROM deliveries delivery
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.endpoint_id IN (${placeholders})
        AND delivery.status IN ('pending', 'sending', 'retry') ${sourceClause}
      ORDER BY delivery.created_at, delivery.id
    `).all(...endpointIds);
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO deliveries (
        id, event_id, endpoint_id, status, attempts, next_attempt_at,
        lease_expires_at, last_attempt_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `);
    let transferred = 0;
    for (const row of rows) {
      const status = row.status === 'sending' ? 'retry' : row.status;
      const nextAttemptAt = row.status === 'sending' ? now : row.nextAttemptAt;
      transferred += Number(insert.run(
        stableId('delivery', row.eventId, replacementId),
        row.eventId,
        replacementId,
        status,
        row.attempts,
        nextAttemptAt,
        row.lastAttemptAt,
        row.lastError,
        row.createdAt,
        now,
      ).changes);
    }
    return transferred;
  }

  recoverFailedUrgentDeliveries(endpoints, replacementId, now) {
    if (endpoints.length === 0) return 0;
    const endpointIds = endpoints.map((endpoint) => endpoint.id);
    const endpointErrors = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.lastError]));
    const placeholders = endpointIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT delivery.event_id AS eventId, delivery.endpoint_id AS endpointId,
        delivery.last_error AS lastError, delivery.created_at AS createdAt,
        event.network, event.data_json AS eventDataJson
      FROM deliveries delivery
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.endpoint_id IN (${placeholders})
        AND delivery.status = 'failed' AND delivery.sent_at IS NULL
        AND event.source NOT IN ('catchup', 'test')
        AND (
          (event.severity = 'critical' AND event.observed_at > ?)
          OR (event.severity = 'warning' AND event.observed_at > ?)
        )
      ORDER BY delivery.created_at, delivery.id
    `).all(
      ...endpointIds,
      now - CRITICAL_DELIVERY_LIFETIME_MS,
      now - WARNING_DELIVERY_LIFETIME_MS,
    );
    const upsert = this.db.prepare(`
      INSERT INTO deliveries (
        id, event_id, endpoint_id, status, attempts, next_attempt_at,
        lease_expires_at, last_attempt_at, sent_at, provider_message_id,
        last_error, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at,
        lease_expires_at = NULL, last_attempt_at = NULL, sent_at = NULL,
        provider_message_id = NULL, last_error = NULL, updated_at = excluded.updated_at
      WHERE deliveries.status = 'failed' AND deliveries.sent_at IS NULL
    `);
    const currentRoundGeneration = this.db.prepare(`
      SELECT transition_generation AS generation FROM onchain_rounds
      WHERE network = ? AND proposer_address = ? AND round = ?
    `);
    let recovered = 0;
    for (const row of rows) {
      const disabledByThisEndpoint = row.lastError === endpointErrors.get(row.endpointId) ||
        row.lastError === 'Endpoint disabled after a permanent delivery failure';
      // A confirmed-log event can become non-canonical after the provider has
      // already killed this endpoint. Reconnecting must not resurrect the very
      // alert that the reorg correction invalidated.
      const eventData = parseJson(row.eventDataJson, {});
      const proposerAddress = String(eventData.proposerAddress ?? '').toLowerCase();
      const round = eventData.round === undefined ? '' : String(eventData.round);
      const currentGeneration = /^0x[0-9a-f]{40}$/.test(proposerAddress) && round
        ? currentRoundGeneration.get(row.network, proposerAddress, round)
        : undefined;
      const eventGeneration = Number(eventData.forkGeneration ?? 0);
      const supersededRoundView = Boolean(currentGeneration) && Number(currentGeneration.generation) > (
        Number.isSafeInteger(eventGeneration) && eventGeneration >= 0 ? eventGeneration : 0
      );
      if (
        !disabledByThisEndpoint ||
        eventData.canonical === false ||
        supersededRoundView
      ) continue;
      recovered += Number(upsert.run(
        stableId('delivery', row.eventId, replacementId),
        row.eventId,
        replacementId,
        now,
        row.createdAt,
        now,
      ).changes);
    }
    return recovered;
  }

  removeEndpoint(watchlistId, kind, now = Date.now()) {
    return this.transaction(() => {
      const removed = Number(this.db.prepare(`
        DELETE FROM delivery_endpoints WHERE watchlist_id = ? AND kind = ?
      `).run(watchlistId, kind).changes) > 0;
      if (removed) this.markWatchlistUnconnectedIfEmpty(watchlistId, now);
      return removed;
    });
  }

  enqueueEndpointVerification(watchlistId, endpointId, now = Date.now()) {
    const watchlist = this.db.prepare('SELECT network FROM watchlists WHERE id = ?').get(watchlistId);
    if (!watchlist) return 0;
    const event = {
      id: stableId('channel-verification', endpointId, now),
      network: watchlist.network,
      source: 'test',
      type: 'notification_channel_verification',
      severity: 'info',
      title: 'Slashmon wire connected',
      body: 'This private channel passed its delivery check. Alerts are armed.',
      data: { verification: true },
      observedAt: now,
    };
    return this.insertEvent(event, [], [endpointId]).queued;
  }

  hasActiveEndpointVerification(endpointId) {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM deliveries delivery
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.endpoint_id = ?
        AND event.type = 'notification_channel_verification'
        AND delivery.status IN ('pending', 'sending', 'retry')
      LIMIT 1
    `).get(endpointId));
  }

  enqueueUnverifiedWebPushChecks(now = Date.now()) {
    const endpoints = this.db.prepare(`
      SELECT endpoint.id, endpoint.watchlist_id AS watchlistId
      FROM delivery_endpoints endpoint
      WHERE endpoint.kind = 'web_push' AND endpoint.enabled = 1
        AND endpoint.verified_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM deliveries delivery
          JOIN events event ON event.id = delivery.event_id
          WHERE delivery.endpoint_id = endpoint.id
            AND event.type = 'notification_channel_verification'
            AND delivery.status IN ('pending', 'sending', 'retry')
        )
    `).all();
    if (endpoints.length === 0) return 0;
    return this.transaction(() => endpoints.reduce(
      (total, endpoint) => total + this.enqueueEndpointVerification(endpoint.watchlistId, endpoint.id, now),
      0,
    ));
  }

  markWatchlistUnconnectedIfEmpty(watchlistId, now = Date.now()) {
    return Number(this.db.prepare(`
      UPDATE watchlists SET unconnected_since = COALESCE(unconnected_since, ?), updated_at = ?
      WHERE id = ? AND NOT EXISTS (
        SELECT 1 FROM delivery_endpoints endpoint WHERE endpoint.watchlist_id = watchlists.id
      )
    `).run(now, now, watchlistId).changes) > 0;
  }

  enqueueCatchupForWatchlist(watchlistId, now = Date.now(), options = {}) {
    const endpoints = this.db.prepare(`
      SELECT id FROM delivery_endpoints WHERE watchlist_id = ? AND enabled = 1
    `).all(watchlistId);
    let queued = 0;
    for (const endpoint of endpoints) {
      queued += this.enqueueCatchupForEndpoint(watchlistId, endpoint.id, now, options);
    }
    return queued;
  }

  enqueueCatchupForEndpoint(
    watchlistId,
    endpointId,
    now,
    { addresses, bypassScanCooldown = false } = {},
  ) {
    const endpoint = this.db.prepare(`
      SELECT kind, verified_at AS verifiedAt FROM delivery_endpoints WHERE id = ? AND watchlist_id = ?
    `).get(endpointId, watchlistId);
    if (!endpoint || endpoint.verifiedAt === null) return 0;
    const watchlist = this.getWatchlist(watchlistId);
    if (!watchlist || watchlist.addresses.length === 0) return 0;
    const scopedAddresses = addresses === undefined
      ? watchlist.addresses
      : [...new Set(addresses.map((value) => value.toLowerCase()))]
        .filter((value) => watchlist.addresses.includes(value));
    if (scopedAddresses.length === 0) return 0;
    if (!bypassScanCooldown) {
      const scanClaim = this.db.prepare(`
        UPDATE delivery_endpoints SET last_catchup_at = ?
        WHERE id = ? AND watchlist_id = ? AND verified_at IS NOT NULL
          AND (last_catchup_at IS NULL OR last_catchup_at <= ?)
      `).run(now, endpointId, watchlistId, now - CATCHUP_SCAN_COOLDOWN_MS);
      if (Number(scanClaim.changes) === 0) return 0;
    }
    let queued = 0;
    const placeholders = scopedAddresses.map(() => '?').join(',');
    const offenses = this.db.prepare(`
      SELECT id, sequencer, amount, offense_type AS offenseType,
        offense_type_name AS offenseTypeName, epoch_or_slot AS epochOrSlot, time_unit AS timeUnit
      FROM offenses WHERE status = 'active' AND sequencer IN (${placeholders})
    `).all(...scopedAddresses);
    const l1Metadata = this.getSourceState('l1')?.metadata;
    for (const offense of offenses) {
      const event = catchupEvent(pendingEvent(
        'pending_offense_detected',
        offense,
        watchlist.network,
        now,
        undefined,
        pendingOffenseTiming(offense, l1Metadata),
      ), watchlistId, endpoint.kind, watchlist.network, 'pending', offense.id, offense.amount);
      const insertion = this.insertEvent(event, [offense.sequencer], [endpointId]);
      queued += insertion.queued;
      if (!insertion.inserted) queued += this.queueExistingEvent(event.id, endpointId, now);
    }

    const rounds = this.db.prepare(`
      SELECT * FROM onchain_rounds WHERE network = ? AND status NOT IN ('expired', 'archived')
    `).all(watchlist.network);
    for (const row of rounds) {
      const actions = parseJson(row.actions_json, []);
      const earlyTargets = parseJson(row.early_targets_json, []);
      const catchupType = l1CatchupEventType(row, actions, earlyTargets);
      // Execution with an empty tally executes no slash actions. Never turn a
      // prior vote into a false "was included in executed round" alert.
      const targets = catchupType === 'onchain_executed'
        ? actionTargets(actions)
        : roundTargets(actions, earlyTargets);
      if (!targets.some((target) => scopedAddresses.includes(target))) continue;
      const event = catchupEvent(
        onchainEvent(
          catchupType,
          onchainRowToSnapshot(row),
          watchlist.network,
          now,
          { blockNumber: row.block_number, blockHash: row.block_hash },
        ),
        watchlistId,
        endpoint.kind,
        watchlist.network,
        'l1',
        row.id,
        catchupType,
        row.status,
        row.payload_address ?? 'none',
        row.actions_json,
        row.early_targets_json,
        row.details_json,
      );
      const insertion = this.insertEvent(event, targets, [endpointId]);
      queued += insertion.queued;
      if (!insertion.inserted) queued += this.queueExistingEvent(event.id, endpointId, now);
    }
    return queued;
  }

  queueExistingEvent(eventId, endpointId, now) {
    const existing = this.db.prepare(`
      SELECT status FROM deliveries WHERE id = ?
    `).get(stableId('delivery', eventId, endpointId));
    // Never reset live work or provider backoff. If a pause deleted the row,
    // the event-level replay clock still bounds recreation durably.
    if (existing && ['pending', 'sending', 'retry'].includes(existing.status)) return 0;
    const replay = this.db.prepare(`
      UPDATE events SET last_replayed_at = ?
      WHERE id = ? AND source = 'catchup'
        AND (last_replayed_at IS NULL OR last_replayed_at <= ?)
    `).run(now, eventId, now - CATCHUP_REPLAY_COOLDOWN_MS);
    if (Number(replay.changes) === 0) return 0;
    return Number(this.db.prepare(`
      INSERT OR IGNORE INTO deliveries (
        id, event_id, endpoint_id, status, attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at,
        lease_expires_at = NULL, last_attempt_at = NULL, sent_at = NULL,
        provider_message_id = NULL, last_error = NULL, updated_at = excluded.updated_at
      WHERE deliveries.status IN ('sent', 'failed')
    `).run(
      stableId('delivery', eventId, endpointId),
      eventId,
      endpointId,
      now,
      now,
      now,
    ).changes);
  }

  createTelegramLink({ tokenHash, watchlistId, expiresAt, now = Date.now() }) {
    return this.transaction(() => {
      const staleTokenCutoff = now - TELEGRAM_TOKEN_RETENTION_MS;
      this.db.prepare(`
        DELETE FROM telegram_link_tokens
        WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)
      `).run(staleTokenCutoff, staleTokenCutoff);
      // One watchlist, one live invitation. Regeneration revokes the previous
      // link instead of turning a stolen capability into journal amplification
      // or leaving a pile of surprising old links valid for ten minutes.
      this.db.prepare('DELETE FROM telegram_link_tokens WHERE watchlist_id = ?').run(watchlistId);
      this.db.prepare(`
        INSERT INTO telegram_link_tokens(token_hash, watchlist_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(tokenHash, watchlistId, expiresAt, now);
      return { expiresAt };
    });
  }

  consumeTelegramLink(tokenHash, chatId, now = Date.now()) {
    let watchlistId;
    this.transaction(() => {
      const token = this.db.prepare('SELECT * FROM telegram_link_tokens WHERE token_hash = ?').get(tokenHash);
      if (!token || token.expires_at <= now) return;
      if (token.consumed_at !== null && token.consumed_chat_id !== String(chatId)) return;
      // A consumed deep link is idempotent for the original chat, but it must
      // not become a permanent credential that can re-enable or rebind it.
      if (token.consumed_at !== null) {
        const stillLinked = this.db.prepare(`
          SELECT 1 FROM delivery_endpoints
          WHERE watchlist_id = ? AND kind = 'telegram' AND destination = ?
        `).get(token.watchlist_id, String(chatId));
        if (stillLinked) watchlistId = token.watchlist_id;
        return;
      }
      const endpoint = this.upsertEndpointInternal({
        watchlistId: token.watchlist_id,
        kind: 'telegram',
        destination: String(chatId),
        configJson: null,
        now,
        allowRebind: true,
      });
      if (endpoint?.capacity || endpoint?.conflict) return;
      watchlistId = token.watchlist_id;
      this.db.prepare(`
        UPDATE telegram_link_tokens SET consumed_at = ?, consumed_chat_id = ? WHERE token_hash = ?
      `).run(now, String(chatId), tokenHash);
    });
    return watchlistId ? this.getWatchlist(watchlistId) : null;
  }

  getWatchlistByTelegramChat(chatId) {
    const endpoint = this.db.prepare(`
      SELECT watchlist_id AS watchlistId, enabled FROM delivery_endpoints
      WHERE kind = 'telegram' AND destination = ?
    `).get(String(chatId));
    if (!endpoint) return null;
    const watchlist = this.getWatchlist(endpoint.watchlistId);
    return watchlist ? { ...watchlist, telegramEnabled: Boolean(endpoint.enabled) } : null;
  }

  setTelegramEndpointEnabled(chatId, enabled, now = Date.now()) {
    return this.transaction(() => {
      const endpoint = this.db.prepare(`
        SELECT id, watchlist_id AS watchlistId, enabled FROM delivery_endpoints
        WHERE kind = 'telegram' AND destination = ?
      `).get(String(chatId));
      if (!endpoint) return false;
      if (Boolean(endpoint.enabled) === Boolean(enabled)) return true;
      this.db.prepare(`
        UPDATE delivery_endpoints SET enabled = ?, last_error = NULL, updated_at = ? WHERE id = ?
      `).run(enabled ? 1 : 0, now, endpoint.id);
      if (enabled) {
        this.enqueueCatchupForEndpoint(endpoint.watchlistId, endpoint.id, now);
      } else {
        this.db.prepare(`
          DELETE FROM deliveries
          WHERE endpoint_id = ? AND status IN ('pending', 'sending', 'retry')
        `).run(endpoint.id);
      }
      return true;
    });
  }

  deleteTelegramEndpoint(chatId, now = Date.now()) {
    return this.transaction(() => {
      const endpoint = this.db.prepare(`
        SELECT watchlist_id AS watchlistId FROM delivery_endpoints
        WHERE kind = 'telegram' AND destination = ?
      `).get(String(chatId));
      if (!endpoint) return false;
      const removed = Number(this.db.prepare(`
        DELETE FROM delivery_endpoints WHERE kind = 'telegram' AND destination = ?
      `).run(String(chatId)).changes) > 0;
      if (removed) this.markWatchlistUnconnectedIfEmpty(endpoint.watchlistId, now);
      return removed;
    });
  }

  getTelegramOffset() {
    return this.db.prepare('SELECT update_offset AS offset FROM telegram_state WHERE singleton = 1').get().offset ?? undefined;
  }

  setTelegramOffset(offset) {
    this.db.prepare('UPDATE telegram_state SET update_offset = ? WHERE singleton = 1').run(offset);
  }

  enqueueWatchlistTest(
    watchlistId,
    event,
    now = Date.now(),
    { cooldownMs = NOTIFICATION_TEST_COOLDOWN_MS } = {},
  ) {
    return this.transaction(() => {
      const endpoints = this.db.prepare(`
        SELECT endpoint.id FROM delivery_endpoints endpoint
        WHERE endpoint.watchlist_id = ? AND endpoint.enabled = 1
      `).all(watchlistId).map((row) => row.id);
      if (endpoints.length === 0) return 0;

      // Claim the watchlist's test slot under the same write lock as the event
      // and outbox rows. Two API processes therefore cannot race past the
      // cooldown and amplify one subscription into an unbounded journal.
      const claimed = this.db.prepare(`
        UPDATE watchlists SET last_test_at = ?
        WHERE id = ?
          AND (last_test_at IS NULL OR last_test_at <= ?)
      `).run(now, watchlistId, now - cooldownMs);
      if (Number(claimed.changes) === 0) {
        const watchlist = this.db.prepare(`
          SELECT last_test_at AS lastTestAt FROM watchlists WHERE id = ?
        `).get(watchlistId);
        if (watchlist?.lastTestAt !== null && watchlist?.lastTestAt !== undefined) {
          throw new NotificationTestCooldownError(watchlist.lastTestAt + cooldownMs - now);
        }
        return 0;
      }

      return this.insertEvent({ ...event, observedAt: event.observedAt ?? now }, [], endpoints).queued;
    });
  }

  recoverStuckDeliveries(cutoff) {
    return Number(this.db.prepare(`
      UPDATE deliveries SET status = 'retry', next_attempt_at = ?, lease_expires_at = NULL,
        updated_at = ?, last_error = COALESCE(last_error, 'Recovered interrupted delivery')
      WHERE status = 'sending' AND last_attempt_at <= ?
    `).run(cutoff, cutoff, cutoff).changes);
  }

  recoverExpiredDeliveryLeases(now) {
    return Number(this.db.prepare(`
      UPDATE deliveries SET status = 'retry', next_attempt_at = ?, lease_expires_at = NULL,
        updated_at = ?, last_error = COALESCE(last_error, 'Recovered expired delivery lease')
      WHERE status = 'sending' AND lease_expires_at <= ?
    `).run(now, now, now).changes);
  }

  claimDeliveries({ now = Date.now(), limit = 50, leaseMs = 120_000 } = {}) {
    return this.transaction(() => {
      // Startup recovery cannot safely reclaim a lease that has not expired yet.
      // Recheck leases on every poll so an interrupted batch becomes eligible as
      // soon as its lease expires, without requiring another process restart.
      this.recoverExpiredDeliveryLeases(now);
      const rows = this.db.prepare(`
        WITH due AS (
          SELECT delivery.id, delivery.endpoint_id AS endpoint_id,
            delivery.next_attempt_at AS next_attempt_at,
            delivery.created_at AS created_at,
            CASE event.severity
              WHEN 'critical' THEN 0
              WHEN 'warning' THEN 1
              ELSE 2
            END AS severity_priority
          FROM deliveries delivery
          JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
          JOIN events event ON event.id = delivery.event_id
          WHERE delivery.status IN ('pending', 'retry') AND delivery.next_attempt_at <= ?
            AND endpoint.enabled = 1
            AND (endpoint.verified_at IS NOT NULL OR event.source = 'test')
            AND NOT EXISTS (
              SELECT 1 FROM deliveries in_flight
              WHERE in_flight.endpoint_id = delivery.endpoint_id
                AND in_flight.status = 'sending'
            )
        ), ranked AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY endpoint_id
            ORDER BY severity_priority, next_attempt_at, created_at, id
          ) AS endpoint_rank
          FROM due
        )
        SELECT id FROM ranked WHERE endpoint_rank = 1
        ORDER BY severity_priority, next_attempt_at, created_at, id LIMIT ?
      `).all(now, limit);
      const update = this.db.prepare(`
        UPDATE deliveries SET status = 'sending', attempts = attempts + 1,
          last_attempt_at = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?
      `);
      for (const row of rows) update.run(now, now + leaseMs, now, row.id);
      return rows.map((row) => this.getDelivery(row.id));
    });
  }

  getDelivery(id) {
    const row = this.db.prepare(`
      SELECT delivery.id, delivery.endpoint_id AS endpointId, delivery.attempts,
        endpoint.kind, endpoint.destination, endpoint.config_json AS endpointConfig,
        event.id AS eventId, event.network, event.source, event.type, event.severity,
        event.title, event.body, event.data_json AS eventDataJson,
        event.observed_at AS eventObservedAt
      FROM deliveries delivery
      JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.id = ?
    `).get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      endpointId: row.endpointId,
      attempts: row.attempts,
      kind: row.kind,
      destination: row.destination,
      endpointConfig: row.endpointConfig,
      event: {
        id: row.eventId,
        network: row.network,
        source: row.source,
        type: row.type,
        severity: row.severity,
        title: row.title,
        body: row.body,
        data: parseJson(row.eventDataJson, {}),
        observedAt: row.eventObservedAt,
      },
    };
  }

  isDeliverySendable(id) {
    return Boolean(this.db.prepare(`
      SELECT 1
      FROM deliveries delivery
      JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.id = ? AND delivery.status = 'sending'
        AND endpoint.enabled = 1
        AND (endpoint.verified_at IS NOT NULL OR event.source = 'test')
    `).get(id));
  }

  releaseDelivery(id, now = Date.now()) {
    const result = this.db.prepare(`
      UPDATE deliveries SET status = 'retry',
        attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
        next_attempt_at = ?, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'sending'
    `).run(now, now, id);
    return Number(result.changes) > 0;
  }

  completeDelivery(id, providerMessageId, now = Date.now()) {
    return this.transaction(() => {
      const endpoint = this.db.prepare(`
        SELECT endpoint.id, endpoint.watchlist_id AS watchlistId,
          endpoint.verified_at AS verifiedAt
        FROM deliveries delivery
        JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
        WHERE delivery.id = ? AND delivery.status = 'sending'
      `).get(id);
      const result = this.db.prepare(`
        UPDATE deliveries SET status = 'sent', sent_at = ?, provider_message_id = ?,
          lease_expires_at = NULL, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'sending'
      `).run(now, providerMessageId, now, id);
      if (Number(result.changes) > 0 && endpoint?.verifiedAt === null) {
        this.db.prepare(`
          UPDATE delivery_endpoints SET verified_at = ?, last_error = NULL, updated_at = ?
          WHERE id = ? AND verified_at IS NULL
        `).run(now, now, endpoint.id);
        this.enqueueCatchupForEndpoint(endpoint.watchlistId, endpoint.id, now);
      }
      return Number(result.changes) > 0;
    });
  }

  retryDelivery(id, error, nextAttemptAt, now = Date.now()) {
    const result = this.db.prepare(`
      UPDATE deliveries SET status = 'retry', next_attempt_at = ?, lease_expires_at = NULL,
        last_error = ?, updated_at = ? WHERE id = ? AND status = 'sending'
    `).run(nextAttemptAt, truncateError(error), now, id);
    return Number(result.changes) > 0;
  }

  retryDeliveryForChannelFailure(id, channel, error, nextAttemptAt, now = Date.now()) {
    return this.transaction(() => {
      const retried = this.retryDelivery(id, error, nextAttemptAt, now);
      // Channel authentication failed even if the user removed this particular
      // endpoint while the provider request was in flight.
      this.recordSourceFailure(channel, error, now);
      return retried;
    });
  }

  failDelivery(id, error, now = Date.now()) {
    const result = this.db.prepare(`
      UPDATE deliveries SET status = 'failed', lease_expires_at = NULL,
        last_error = ?, updated_at = ? WHERE id = ? AND status = 'sending'
    `).run(truncateError(error), now, id);
    return Number(result.changes) > 0;
  }

  failDeliveryForChannelFailure(id, channel, error, now = Date.now()) {
    return this.transaction(() => {
      const failed = this.failDelivery(id, error, now);
      this.recordSourceFailure(channel, error, now);
      return failed;
    });
  }

  failDeliveryAndDisableEndpoint(id, endpointId, error, now = Date.now()) {
    return this.transaction(() => {
      const failed = this.db.prepare(`
        UPDATE deliveries SET status = 'failed', lease_expires_at = NULL,
          last_error = ?, updated_at = ?
        WHERE id = ? AND endpoint_id = ? AND status = 'sending'
      `).run(truncateError(error), now, id, endpointId);
      // The claim may have been invalidated while its network request was in
      // flight. Never disable an endpoint that has since been rebound/resumed.
      if (Number(failed.changes) === 0) return false;
      this.db.prepare(`
        UPDATE delivery_endpoints SET enabled = 0, last_error = ?, updated_at = ? WHERE id = ?
      `).run(truncateError(error), now, endpointId);
      this.db.prepare(`
        UPDATE deliveries SET status = 'failed', lease_expires_at = NULL,
          last_error = ?, updated_at = ?
        WHERE endpoint_id = ? AND id != ? AND status IN ('pending', 'sending', 'retry')
      `).run('Endpoint disabled after a permanent delivery failure', now, endpointId, id);
      return true;
    });
  }

  getDeliveryCounts() {
    const counts = { pending: 0, sending: 0, retry: 0, sent: 0, failed: 0 };
    for (const row of this.db.prepare('SELECT status, COUNT(*) AS count FROM deliveries GROUP BY status').all()) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  getDeliveryHealthStatus({
    now = Date.now(),
    overdueAfterMs = DELIVERY_OVERDUE_AFTER_MS,
    failureWindowMs = DELIVERY_FAILURE_HEALTH_WINDOW_MS,
  } = {}) {
    const common = `
      JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
      WHERE endpoint.enabled = 1 AND endpoint.verified_at IS NOT NULL
    `;
    const overdue = this.db.prepare(`
      SELECT 1 FROM deliveries delivery ${common}
        AND delivery.status IN ('pending', 'retry') AND delivery.next_attempt_at <= ?
      LIMIT 1
    `).get(now - overdueAfterMs);
    if (overdue) return { status: 'degraded' };
    const expiredLease = this.db.prepare(`
      SELECT 1 FROM deliveries delivery ${common}
        AND delivery.status = 'sending' AND delivery.lease_expires_at <= ?
      LIMIT 1
    `).get(now);
    if (expiredLease) return { status: 'degraded' };
    const recentFailure = this.db.prepare(`
      SELECT 1 FROM deliveries delivery ${common}
        AND delivery.status = 'failed' AND delivery.updated_at >= ?
      LIMIT 1
    `).get(now - failureWindowMs);
    return { status: recentFailure ? 'degraded' : 'healthy' };
  }

  pruneNotificationData({
    now = Date.now(),
    notificationTestRetentionMs = NOTIFICATION_TEST_RETENTION_MS,
    catchupEventRetentionMs = CATCHUP_EVENT_RETENTION_MS,
    terminalDeliveryRetentionMs = TERMINAL_DELIVERY_RETENTION_MS,
    telegramTokenRetentionMs = TELEGRAM_TOKEN_RETENTION_MS,
    abandonedWatchlistRetentionMs = DAY_MS,
    unverifiedEndpointRetentionMs = UNVERIFIED_ENDPOINT_RETENTION_MS,
  } = {}) {
    for (const [name, value] of Object.entries({
      notificationTestRetentionMs,
      catchupEventRetentionMs,
      terminalDeliveryRetentionMs,
      telegramTokenRetentionMs,
      abandonedWatchlistRetentionMs,
      unverifiedEndpointRetentionMs,
    })) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative integer`);
      }
    }

    return this.transaction(() => {
      const staleUnverified = this.db.prepare(`
        SELECT id, watchlist_id AS watchlistId FROM delivery_endpoints
        WHERE verified_at IS NULL AND created_at <= ?
      `).all(now - unverifiedEndpointRetentionMs);
      let unverifiedEndpoints = 0;
      if (staleUnverified.length > 0) {
        const placeholders = staleUnverified.map(() => '?').join(',');
        unverifiedEndpoints = Number(this.db.prepare(`
          DELETE FROM delivery_endpoints WHERE id IN (${placeholders})
        `).run(...staleUnverified.map((endpoint) => endpoint.id)).changes);
        for (const watchlistId of new Set(staleUnverified.map((endpoint) => endpoint.watchlistId))) {
          this.markWatchlistUnconnectedIfEmpty(watchlistId, now);
        }
      }
      const abandonedWatchlists = this.db.prepare(`
        DELETE FROM watchlists
        WHERE unconnected_since <= ? AND NOT EXISTS (
          SELECT 1 FROM delivery_endpoints endpoint WHERE endpoint.watchlist_id = watchlists.id
        )
      `).run(now - abandonedWatchlistRetentionMs);
      // Test and endpoint-scoped catch-up events have no feed history value.
      // Once every associated send is terminal, remove old rows and let the
      // foreign key cascade their outbox. Never prune pending, retrying, or
      // leased work.
      const testEvents = this.db.prepare(`
        DELETE FROM events
        WHERE source = 'test' AND created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM deliveries delivery
            WHERE delivery.event_id = events.id
              AND delivery.status IN ('pending', 'sending', 'retry')
          )
      `).run(now - notificationTestRetentionMs);
      const catchupEvents = this.db.prepare(`
        DELETE FROM events
        WHERE source = 'catchup' AND created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM deliveries delivery
            WHERE delivery.event_id = events.id
              AND delivery.status IN ('pending', 'sending', 'retry')
          )
      `).run(now - catchupEventRetentionMs);
      const terminalDeliveries = this.db.prepare(`
        DELETE FROM deliveries
        WHERE status IN ('sent', 'failed') AND updated_at <= ?
      `).run(now - terminalDeliveryRetentionMs);
      const telegramTokens = this.db.prepare(`
        DELETE FROM telegram_link_tokens
        WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)
      `).run(now - telegramTokenRetentionMs, now - telegramTokenRetentionMs);
      return {
        unverifiedEndpoints,
        abandonedWatchlists: Number(abandonedWatchlists.changes),
        testEvents: Number(testEvents.changes),
        catchupEvents: Number(catchupEvents.changes),
        terminalDeliveries: Number(terminalDeliveries.changes),
        telegramTokens: Number(telegramTokens.changes),
      };
    });
  }

  recordSuccessfulL1Snapshot(network, snapshot, { observedAt = Date.now() } = {}) {
    if (!snapshot || !Array.isArray(snapshot.stacks) || !snapshot.blockHash || snapshot.blockNumber === undefined) {
      throw new Error('Refusing to persist an incomplete L1 snapshot');
    }
    return this.transaction(() => {
      const flattened = [];
      for (const stack of snapshot.stacks) {
        if (!Array.isArray(stack.rounds)) throw new Error('Refusing to persist an incomplete L1 stack');
        for (const round of stack.rounds) flattened.push({ stack, round });
      }
      const seen = new Set();
      const failedStackAddresses = new Set((snapshot.stackErrors ?? [])
        .map((error) => String(error.slasherAddress ?? '').toLowerCase())
        .filter((address) => /^0x[0-9a-f]{40}$/.test(address)));
      const failedRounds = new Map(snapshot.stacks.map((stack) => [
        stack.proposerAddress.toLowerCase(),
        new Set((stack.roundErrors ?? []).map((error) => String(error.round))),
      ]));
      let events = 0;
      let changed = 0;
      for (const item of flattened) {
        const rowId = stableId('l1-round', network, snapshot.chainId, item.stack.proposerAddress.toLowerCase(), item.round.round);
        seen.add(rowId);
        const existing = this.db.prepare('SELECT * FROM onchain_rounds WHERE id = ?').get(rowId);
        const eventType = l1Transition(existing, item.round, snapshot);
        const targets = l1TransitionTargets(existing, item.round, eventType);
        const clearedExecutionTargets = l1ClearedExecutionTargets(existing, item.round);
        const existingDetails = existing ? parseJson(existing.details_json, {}) : {};
        const reorgDrivenTransition = Boolean(
          (eventType || clearedExecutionTargets.length > 0) &&
          (snapshot.reorgDetected || existingDetails.reorgOrphaned),
        );
        const transitionGeneration = Number(existing?.transition_generation ?? 0) +
          Number(reorgDrivenTransition);
        if (!existing || l1RowChanged(existing, item.round, item.stack)) changed += 1;
        this.db.prepare(`
          INSERT INTO onchain_rounds (
            id, network, chain_id, block_number, block_hash, stack_role, slasher_address,
            proposer_address, round, status, ballot_count, is_executed, is_vetoed,
            payload_address, actions_json, early_targets_json, committees_json, details_json,
            transition_generation, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            block_number = excluded.block_number,
            block_hash = excluded.block_hash,
            stack_role = excluded.stack_role,
            slasher_address = excluded.slasher_address,
            status = excluded.status,
            ballot_count = excluded.ballot_count,
            is_executed = excluded.is_executed,
            is_vetoed = excluded.is_vetoed,
            payload_address = excluded.payload_address,
            actions_json = excluded.actions_json,
            early_targets_json = excluded.early_targets_json,
            committees_json = excluded.committees_json,
            details_json = excluded.details_json,
            transition_generation = excluded.transition_generation,
            last_seen_at = excluded.last_seen_at
        `).run(
          rowId,
          network,
          Number(snapshot.chainId),
          snapshot.blockNumber,
          snapshot.blockHash,
          item.stack.role,
          item.stack.slasherAddress.toLowerCase(),
          item.stack.proposerAddress.toLowerCase(),
          item.round.round,
          item.round.status,
          item.round.ballotCount,
          item.round.isExecuted ? 1 : 0,
          item.round.isVetoed ? 1 : 0,
          item.round.payloadAddress?.toLowerCase() ?? null,
          JSON.stringify(item.round.actions ?? []),
          JSON.stringify(item.round.earlyTargets ?? []),
          JSON.stringify(item.round.committees ?? []),
          JSON.stringify({
            targetEpochs: item.round.targetEpochs ?? [],
            executableSlot: item.round.executableSlot,
            expirySlot: item.round.expirySlot,
            l1GenesisTime: snapshot.l1GenesisTime,
            slotDuration: snapshot.slotDuration,
            epochDuration: snapshot.epochDuration,
            currentSlot: snapshot.currentSlot,
            currentEpoch: snapshot.currentEpoch,
            isSlashingEnabled: Boolean(item.stack.isSlashingEnabled),
            isExecutionPaused: Boolean(item.round.isExecutionPaused),
            isProtected: Boolean(item.round.isProtected),
            slashingDisabledUntil: item.stack.slashingDisabledUntil ?? null,
            pauseStartedAtSlot: item.stack.pauseStartedAtSlot ?? null,
            pauseEndsAtSlot: item.stack.pauseEndsAtSlot ?? null,
            parameters: item.stack.parameters,
            readyAt: item.stack.readyAt,
            authorizedUntil: item.stack.authorizedUntil,
            reorgOrphaned: false,
          }),
          transitionGeneration,
          existing?.first_seen_at ?? observedAt,
          observedAt,
        );
        if (eventType && targets.length > 0) {
          const insertion = this.insertEvent(
            onchainEvent(
              eventType,
              { ...item.round, ...item.stack, transitionGeneration },
              network,
              observedAt,
              snapshot,
              reorgDrivenTransition
                ? roundTransitionEventId(network, eventType, rowId, transitionGeneration)
                : undefined,
              targets,
            ),
            targets,
          );
          events += Number(insertion.inserted);
        }
        if (clearedExecutionTargets.length > 0) {
          const insertion = this.insertEvent(
            onchainEvent(
              'onchain_execution_target_cleared',
              { ...item.round, ...item.stack, transitionGeneration },
              network,
              observedAt,
              snapshot,
              reorgDrivenTransition
                ? roundTransitionEventId(
                  network,
                  'onchain_execution_target_cleared',
                  rowId,
                  transitionGeneration,
                )
                : undefined,
              clearedExecutionTargets,
            ),
            clearedExecutionTargets,
          );
          events += Number(insertion.inserted);
        }
      }

      const previousRows = this.db.prepare(`
        SELECT * FROM onchain_rounds WHERE network = ? AND status NOT IN ('expired', 'archived')
      `).all(network);
      for (const old of previousRows) {
        if (seen.has(old.id)) continue;
        // A Slasher's role can change between complete snapshots (most notably
        // active -> legacy during rotation). Match a failed optional scan by
        // immutable Slasher identity, not the role stored on its previous rows,
        // or a transient first legacy scan would falsely expire live rounds.
        if (failedStackAddresses.has(old.slasher_address)) continue;
        if (failedRounds.get(old.proposer_address)?.has(String(old.round))) continue;
        const targets = roundTargets(
          parseJson(old.actions_json, []),
          parseJson(old.early_targets_json, []),
        );
        const nextStatus = old.is_executed ? 'archived' : 'expired';
        const orphanGeneration = Number(old.transition_generation ?? 0) + Number(snapshot.reorgDetected);
        const oldDetails = parseJson(old.details_json, {});
        this.db.prepare(`
          UPDATE onchain_rounds SET status = ?, block_number = ?, block_hash = ?,
            details_json = ?, transition_generation = ?, last_seen_at = ? WHERE id = ?
        `).run(
          nextStatus,
          snapshot.blockNumber,
          snapshot.blockHash,
          JSON.stringify({
            ...oldDetails,
            reorgOrphaned: Boolean(snapshot.reorgDetected),
          }),
          orphanGeneration,
          observedAt,
          old.id,
        );
        changed += 1;
        if (targets.length > 0 && (snapshot.reorgDetected || !old.is_executed)) {
          const type = snapshot.reorgDetected ? 'onchain_reorg_correction' : 'onchain_expired';
          const insertion = this.insertEvent(onchainEvent(
            type,
            {
              ...onchainRowToSnapshot(old),
              status: nextStatus,
              transitionGeneration: orphanGeneration,
            },
            network,
            observedAt,
            snapshot,
            snapshot.reorgDetected
              ? roundTransitionEventId(network, type, old.id, orphanGeneration)
              : undefined,
          ), targets);
          events += Number(insertion.inserted);
        }
      }

      if (snapshot.reorgDetected) {
        const insertion = this.insertEvent({
          id: stableId('event', network, 'l1_reorg_detected', snapshot.blockHash),
          network,
          source: 'ethereum_l1',
          type: 'l1_reorg_detected',
          severity: 'warning',
          title: 'L1 reorg reconciled',
          body: 'Slashmon discarded its old pinned-block view and applied a complete canonical snapshot.',
          data: { blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash },
          observedAt,
        }, []);
        events += Number(insertion.inserted);
      }

      this.ensureSource('l1');
      this.db.prepare(`
        UPDATE source_state SET last_attempt_at = ?, last_success_at = ?, consecutive_failures = 0,
          successful_polls = successful_polls + 1, last_error = ?,
          last_block_number = ?, last_block_hash = ?, metadata_json = ? WHERE source = 'l1'
      `).run(
        observedAt,
        observedAt,
        snapshot.degraded ? 'One or more auxiliary L1 stacks or rounds could not be refreshed' : null,
        snapshot.blockNumber,
        snapshot.blockHash,
        JSON.stringify({
          chainId: snapshot.chainId,
          blockTimestamp: snapshot.blockTimestamp,
          registryAddress: snapshot.registryAddress,
          rollupAddress: snapshot.rollupAddress,
          rollupVersion: snapshot.rollupVersion,
          l1GenesisTime: snapshot.l1GenesisTime,
          slotDuration: snapshot.slotDuration,
          epochDuration: snapshot.epochDuration,
          currentSlot: snapshot.currentSlot,
          currentEpoch: snapshot.currentEpoch,
          degraded: Boolean(snapshot.degraded),
          stackErrors: snapshot.stackErrors ?? [],
          roundCursors: flattened.map(({ stack, round }) => ({
            proposerAddress: stack.proposerAddress.toLowerCase(),
            round: String(round.round),
            ballotCount: String(round.ballotCount),
            earlyTargets: round.earlyTargets ?? [],
          })),
          stacks: snapshot.stacks.map((stack) => ({
            role: stack.role,
            slasherAddress: stack.slasherAddress,
            proposerAddress: stack.proposerAddress,
            currentRound: stack.currentRound,
            isSlashingEnabled: Boolean(stack.isSlashingEnabled),
            slashingDisabledUntil: stack.slashingDisabledUntil ?? null,
            pauseStartedAtSlot: stack.pauseStartedAtSlot ?? null,
            pauseEndsAtSlot: stack.pauseEndsAtSlot ?? null,
            parameters: stack.parameters,
            roundErrors: stack.roundErrors ?? [],
          })),
        }),
      );
      return { changed, events, blockNumber: snapshot.blockNumber };
    });
  }

  recordSuccessfulL1SlashLogChunk(network, chunk, { observedAt = Date.now() } = {}) {
    const normalized = normalizeL1SlashLogChunk(network, chunk);
    return this.transaction(() => {
      this.ensureSource('l1_slash_logs');
      const previousMetadata = this.getSourceState('l1_slash_logs')?.metadata ?? {};
      if (normalized.reorgDetected) {
        // The stored checkpoint is no longer canonical. Invalidate the bounded
        // rewind tail immediately; each replacement chunk re-confirms any logs
        // that still exist before correction events are emitted.
        this.db.prepare(`
          UPDATE l1_slash_logs SET canonical = 0, last_seen_at = ?
          WHERE network = ? AND block_number >= ?
        `).run(observedAt, network, normalized.fromBlock);
      }

      let inserted = 0;
      let queued = 0;
      let reconfirmed = 0;
      for (const slash of normalized.logs) {
        const logId = stableId(
          'l1-slashed-log',
          normalized.chainId,
          slash.blockHash,
          slash.transactionHash,
          slash.logIndex,
        );
        const eventId = stableId('event', network, 'l1_slash_confirmed', logId);
        const existing = this.db.prepare(`
          SELECT * FROM l1_slash_logs
          WHERE chain_id = ? AND block_hash = ? AND transaction_hash = ? AND log_index = ?
        `).get(normalized.chainId, slash.blockHash, slash.transactionHash, slash.logIndex);
        if (existing) {
          if (
            existing.id !== logId ||
            existing.rollup_address !== slash.rollupAddress ||
            existing.block_number !== slash.blockNumber ||
            existing.sequencer !== slash.sequencer ||
            existing.amount !== slash.amount
          ) {
            throw new Error('A persisted Slashed log identity decoded to different contents');
          }
          const wasCanonical = Boolean(existing.canonical);
          const restorationWasAnnounced = !wasCanonical && Boolean(this.db.prepare(`
            SELECT 1 FROM events WHERE id = ?
          `).get(slashReorgCorrectionEventId(
            network,
            existing.id,
            Number(existing.reconfirmation_count),
          )));
          const restorationGeneration = Number(existing.reconfirmation_count) + 1;
          this.db.prepare(`
            UPDATE l1_slash_logs SET canonical = 1, last_seen_at = ?,
              reconfirmation_count = CASE WHEN ? = 1 THEN ? ELSE reconfirmation_count END
            WHERE id = ?
          `).run(
            observedAt,
            restorationWasAnnounced ? 1 : 0,
            restorationGeneration,
            logId,
          );
          setEventCanonicalFlag(this.db, existing.event_id, true, observedAt);
          if (restorationWasAnnounced) {
            const restoration = this.insertEvent(
              slashReconfirmedEvent(
                existing,
                network,
                observedAt,
                normalized,
                restorationGeneration,
              ),
              [existing.sequencer],
            );
            reconfirmed += Number(restoration.inserted);
            queued += restoration.queued;
          }
          continue;
        }

        const eventResult = this.insertEvent(
          confirmedSlashEvent(
            eventId,
            network,
            slash,
            observedAt,
            normalized.initialBackfill,
            normalized.chainId,
          ),
          [slash.sequencer],
        );
        this.db.prepare(`
          INSERT INTO l1_slash_logs (
            id, event_id, network, chain_id, rollup_address, block_number, block_hash,
            transaction_hash, log_index, sequencer, amount, canonical, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
          logId,
          eventId,
          network,
          normalized.chainId,
          slash.rollupAddress,
          slash.blockNumber,
          slash.blockHash,
          slash.transactionHash,
          slash.logIndex,
          slash.sequencer,
          slash.amount,
          observedAt,
          observedAt,
        );
        inserted += 1;
        queued += eventResult.queued;
      }

      let corrections = 0;
      const orphaned = this.db.prepare(`
        SELECT * FROM l1_slash_logs
        WHERE network = ? AND canonical = 0 AND block_number BETWEEN ? AND ?
      `).all(network, normalized.fromBlock, normalized.toBlock);
      for (const slash of orphaned) {
        // Stop unsent work from an orphaned block. A provider-accepted alert
        // cannot be recalled, so follow it with a target-scoped correction.
        this.db.prepare(`
          UPDATE deliveries SET status = 'failed', lease_expires_at = NULL,
            last_error = 'L1 reorg removed the confirmed slash log', updated_at = ?
          WHERE event_id = ? AND status IN ('pending', 'sending', 'retry')
        `).run(observedAt, slash.event_id);
        setEventCanonicalFlag(this.db, slash.event_id, false, observedAt);
        const correction = this.insertEvent(
          slashReorgCorrectionEvent(
            slash,
            network,
            observedAt,
            normalized,
            Number(slash.reconfirmation_count),
          ),
          [slash.sequencer],
        );
        corrections += Number(correction.inserted);
        queued += correction.queued;
      }

      this.db.prepare(`
        UPDATE source_state SET last_attempt_at = ?, last_success_at = ?,
          consecutive_failures = 0, successful_polls = successful_polls + 1,
          last_error = NULL, last_block_number = ?, last_block_hash = ?, metadata_json = ?
        WHERE source = 'l1_slash_logs'
      `).run(
        observedAt,
        observedAt,
        String(normalized.toBlock),
        normalized.toBlockHash,
        JSON.stringify({
          chainId: normalized.chainId,
          registryAddress: normalized.registryAddress,
          confirmedBlockNumber: String(normalized.confirmedBlockNumber),
          lookbackStartBlock: String(
            chunk.initial
              ? normalized.fromBlock
              : previousMetadata.lookbackStartBlock ?? normalized.fromBlock,
          ),
          lastRange: {
            fromBlock: String(normalized.fromBlock),
            toBlock: String(normalized.toBlock),
            logCount: normalized.logs.length,
          },
          rollupAddresses: normalized.rollupAddresses,
          reorgDetected: normalized.reorgDetected,
          caughtUp: !normalized.hasMore,
          initialBackfill: normalized.hasMore && Boolean(
            normalized.initialBackfill || previousMetadata.initialBackfill,
          ),
          degraded: normalized.hasMore,
        }),
      );
      return {
        inserted,
        reconfirmed,
        queued,
        corrections,
        fromBlock: String(normalized.fromBlock),
        toBlock: String(normalized.toBlock),
        hasMore: normalized.hasMore,
        reorgDetected: normalized.reorgDetected,
      };
    });
  }

  listOnchainRounds({ network, limit = 200 } = {}) {
    const rows = this.db.prepare(`
      SELECT * FROM onchain_rounds WHERE network = ? AND status != 'archived'
      ORDER BY last_seen_at DESC, CAST(round AS INTEGER) DESC LIMIT ?
    `).all(network, limit);
    return rows.map((row) => ({
      ...onchainRowToSnapshot(row),
      network: row.network,
      chainId: row.chain_id,
      blockNumber: row.block_number,
      blockHash: row.block_hash,
      firstSeenAt: toIso(row.first_seen_at),
      lastSeenAt: toIso(row.last_seen_at),
      ...parseJson(row.details_json, {}),
    }));
  }

  close() {
    this.db.close();
  }
}

const PUBLIC_OFFENSE_SELECT = `
  SELECT id, sequencer, amount, offense_type AS offenseType, offense_type_name AS offenseTypeName,
    epoch_or_slot AS epochOrSlot, time_unit AS timeUnit, status,
    first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, withdrawn_at AS withdrawnAt,
    observation_count AS observationCount, reactivation_count AS reactivationCount,
    missed_polls AS missedPolls FROM offenses
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

function buildOffenseFilters(status, sequencers) {
  if (!['active', 'withdrawn', 'all'].includes(status)) throw new Error('status must be active, withdrawn, or all');
  const clauses = [];
  const parameters = [];
  if (status !== 'all') {
    clauses.push('status = ?');
    parameters.push(status);
  }
  if (sequencers.length > 0) {
    clauses.push(`sequencer IN (${sequencers.map(() => '?').join(',')})`);
    parameters.push(...sequencers.map((value) => value.toLowerCase()));
  }
  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', parameters };
}

function pendingEvent(type, offense, network, observedAt, explicitId, timing = {}) {
  const copy = pendingEventCopy(type, offense);
  return {
    id: explicitId ?? stableId('event', network, type, offense.id, observedAt, offense.amount),
    network,
    source: 'aztec_node',
    type,
    severity: 'warning',
    title: copy.title,
    body: copy.body,
    data: {
      offenseId: offense.id,
      sequencer: offense.sequencer,
      amount: String(offense.amount),
      offenseType: offense.offenseType,
      offenseTypeName: offense.offenseTypeName,
      epochOrSlot: String(offense.epochOrSlot),
      timeUnit: offense.timeUnit,
      ...timing,
      certainty: 'pending',
    },
    observedAt,
  };
}

function pendingEventCopy(type, offense) {
  const label = String(offense.offenseTypeName ?? 'unknown').replaceAll('_', ' ');
  const position = offense.timeUnit && offense.epochOrSlot !== undefined
    ? `${offense.timeUnit} ${offense.epochOrSlot}`
    : 'an unknown position';
  const address = shortAddress(offense.sequencer);
  return {
    pending_offense_detected: {
      title: `${capitalize(label)} offense detected`,
      body: `Aztec node reported ${address} for ${position}; this is not yet an L1 action.`,
    },
    pending_offense_reactivated: {
      title: `${capitalize(label)} offense returned`,
      body: `Aztec node reported ${address} again for ${position}; this is not yet an L1 action.`,
    },
    pending_offense_updated: {
      title: `${capitalize(label)} offense changed`,
      body: `Aztec node changed its ${label} signal for ${address} at ${position}.`,
    },
  }[type];
}

function onchainEventCopy(type, round, targets) {
  const role = round.role ?? round.stackRole ?? 'active';
  const roundNumber = String(round.round);
  const targetText = targets.length === 1
    ? `1 sequencer (${shortAddress(targets[0])})`
    : `${targets.length} sequencers`;
  const execution = round.executableSlot === null || round.executableSlot === undefined
    ? ''
    : ` Execution window opens at slot ${round.executableSlot}${round.executableAt ? ` (${round.executableAt})` : ''}.`;
  const config = {
    onchain_vote_targeted: ['warning', 'L1 slash vote observed', `${targetText} received at least one vote in ${role} round ${roundNumber}; no slash payload is implied.`],
    onchain_targeted: ['warning', 'Slashing payload proposed', `${targetText} entered the payload for ${role} round ${roundNumber}.${execution}`],
    onchain_payload_changed: ['critical', 'Slashing payload changed', `The slash action changed for ${targetText} in ${role} round ${roundNumber}; prior veto state does not carry over.${execution}`],
    onchain_executable: ['critical', 'Slashing is executable', `${targetText} can now be slashed from ${role} round ${roundNumber}.`],
    onchain_executable_after_pause: ['critical', 'Slashing queued behind global pause', `${targetText} is in round ${roundNumber}'s execution window, but the global pause currently blocks it.`],
    onchain_execution_paused: ['warning', 'Slashing temporarily paused', `${role} round ${roundNumber} remains live, but the global pause currently blocks execution.`],
    onchain_pause_protected: ['info', 'Round protected through expiry', `${targetText} is in ${role} round ${roundNumber}, but the scheduled pause lasts through its expiry.`],
    onchain_vetoed: ['info', 'Slashing payload vetoed', `The current payload for ${role} round ${roundNumber} was vetoed.`],
    onchain_veto_reverted: ['critical', 'Slashing veto no longer applies', `The current payload for ${role} round ${roundNumber} is not vetoed.`],
    onchain_executed: ['critical', 'Slashing executed', `${targetText} was included in executed ${role} round ${roundNumber}.`],
    onchain_execution_target_cleared: ['info', 'Executed tally cleared prior target', `${targetText} was targeted earlier in ${role} round ${roundNumber}, but not in its executed tally.`],
    onchain_expired: ['info', 'Slashing round expired', `${role} round ${roundNumber} expired without executing.`],
    onchain_reorg_correction: ['warning', 'L1 slashing view corrected', `An L1 reorg removed or changed prior targeting in ${role} round ${roundNumber}.`],
    onchain_reorg_restored: ['critical', 'L1 slashing target restored', `${targetText} returned to ${role} round ${roundNumber}'s canonical L1 view.`],
  }[type];
  return { severity: config[0], title: config[1], body: config[2] };
}

function pendingOffenseTiming(offense, l1Metadata) {
  const activeStack = l1Metadata?.stacks?.find((stack) => stack.role === 'active');
  const parameters = activeStack?.parameters;
  if (!['epoch', 'slot'].includes(offense.timeUnit)) return {};
  try {
    const epochDuration = BigInt(l1Metadata?.epochDuration);
    const roundSize = BigInt(parameters?.roundSize);
    const slashOffset = BigInt(parameters?.slashOffsetInRounds);
    const epochOrSlot = BigInt(offense.epochOrSlot);
    if (epochDuration <= 0n || roundSize <= 0n || slashOffset < 0n || epochOrSlot < 0n) return {};
    const slot = offense.timeUnit === 'epoch' ? epochOrSlot * epochDuration : epochOrSlot;
    const epoch = offense.timeUnit === 'epoch' ? epochOrSlot : slot / epochDuration;
    const offenseRound = slot / roundSize;
    return {
      epoch: epoch.toString(),
      slot: slot.toString(),
      offenseRound: offenseRound.toString(),
      proposalRound: (offenseRound + slashOffset).toString(),
    };
  } catch {
    return {};
  }
}

function slotTimestamp(slot, ...sources) {
  if (slot === null || slot === undefined) return null;
  const source = sources.find((candidate) =>
    candidate?.l1GenesisTime !== null && candidate?.l1GenesisTime !== undefined &&
    candidate?.slotDuration !== null && candidate?.slotDuration !== undefined
  );
  if (!source) return null;
  try {
    const seconds = BigInt(source.l1GenesisTime) + BigInt(slot) * BigInt(source.slotDuration);
    const milliseconds = seconds * 1_000n;
    if (milliseconds < 0n || milliseconds > 8_640_000_000_000_000n) return null;
    return new Date(Number(milliseconds)).toISOString();
  } catch {
    return null;
  }
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function catchupEvent(event, ...identity) {
  return {
    ...event,
    id: stableId('catchup-event', ...identity),
    source: 'catchup',
    data: {
      ...event.data,
      originSource: event.source,
      catchup: true,
    },
  };
}

function l1Transition(existing, round, snapshot) {
  const hasActions = Array.isArray(round.actions) && round.actions.length > 0;
  const hasEarlyTargets = Array.isArray(round.earlyTargets) && round.earlyTargets.length > 0;
  const timeExecutable = ['newly-executable', 'executable'].includes(round.status);
  const executionAlertable = hasActions && round.isAuthorized !== false && timeExecutable && !round.isVetoed;
  if (!existing) {
    if (!hasActions && !hasEarlyTargets) return undefined;
    if (round.isExecuted) return 'onchain_executed';
    if (round.isVetoed) return 'onchain_vetoed';
    if (executionAlertable) {
      if (round.isProtected) return 'onchain_pause_protected';
      if (round.isExecutionPaused) return 'onchain_executable_after_pause';
      return 'onchain_executable';
    }
    return hasActions ? 'onchain_targeted' : 'onchain_vote_targeted';
  }
  const oldActions = parseJson(existing.actions_json, []);
  const oldEarlyTargets = parseJson(existing.early_targets_json, []);
  const oldDetails = parseJson(existing.details_json, {});
  const oldTimeExecutable = ['newly-executable', 'executable'].includes(existing.status);
  const oldExecutionPaused = Boolean(oldDetails.isExecutionPaused);
  const oldProtected = Boolean(oldDetails.isProtected);
  const actionsChanged = JSON.stringify(round.actions ?? []) !== JSON.stringify(oldActions);
  const payloadChanged = (round.payloadAddress?.toLowerCase() ?? null) !== existing.payload_address;
  const oldTargets = new Set(roundTargets(oldActions, oldEarlyTargets));
  const newTargets = new Set(roundTargets(round.actions ?? [], round.earlyTargets ?? []));
  const targetingRemoved = [...oldTargets].some((target) => !newTargets.has(target));
  const executionReverted = Boolean(existing.is_executed) && !round.isExecuted;
  const executionWindowReverted = ['newly-executable', 'executable'].includes(existing.status) &&
    !['newly-executable', 'executable', 'executed'].includes(round.status);

  // Execution is terminal and must never be hidden by a simultaneous payload
  // transition (for example when the process skipped the quorum snapshot).
  if (round.isExecuted && !existing.is_executed) return 'onchain_executed';
  if (oldDetails.reorgOrphaned && (hasActions || hasEarlyTargets)) {
    return 'onchain_reorg_restored';
  }
  if (
    snapshot?.reorgDetected &&
    (payloadChanged || actionsChanged || targetingRemoved || executionReverted || executionWindowReverted)
  ) {
    return 'onchain_reorg_correction';
  }
  if (round.isVetoed && !existing.is_vetoed) return 'onchain_vetoed';
  if (!round.isVetoed && existing.is_vetoed) return 'onchain_veto_reverted';
  // A scheduled pause and permanent protection-through-expiry are different.
  // Warn immediately when a round survives the pause, then escalate again when
  // execution actually becomes possible. A veto always wins over these states.
  if (executionAlertable && !round.isExecutionPaused && (!oldTimeExecutable || oldExecutionPaused)) {
    return 'onchain_executable';
  }
  if (hasActions && oldActions.length === 0) return 'onchain_targeted';
  if (oldActions.length > 0 && (payloadChanged || actionsChanged)) return 'onchain_payload_changed';
  if (executionAlertable && round.isProtected && (!oldTimeExecutable || !oldProtected)) {
    return 'onchain_pause_protected';
  }
  if (executionAlertable && round.isExecutionPaused && !round.isProtected) {
    if (!oldTimeExecutable || oldProtected) return 'onchain_executable_after_pause';
    if (!oldExecutionPaused) return 'onchain_execution_paused';
  }
  const oldEarlyTargetAddresses = new Set(oldEarlyTargets.map((target) => target.sequencer?.toLowerCase()));
  if ((round.earlyTargets ?? []).some((target) => !oldEarlyTargetAddresses.has(target.sequencer?.toLowerCase()))) {
    return 'onchain_vote_targeted';
  }
  return undefined;
}

function l1TransitionTargets(existing, round, type) {
  if (!type) return [];
  if (type === 'onchain_executed') return actionTargets(round.actions ?? []);
  if (type === 'onchain_vote_targeted') {
    const oldTargets = new Set(
      existing ? parseJson(existing.early_targets_json, []).map((target) => target.sequencer?.toLowerCase()) : [],
    );
    const added = (round.earlyTargets ?? [])
      .map((target) => target.sequencer?.toLowerCase())
      .filter((target) => target && !oldTargets.has(target));
    return [...new Set(added)];
  }
  if (existing && type === 'onchain_payload_changed') {
    return changedActionTargets(
      parseJson(existing.actions_json, []),
      round.actions ?? [],
    );
  }
  if (existing && type === 'onchain_reorg_correction') {
    return roundTargets(
      [
        ...parseJson(existing.actions_json, []),
        ...(round.actions ?? []),
      ],
      [
        ...parseJson(existing.early_targets_json, []),
        ...(round.earlyTargets ?? []),
      ],
    );
  }
  const actionAddresses = actionTargets(round.actions ?? []);
  return actionAddresses.length > 0 ? actionAddresses : roundTargets([], round.earlyTargets ?? []);
}

function changedActionTargets(previousActions, nextActions) {
  const previousAmounts = actionAmountsByTarget(previousActions);
  const nextAmounts = actionAmountsByTarget(nextActions);
  return [...new Set([...previousAmounts.keys(), ...nextAmounts.keys()])]
    .filter((target) => previousAmounts.get(target) !== nextAmounts.get(target))
    .sort();
}

function actionAmountsByTarget(actions) {
  const amounts = new Map();
  for (const action of actions ?? []) {
    const target = String(action.sequencer ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(target)) continue;
    amounts.set(target, String(action.amount));
  }
  return amounts;
}

function l1ClearedExecutionTargets(existing, round) {
  if (!existing || Boolean(existing.is_executed) || !round.isExecuted) return [];
  const previouslyTargeted = roundTargets(
    parseJson(existing.actions_json, []),
    parseJson(existing.early_targets_json, []),
  );
  const executedTargets = new Set(actionTargets(round.actions ?? []));
  return previouslyTargeted.filter((target) => !executedTargets.has(target));
}

function l1CatchupEventType(row, actions, earlyTargets) {
  const details = parseJson(row.details_json, {});
  if (row.is_executed) return 'onchain_executed';
  if (row.is_vetoed) return 'onchain_vetoed';
  if (['newly-executable', 'executable'].includes(row.status) && actions.length > 0) {
    if (details.isProtected) return 'onchain_pause_protected';
    if (details.isExecutionPaused) return 'onchain_executable_after_pause';
    return 'onchain_executable';
  }
  if (actions.length > 0) return 'onchain_targeted';
  if (earlyTargets.length > 0) return 'onchain_vote_targeted';
  return 'onchain_targeted';
}

function onchainEvent(type, round, network, observedAt, snapshot, explicitId, explicitTargets) {
  const targets = explicitTargets ?? (type === 'onchain_executed'
    ? actionTargets(round.actions ?? [])
    : roundTargets(round.actions ?? [], round.earlyTargets ?? []));
  const role = round.role ?? round.stackRole ?? 'active';
  const executableSlot = round.executableSlot ?? null;
  const expirySlot = round.expirySlot ?? null;
  const executableAt = slotTimestamp(executableSlot, round, snapshot);
  const expiryAt = slotTimestamp(expirySlot, round, snapshot);
  const copy = onchainEventCopy(type, {
    ...round,
    role,
    executableSlot,
    executableAt,
    expirySlot,
    expiryAt,
  }, targets);
  const payload = round.payloadAddress ?? null;
  return {
    id: explicitId ?? stableId('event', network, type, round.proposerAddress ?? '', round.round, payload ?? '', snapshot.blockHash),
    network,
    source: 'ethereum_l1',
    type,
    severity: copy.severity,
    title: copy.title,
    body: copy.body,
    data: {
      certainty: 'confirmed',
      chainId: snapshot.chainId ?? round.chainId ?? null,
      role,
      round: String(round.round),
      targetEpochs: round.targetEpochs ?? [],
      currentSlot: snapshot.currentSlot ?? round.currentSlot ?? null,
      currentEpoch: snapshot.currentEpoch ?? round.currentEpoch ?? null,
      executableSlot,
      executableAt,
      expirySlot,
      expiryAt,
      proposerAddress: round.proposerAddress,
      slasherAddress: round.slasherAddress,
      payloadAddress: payload,
      status: round.status,
      isVetoed: Boolean(round.isVetoed),
      isExecuted: Boolean(round.isExecuted),
      isSlashingEnabled: round.isSlashingEnabled !== false,
      isExecutionPaused: Boolean(round.isExecutionPaused),
      isProtected: Boolean(round.isProtected),
      pauseStartedAtSlot: round.pauseStartedAtSlot ?? null,
      pauseEndsAtSlot: round.pauseEndsAtSlot ?? null,
      actions: round.actions ?? [],
      earlyTargets: round.earlyTargets ?? [],
      forkGeneration: round.transitionGeneration ?? null,
      blockNumber: snapshot.blockNumber,
      blockHash: snapshot.blockHash,
    },
    observedAt,
  };
}

function confirmedSlashEvent(id, network, slash, observedAt, backfilled = false, chainId = null) {
  return {
    id,
    network,
    source: 'ethereum_l1',
    type: 'l1_slash_confirmed',
    severity: 'critical',
    title: backfilled ? 'Historical L1 slash found' : 'Sequencer slashed on L1',
    body: backfilled
      ? `Historical scan found that ${shortAddress(slash.sequencer)} was slashed for ${slash.amount} stake base units in a confirmed L1 block.`
      : `${shortAddress(slash.sequencer)} was slashed for ${slash.amount} stake base units in a confirmed L1 block.`,
    data: {
      certainty: 'confirmed',
      chainId,
      sequencer: slash.sequencer,
      amount: slash.amount,
      rollupAddress: slash.rollupAddress,
      blockNumber: String(slash.blockNumber),
      blockHash: slash.blockHash,
      transactionHash: slash.transactionHash,
      logIndex: slash.logIndex,
      canonical: true,
      backfilled,
    },
    observedAt,
  };
}

function slashReorgCorrectionEvent(slash, network, observedAt, chunk, generation) {
  return {
    id: slashReorgCorrectionEventId(network, slash.id, generation),
    network,
    source: 'ethereum_l1',
    type: 'l1_slash_reorged',
    severity: 'warning',
    title: 'L1 slash confirmation reorged out',
    body: `The earlier confirmed slash log for ${shortAddress(slash.sequencer)} is no longer on the canonical L1 chain.`,
    data: {
      certainty: 'confirmed',
      chainId: slash.chain_id,
      correction: true,
      canonical: false,
      forkGeneration: generation,
      originalSlashEventId: slash.event_id,
      sequencer: slash.sequencer,
      amount: slash.amount,
      rollupAddress: slash.rollup_address,
      blockNumber: String(slash.block_number),
      blockHash: slash.block_hash,
      transactionHash: slash.transaction_hash,
      logIndex: slash.log_index,
      replacementCheckpoint: {
        blockNumber: String(chunk.toBlock),
        blockHash: chunk.toBlockHash,
      },
    },
    observedAt,
  };
}

function slashReorgCorrectionEventId(network, slashId, generation) {
  return stableId('event', network, 'l1_slash_reorged', slashId, generation);
}

function slashReconfirmedEvent(slash, network, observedAt, chunk, generation) {
  return {
    id: stableId('event', network, 'l1_slash_reconfirmed', slash.id, generation),
    network,
    source: 'ethereum_l1',
    type: 'l1_slash_reconfirmed',
    severity: 'critical',
    title: 'L1 slash confirmation restored',
    body: `The slash log for ${shortAddress(slash.sequencer)} returned to the canonical L1 chain after a reorg correction.`,
    data: {
      certainty: 'confirmed',
      chainId: slash.chain_id,
      restoration: true,
      canonical: true,
      forkGeneration: generation,
      originalSlashEventId: slash.event_id,
      sequencer: slash.sequencer,
      amount: slash.amount,
      rollupAddress: slash.rollup_address,
      blockNumber: String(slash.block_number),
      blockHash: slash.block_hash,
      transactionHash: slash.transaction_hash,
      logIndex: slash.log_index,
      restorationCheckpoint: {
        blockNumber: String(chunk.toBlock),
        blockHash: chunk.toBlockHash,
      },
    },
    observedAt,
  };
}

function l1RowChanged(row, round, stack) {
  const details = parseJson(row.details_json, {});
  return row.status !== round.status ||
    row.ballot_count !== round.ballotCount ||
    Boolean(row.is_executed) !== Boolean(round.isExecuted) ||
    Boolean(row.is_vetoed) !== Boolean(round.isVetoed) ||
    row.payload_address !== (round.payloadAddress?.toLowerCase() ?? null) ||
    row.stack_role !== stack.role ||
    Boolean(details.isSlashingEnabled) !== Boolean(stack.isSlashingEnabled) ||
    Boolean(details.isExecutionPaused) !== Boolean(round.isExecutionPaused) ||
    Boolean(details.isProtected) !== Boolean(round.isProtected) ||
    (details.pauseStartedAtSlot ?? null) !== (stack.pauseStartedAtSlot ?? null) ||
    (details.pauseEndsAtSlot ?? null) !== (stack.pauseEndsAtSlot ?? null) ||
    row.actions_json !== JSON.stringify(round.actions ?? []) ||
    row.early_targets_json !== JSON.stringify(round.earlyTargets ?? []);
}

function onchainRowToSnapshot(row) {
  return {
    ...parseJson(row.details_json, {}),
    id: row.id,
    chainId: row.chain_id,
    role: row.stack_role,
    stackRole: row.stack_role,
    slasherAddress: row.slasher_address,
    proposerAddress: row.proposer_address,
    round: row.round,
    status: row.status,
    ballotCount: row.ballot_count,
    isExecuted: Boolean(row.is_executed),
    isVetoed: Boolean(row.is_vetoed),
    payloadAddress: row.payload_address,
    actions: parseJson(row.actions_json, []),
    earlyTargets: parseJson(row.early_targets_json, []),
    committees: parseJson(row.committees_json, []),
  };
}

function actionTargets(actions) {
  return [...new Set((actions ?? []).map((action) =>
    String(action.sequencer ?? action.validator ?? '').toLowerCase()
  ).filter((value) => /^0x[0-9a-f]{40}$/.test(value)))];
}

function roundTargets(actions, earlyTargets) {
  return [...new Set([
    ...actionTargets(actions),
    ...(earlyTargets ?? []).map((target) => String(target.sequencer ?? '').toLowerCase()),
  ].filter((value) => /^0x[0-9a-f]{40}$/.test(value)))];
}

function stableId(...parts) {
  return createHash('sha256').update(parts.map(String).join('|')).digest('hex');
}

function roundTransitionEventId(network, type, roundId, generation) {
  return stableId('event', network, type, roundId, 'reorg-generation', generation);
}

function shortAddress(address) {
  const value = String(address);
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function truncateError(error) {
  return String(error).slice(0, 1_000);
}

function normalizeRuntimeIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('Runtime identity must be an object');
  }
  if (!['mainnet', 'testnet'].includes(identity.network)) {
    throw new Error('Runtime identity network must be mainnet or testnet');
  }
  if (!Number.isSafeInteger(identity.chainId) || identity.chainId < 1) {
    throw new Error('Runtime identity chainId must be a positive integer');
  }
  if (
    typeof identity.registryAddress !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(identity.registryAddress) ||
    /^0x0{40}$/i.test(identity.registryAddress)
  ) {
    throw new Error('Runtime identity registryAddress must be a nonzero 20-byte hex address');
  }
  return {
    network: identity.network,
    chainId: identity.chainId,
    registryAddress: identity.registryAddress.toLowerCase(),
  };
}

function normalizeL1SlashLogChunk(network, chunk) {
  if (!['mainnet', 'testnet'].includes(network)) throw new Error('Slash log network is invalid');
  if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
    throw new Error('Refusing to persist an incomplete L1 slash log chunk');
  }
  if (!Number.isSafeInteger(chunk.chainId) || chunk.chainId < 1) {
    throw new Error('L1 slash log chainId is invalid');
  }
  const fromBlock = safeBlockNumber(chunk.fromBlock, 'fromBlock');
  const toBlock = safeBlockNumber(chunk.toBlock, 'toBlock');
  const confirmedBlockNumber = safeBlockNumber(chunk.confirmedBlockNumber, 'confirmedBlockNumber');
  if (fromBlock > toBlock || toBlock > confirmedBlockNumber) {
    throw new Error('L1 slash log chunk has an invalid block range');
  }
  const toBlockHash = normalizeHash(chunk.toBlockHash, 'checkpoint block hash');
  const registryAddress = normalizeHexAddress(chunk.registryAddress, 'Registry address');
  if (!Array.isArray(chunk.rollupAddresses) || chunk.rollupAddresses.length > 256) {
    throw new Error('L1 slash log chunk has an invalid Rollup emitter set');
  }
  const rollupAddresses = [...new Set(chunk.rollupAddresses.map((value) =>
    normalizeHexAddress(value, 'Rollup address')
  ))].sort();
  const allowedRollups = new Set(rollupAddresses);
  if (!Array.isArray(chunk.logs)) throw new Error('L1 slash log chunk logs must be an array');
  if (chunk.logs.length > 0 && rollupAddresses.length === 0) {
    throw new Error('L1 slash log chunk with logs has no Registry-resolved emitter');
  }
  const logs = chunk.logs.map((log) => {
    if (!log || typeof log !== 'object' || Array.isArray(log)) throw new Error('L1 Slashed log is invalid');
    const blockNumber = safeBlockNumber(log.blockNumber, 'Slashed log blockNumber');
    if (blockNumber < fromBlock || blockNumber > toBlock) throw new Error('L1 Slashed log is outside its chunk');
    const rollupAddress = normalizeHexAddress(log.rollupAddress, 'Slashed log Rollup');
    if (!allowedRollups.has(rollupAddress)) throw new Error('L1 Slashed log emitter was not Registry-resolved');
    const sequencer = normalizeHexAddress(log.sequencer, 'Slashed log sequencer');
    if (!Number.isSafeInteger(log.logIndex) || log.logIndex < 0) throw new Error('Slashed log index is invalid');
    if (!/^\d+$/.test(String(log.amount))) throw new Error('Slashed log amount is invalid');
    return {
      rollupAddress,
      blockNumber,
      blockHash: normalizeHash(log.blockHash, 'Slashed log block hash'),
      transactionHash: normalizeHash(log.transactionHash, 'Slashed log transaction hash'),
      logIndex: log.logIndex,
      sequencer,
      amount: String(log.amount),
    };
  });
  return {
    chainId: chunk.chainId,
    fromBlock,
    toBlock,
    confirmedBlockNumber,
    toBlockHash,
    registryAddress,
    rollupAddresses,
    logs,
    reorgDetected: Boolean(chunk.reorgDetected),
    hasMore: Boolean(chunk.hasMore),
    initialBackfill: Boolean(chunk.initialBackfill),
  };
}

function safeBlockNumber(value, label) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is out of range`);
  return Number(parsed);
}

function normalizeHash(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value`);
  }
  return value.toLowerCase();
}

function normalizeHexAddress(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} must be a nonzero 20-byte hex address`);
  }
  return value.toLowerCase();
}

function canAdvanceAbsence(offense, evidence) {
  const cursor = evidence?.[offense.timeUnit];
  if (!cursor?.advanced || typeof cursor.value !== 'string') return false;
  try {
    return BigInt(cursor.value) >= BigInt(offense.epochOrSlot);
  } catch {
    return false;
  }
}

function hasAdvancingAbsenceEvidence(evidence) {
  return Boolean(evidence?.slot?.advanced || evidence?.epoch?.advanced);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function setEventCanonicalFlag(database, eventId, canonical, observedAt) {
  const row = database.prepare('SELECT data_json AS dataJson FROM events WHERE id = ?').get(eventId);
  if (!row) throw new Error('Persisted Slashed log is missing its event');
  const data = parseJson(row.dataJson, {});
  data.canonical = canonical;
  if (canonical) delete data.reorgedAt;
  else data.reorgedAt = new Date(observedAt).toISOString();
  database.prepare('UPDATE events SET data_json = ? WHERE id = ?').run(JSON.stringify(data), eventId);
}

function encodeCursor(observedAt, id) {
  return Buffer.from(`${observedAt}|${id}`).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    const observedAt = Number(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!Number.isSafeInteger(observedAt) || !id) return undefined;
    return { observedAt, id };
  } catch {
    return undefined;
  }
}

function toIso(value) {
  return value === null || value === undefined ? null : new Date(Number(value)).toISOString();
}
