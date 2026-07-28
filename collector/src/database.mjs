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
export const NOTIFICATION_TEST_COOLDOWN_MS = 5 * 60_000;
export const NOTIFICATION_TEST_RETENTION_MS = 7 * DAY_MS;
export const TERMINAL_DELIVERY_RETENTION_MS = 30 * DAY_MS;
export const TELEGRAM_TOKEN_RETENTION_MS = DAY_MS;
export const DELIVERY_OVERDUE_AFTER_MS = 5 * 60_000;
export const DELIVERY_FAILURE_HEALTH_WINDOW_MS = HOUR_MS;
export const UNVERIFIED_ENDPOINT_RETENTION_MS = DAY_MS;
export const FACT_RETENTION_MS = 180 * DAY_MS;

export class NotificationRateLimitError extends Error {
  constructor(code, message, retryAfterMs) {
    super(message);
    this.name = 'NotificationRateLimitError';
    this.code = code;
    this.retryAfterMs = Math.max(1, Math.ceil(Number(retryAfterMs)));
  }
}

export class NotificationTestCooldownError extends NotificationRateLimitError {
  constructor(retryAfterMs) {
    super(
      'notification_test_cooldown',
      'A notification test was already queued for this watchlist; try again shortly',
      retryAfterMs,
    );
    this.name = 'NotificationTestCooldownError';
  }
}

export class SlashmonRepository {
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
      const expectedTables = [
        'deliveries',
        'delivery_endpoints',
        'event_targets',
        'events',
        'l1_slash_logs',
        'offenses',
        'onchain_rounds',
        'slash_outcomes',
        'source_state',
        'sync_state',
        'telegram_link_tokens',
        'telegram_state',
        'watchlist_addresses',
        'watchlists',
      ];
      const actualTables = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all().map((row) => row.name);
      const offenseColumns = actualTables.includes('offenses')
        ? this.db.prepare('PRAGMA table_info(offenses)').all().map((column) => column.name)
        : [];
      if (
        JSON.stringify(actualTables) === JSON.stringify(expectedTables) &&
        offenseColumns.includes('validator') &&
        offenseColumns.includes('penalty') &&
        offenseColumns.includes('resolved_at')
      ) return;
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
        validator TEXT NOT NULL,
        penalty TEXT NOT NULL,
        offense_type INTEGER NOT NULL,
        offense_type_name TEXT NOT NULL,
        epoch_or_slot TEXT NOT NULL,
        time_unit TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        resolved_at INTEGER,
        observation_count INTEGER NOT NULL DEFAULT 1,
        reactivation_count INTEGER NOT NULL DEFAULT 0,
        missed_polls INTEGER NOT NULL DEFAULT 0,
        last_poll_sequence INTEGER NOT NULL
      );
      CREATE INDEX offenses_status_last_seen_idx ON offenses(status, last_seen_at DESC);
      CREATE INDEX offenses_validator_idx ON offenses(validator, last_seen_at DESC);

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
        incident_id TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        observed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX events_network_cursor_idx ON events(network, observed_at DESC, id DESC);
      CREATE TABLE event_targets (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        validator TEXT NOT NULL,
        PRIMARY KEY(event_id, validator)
      );
      CREATE INDEX event_targets_validator_idx ON event_targets(validator, event_id);

      CREATE TABLE watchlists (
        id TEXT PRIMARY KEY,
        management_token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_test_at INTEGER,
        unconnected_since INTEGER
      );
      CREATE INDEX watchlists_created_idx ON watchlists(created_at);
      CREATE TABLE watchlist_addresses (
        watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
        validator TEXT NOT NULL,
        PRIMARY KEY(watchlist_id, validator)
      );
      CREATE INDEX watchlist_addresses_match_idx ON watchlist_addresses(validator, watchlist_id);

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
        details_json TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(network, proposer_address, round)
      );
      CREATE INDEX onchain_rounds_network_status_idx ON onchain_rounds(network, status, last_seen_at DESC);

      CREATE TABLE l1_slash_logs (
        id TEXT PRIMARY KEY,
        outcome_id TEXT NOT NULL REFERENCES slash_outcomes(id) ON DELETE CASCADE,
        network TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        rollup_address TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        validator TEXT NOT NULL,
        amount TEXT NOT NULL,
        canonical INTEGER NOT NULL DEFAULT 1 CHECK (canonical IN (0, 1)),
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(chain_id, block_hash, transaction_hash, log_index)
      );
      CREATE INDEX l1_slash_logs_target_idx
        ON l1_slash_logs(network, validator, canonical, block_number DESC);
      CREATE INDEX l1_slash_logs_canonical_block_idx
        ON l1_slash_logs(network, canonical, block_number);

      CREATE TABLE slash_outcomes (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        rollup_address TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        validator TEXT NOT NULL,
        amount TEXT NOT NULL,
        log_count INTEGER NOT NULL,
        log_indexes_json TEXT NOT NULL,
        canonical INTEGER NOT NULL DEFAULT 1 CHECK (canonical IN (0, 1)),
        backfilled INTEGER NOT NULL DEFAULT 0 CHECK (backfilled IN (0, 1)),
        correction_generation INTEGER NOT NULL DEFAULT 0,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(chain_id, block_hash, transaction_hash, validator)
      );
      CREATE INDEX slash_outcomes_target_idx
        ON slash_outcomes(network, validator, canonical, block_number DESC);
      CREATE INDEX slash_outcomes_canonical_block_idx
        ON slash_outcomes(network, canonical, block_number);

      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  prepareStatements() {
    this.findInternal = this.db.prepare(`
      SELECT id, validator, penalty, offense_type AS offenseType,
             offense_type_name AS offenseTypeName, epoch_or_slot AS epochOrSlot,
             time_unit AS timeUnit, status, missed_polls AS missedPolls
      FROM offenses WHERE id = ?
    `);
    this.upsertOffense = this.db.prepare(`
      INSERT INTO offenses (
        id, validator, penalty, offense_type, offense_type_name, epoch_or_slot, time_unit,
        status, first_seen_at, last_seen_at, resolved_at, observation_count,
        reactivation_count, missed_polls, last_poll_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, 1, 0, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        validator = excluded.validator,
        penalty = excluded.penalty,
        offense_type = excluded.offense_type,
        offense_type_name = excluded.offense_type_name,
        epoch_or_slot = excluded.epoch_or_slot,
        time_unit = excluded.time_unit,
        last_seen_at = excluded.last_seen_at,
        resolved_at = NULL,
        observation_count = offenses.observation_count + 1,
        reactivation_count = offenses.reactivation_count + CASE WHEN offenses.status = 'resolved' THEN 1 ELSE 0 END,
        missed_polls = 0,
        last_poll_sequence = excluded.last_poll_sequence,
        status = 'active'
    `);
    this.listMissingOffenses = this.db.prepare(`
      SELECT id, validator, penalty, offense_type AS offenseType,
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
    resolveAfterMissedPolls = 3,
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
        resolved: 0,
        events: 0,
      };
      for (const offense of offenses) {
        const existing = this.findInternal.get(offense.id);
        let eventType;
        if (!existing) {
          result.inserted += 1;
          eventType = 'node_offense_detected';
        } else if (existing.status === 'resolved') {
          result.reactivated += 1;
        } else if (
          existing.penalty !== offense.penalty ||
          existing.offenseType !== offense.offenseType ||
          existing.offenseTypeName !== offense.offenseTypeName ||
          existing.epochOrSlot !== offense.epochOrSlot ||
          existing.timeUnit !== offense.timeUnit
        ) {
          result.updated += 1;
          eventType = undefined;
        }

        this.upsertOffense.run(
          offense.id,
          offense.validator,
          offense.penalty,
          offense.offenseType,
          offense.offenseTypeName,
          offense.epochOrSlot,
          offense.timeUnit,
          observedAt,
          observedAt,
          sequence,
        );
        if (eventType) {
          const insertion = this.insertEvent(
            nodeOffenseEvent(eventType, offense, network, observedAt),
            [offense.validator],
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
        if (Number(offense.missedPolls) + 1 < resolveAfterMissedPolls) continue;
        this.db.prepare(`
          UPDATE offenses SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'active'
        `).run(observedAt, offense.id);
        result.resolved += 1;
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

  listOffenses({ status = 'active', validators = [], limit = 100, offset = 0 } = {}) {
    const { where, parameters } = buildOffenseFilters(status, validators);
    return this.db.prepare(`${PUBLIC_OFFENSE_SELECT}${where} ORDER BY last_seen_at DESC, id ASC LIMIT ? OFFSET ?`)
      .all(...parameters, limit, offset)
      .map(toPublicOffense);
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

  getSlashingProtocolSnapshot() {
    const l1State = this.getSourceState('l1');
    const metadata = l1State?.metadata;
    const activeStack = Array.isArray(metadata?.stacks)
      ? metadata.stacks.find((stack) => stack?.role === 'active')
      : undefined;
    const parameters = activeStack?.parameters;
    if (!metadata || !activeStack || !parameters || l1State.lastSuccessAt == null) {
      return undefined;
    }

    try {
      const chainId = safePositiveInteger(metadata.chainId, 'protocol chain id');
      const currentSlot = safeUnsignedBigIntString(metadata.currentSlot, 'protocol current slot');
      const currentEpoch = safeUnsignedBigIntString(metadata.currentEpoch, 'protocol current epoch');
      const currentRound = safeUnsignedBigIntString(
        activeStack.currentRound,
        'protocol current round',
      );
      const slotDurationSeconds = safePositiveInteger(
        metadata.slotDuration,
        'protocol slot duration',
      );
      const epochDurationSlots = safePositiveInteger(
        metadata.epochDuration,
        'protocol epoch duration',
      );
      const quorum = safePositiveInteger(parameters.quorum, 'protocol quorum');
      const roundSizeSlots = safePositiveInteger(parameters.roundSize, 'protocol round size');
      const roundSizeEpochs = safePositiveInteger(
        parameters.roundSizeInEpochs,
        'protocol round size in epochs',
      );
      const executionDelayRounds = safeUnsignedInteger(
        parameters.executionDelayInRounds,
        'protocol execution delay',
      );
      const lifetimeRounds = safePositiveInteger(
        parameters.lifetimeInRounds,
        'protocol lifetime',
      );
      const slashOffsetRounds = safePositiveInteger(
        parameters.slashOffsetInRounds,
        'protocol slash offset',
      );
      if (lifetimeRounds <= executionDelayRounds) {
        throw new Error('protocol lifetime must exceed its execution delay');
      }

      const pauseDurationSeconds = activeStack.slashingDisableDuration === null ||
        activeStack.slashingDisableDuration === undefined
        ? null
        : safePositiveInteger(
          activeStack.slashingDisableDuration,
          'protocol pause duration',
        );

      return {
        chainId,
        observedAt: toIso(l1State.lastSuccessAt),
        currentSlot,
        currentEpoch,
        currentRound,
        slotDurationSeconds,
        epochDurationSlots,
        quorum,
        roundSizeSlots,
        roundSizeEpochs,
        executionDelayRounds,
        lifetimeRounds,
        slashOffsetRounds,
        roundDurationSeconds: checkedProduct(
          roundSizeSlots,
          slotDurationSeconds,
          'protocol round duration',
        ),
        executionDelaySeconds: checkedProduct(
          executionDelayRounds,
          roundSizeSlots,
          slotDurationSeconds,
          'protocol execution delay duration',
        ),
        executionWindowSeconds: checkedProduct(
          lifetimeRounds - executionDelayRounds,
          roundSizeSlots,
          slotDurationSeconds,
          'protocol execution window duration',
        ),
        isSlashingEnabled: activeStack.isSlashingEnabled !== false,
        pauseDurationSeconds,
        slashingDisabledUntil: optionalUnsignedBigIntString(
          activeStack.slashingDisabledUntil,
        ),
        pauseStartedAtSlot: optionalUnsignedBigIntString(activeStack.pauseStartedAtSlot),
        pauseEndsAtSlot: optionalUnsignedBigIntString(activeStack.pauseEndsAtSlot),
      };
    } catch {
      // A partial or older L1 metadata snapshot must not produce a plausible
      // timing contract. Events remain readable while the next scan repairs it.
      return undefined;
    }
  }

  insertEvent(event, targets = [], directEndpointIds = undefined) {
    const observedAt = Number(event.observedAt ?? Date.now());
    const normalizedTargets = [...new Set(targets.map((value) => String(value).toLowerCase()))];
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        id, network, source, type, severity, incident_id, data_json, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.network,
      event.source,
      event.type,
      event.severity,
      event.incidentId ?? event.id,
      JSON.stringify(event.data ?? {}),
      observedAt,
      Number(event.createdAt ?? observedAt),
    );
    if (Number(result.changes) === 0) return { inserted: false, queued: 0 };

    const insertTarget = this.db.prepare('INSERT OR IGNORE INTO event_targets(event_id, validator) VALUES (?, ?)');
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
        JOIN watchlist_addresses address ON address.watchlist_id = endpoint.watchlist_id
        WHERE endpoint.enabled = 1
          AND address.validator IN (${normalizedTargets.map(() => '?').join(',')})
      `).all(...normalizedTargets);
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

  createWatchlist({
    id,
    managementTokenHash,
    network,
    addresses,
    now = Date.now(),
    admissionLimits,
  }) {
    return this.transaction(() => {
      this.assertPrivateEventLimits({
        type: 'watchlist_admission',
        now,
        limits: admissionLimits,
        code: 'watchlist_capacity_limited',
        message: 'Watch-list creation is temporarily busy; try again later',
      });
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
          id, management_token_hash, created_at, updated_at, unconnected_since
        ) VALUES (?, ?, ?, ?, ?)
      `).run(id, managementTokenHash, now, now, now);
      this.replaceWatchlistAddresses(id, addresses);
      if (admissionLimits) {
        this.insertEvent({
          id: `watchlist-admission-${id}`,
          network,
          source: 'test',
          type: 'watchlist_admission',
          severity: 'info',
          data: { watchlistId: id, admission: true },
          observedAt: now,
        });
      }
      return this.getWatchlist(id);
    });
  }

  getWatchlist(id) {
    const row = this.db.prepare(`
      SELECT id, management_token_hash AS managementTokenHash,
        created_at AS createdAt, updated_at AS updatedAt FROM watchlists WHERE id = ?
    `).get(id);
    if (!row) return undefined;
    const addresses = this.db.prepare(`
      SELECT validator FROM watchlist_addresses WHERE watchlist_id = ? ORDER BY validator
    `).all(id).map((item) => item.validator);
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
      if (addressesChanged) {
        this.db.prepare('UPDATE watchlists SET updated_at = ? WHERE id = ?').run(now, id);
      }
      if (addressesChanged) {
        this.replaceWatchlistAddresses(id, nextAddresses);
        this.discardUnmatchedDeliveries(id);
      }
      return this.getWatchlist(id);
    });
  }

  replaceWatchlistAddresses(id, addresses) {
    this.db.prepare('DELETE FROM watchlist_addresses WHERE watchlist_id = ?').run(id);
    const insert = this.db.prepare('INSERT INTO watchlist_addresses(watchlist_id, validator) VALUES (?, ?)');
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
          JOIN watchlist_addresses address ON address.validator = target.validator
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
    admissionLimits,
  }) {
    return this.transaction(() => this.upsertEndpointInternal({
      watchlistId,
      kind,
      destination,
      configJson,
      now,
      allowRebind,
      admissionLimits,
    }));
  }

  upsertEndpointInternal({
    watchlistId,
    kind,
    destination,
    configJson = null,
    now,
    allowRebind = false,
    admissionLimits,
  }) {
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
    }
    const needsWebPushVerification = kind === 'web_push' &&
      (existing?.verifiedAt === null || existing?.verifiedAt === undefined) &&
      !this.hasActiveEndpointVerification(id);
    if (needsWebPushVerification) {
      this.assertPrivateEventLimits({
        type: 'notification_channel_verification',
        now,
        watchlistId,
        limits: admissionLimits,
        code: 'web_push_enrollment_rate_limited',
        message: 'Too many Web Push connections were requested; try again later',
      });
    }
    if (existing && existing.watchlistId !== watchlistId) {
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
    this.transferEndpointDeliveries(staleEndpointIds, id, now);
    const reconnectEndpoints = staleEndpoints.length > 0
      ? staleEndpoints.filter((endpoint) => !Boolean(endpoint.enabled) && endpoint.lastError)
      : existing?.watchlistId === watchlistId && !Boolean(existing.enabled) && existing.lastError
        ? [existing]
        : [];
    // A provider can permanently reject an endpoint after a one-shot slash or
    // correction has entered its outbox. A proven reconnect gets one fresh try
    // while the event is still inside the worker's normal retry lifetime.
    this.recoverFailedUrgentDeliveries(reconnectEndpoints, id, now);
    if (staleEndpoints.length > 0) {
      const placeholders = staleEndpoints.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM delivery_endpoints WHERE id IN (${placeholders})`)
        .run(...staleEndpoints.map((endpoint) => endpoint.id));
    }
    const verified = kind === 'telegram' || (existing?.verifiedAt !== null && existing?.verifiedAt !== undefined);
    const verificationQueued = kind === 'web_push' && !verified && !this.hasActiveEndpointVerification(id)
      ? this.enqueueEndpointVerification(watchlistId, id, now)
      : 0;
    return {
      id,
      kind,
      enabled: true,
      verified,
      verificationQueued,
    };
  }

  transferEndpointDeliveries(endpointIds, replacementId, now) {
    if (endpointIds.length === 0) return 0;
    const placeholders = endpointIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT delivery.event_id AS eventId, delivery.status, delivery.attempts,
        delivery.next_attempt_at AS nextAttemptAt,
        delivery.last_attempt_at AS lastAttemptAt, delivery.last_error AS lastError,
        delivery.created_at AS createdAt
      FROM deliveries delivery
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.endpoint_id IN (${placeholders})
        AND delivery.status IN ('pending', 'sending', 'retry')
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
        event.data_json AS eventDataJson
      FROM deliveries delivery
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.endpoint_id IN (${placeholders})
        AND delivery.status = 'failed' AND delivery.sent_at IS NULL
        AND event.source != 'test'
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
    let recovered = 0;
    for (const row of rows) {
      const disabledByThisEndpoint = row.lastError === endpointErrors.get(row.endpointId) ||
        row.lastError === 'Endpoint disabled after a permanent delivery failure';
      // A confirmed-log event can become non-canonical after the provider has
      // already killed this endpoint. Reconnecting must not resurrect the very
      // alert that the reorg correction invalidated.
      const eventData = parseJson(row.eventDataJson, {});
      if (!disabledByThisEndpoint || eventData.canonical === false) continue;
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
    const watchlist = this.getWatchlist(watchlistId);
    if (!watchlist) return 0;
    const event = {
      id: stableId('channel-verification', endpointId, now),
      network: this.getSourceState('runtime_identity')?.metadata?.network ?? 'mainnet',
      source: 'test',
      type: 'notification_channel_verification',
      severity: 'info',
      data: { verification: true, watchlistId, validators: watchlist.addresses },
      observedAt: now,
    };
    return this.insertEvent(event, [], [endpointId]).queued;
  }

  requestEndpointVerification({
    watchlistId,
    endpointId,
    now = Date.now(),
    admissionLimits,
  }) {
    return this.transaction(() => {
      const endpoint = this.db.prepare(`
        SELECT enabled, verified_at AS verifiedAt
        FROM delivery_endpoints
        WHERE id = ? AND watchlist_id = ? AND kind = 'web_push'
      `).get(endpointId, watchlistId);
      if (
        !endpoint ||
        !Boolean(endpoint.enabled) ||
        endpoint.verifiedAt !== null ||
        this.hasActiveEndpointVerification(endpointId)
      ) {
        return 0;
      }
      this.assertPrivateEventLimits({
        type: 'notification_channel_verification',
        now,
        watchlistId,
        limits: admissionLimits,
        code: 'web_push_enrollment_rate_limited',
        message: 'Too many Web Push verification checks were requested; try again later',
      });
      return this.enqueueEndpointVerification(watchlistId, endpointId, now);
    });
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
      if (!enabled) {
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
    {
      cooldownMs = NOTIFICATION_TEST_COOLDOWN_MS,
      admissionLimits,
    } = {},
  ) {
    return this.transaction(() => {
      const endpoints = this.db.prepare(`
        SELECT endpoint.id FROM delivery_endpoints endpoint
        WHERE endpoint.watchlist_id = ? AND endpoint.enabled = 1
      `).all(watchlistId).map((row) => row.id);
      if (endpoints.length === 0) return 0;

      this.assertPrivateEventLimits({
        type: 'notification_test',
        now,
        limits: admissionLimits,
        code: 'notification_test_capacity_limited',
        message: 'The notification test budget is busy; try again later',
      });

      // Claim the watchlist's test slot under the same write lock as the event
      // and outbox rows. Two API processes therefore cannot race past the
      // cooldown and amplify one watchlist into an unbounded journal.
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

      const validators = this.db.prepare(`
        SELECT validator FROM watchlist_addresses WHERE watchlist_id = ? ORDER BY validator
      `).all(watchlistId).map((row) => row.validator);
      return this.insertEvent({
        ...event,
        data: { ...event.data, watchlistId, validators },
        observedAt: event.observedAt ?? now,
      }, [], endpoints).queued;
    });
  }

  assertPrivateEventLimits({
    type,
    now,
    watchlistId,
    limits,
    code,
    message,
  }) {
    if (!limits) return;
    const checks = [
      [HOUR_MS, limits.maxPerHourGlobal, false],
      [DAY_MS, limits.maxPerDayGlobal, false],
      [HOUR_MS, limits.maxPerHourPerWatchlist, true],
      [DAY_MS, limits.maxPerDayPerWatchlist, true],
    ];
    for (const [windowMs, max, perWatchlist] of checks) {
      if (!Number.isSafeInteger(max) || max < 1) continue;
      if (perWatchlist && !watchlistId) continue;
      const row = perWatchlist
        ? this.db.prepare(`
          SELECT COUNT(*) AS count, MIN(created_at) AS oldestAt
          FROM events
          WHERE source = 'test' AND type = ? AND created_at > ?
            AND json_extract(data_json, '$.watchlistId') = ?
        `).get(type, now - windowMs, watchlistId)
        : this.db.prepare(`
          SELECT COUNT(*) AS count, MIN(created_at) AS oldestAt
          FROM events
          WHERE source = 'test' AND type = ? AND created_at > ?
        `).get(type, now - windowMs);
      if (Number(row.count) >= max) {
        throw new NotificationRateLimitError(
          code,
          message,
          Number(row.oldestAt) + windowMs - now,
        );
      }
    }
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
        endpoint.watchlist_id AS watchlistId,
        event.id AS eventId, event.network, event.source, event.type, event.severity,
        event.incident_id AS incidentId, event.data_json AS eventDataJson,
        event.observed_at AS eventObservedAt
      FROM deliveries delivery
      JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.id = ?
    `).get(id);
    if (!row) return undefined;
    const eventData = parseJson(row.eventDataJson, {});
    const targets = this.deliveryTargets(
      row.watchlistId,
      row.eventId,
      row.type,
      eventData,
    );
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
        incidentId: row.incidentId,
        data: eventData,
        targets,
        observedAt: row.eventObservedAt,
      },
    };
  }

  deliveryTargets(watchlistId, eventId, eventType, eventData) {
    let targets = this.db.prepare(`
      SELECT target.validator
      FROM event_targets target
      JOIN watchlist_addresses watched
        ON watched.watchlist_id = ? AND watched.validator = target.validator
      WHERE target.event_id = ?
      ORDER BY target.validator
    `).all(watchlistId, eventId).map((item) => item.validator);
    if (eventType !== 'onchain_quorum_candidate') return targets;
    const currentCase = typeof eventData.caseId === 'string'
      ? this.db.prepare(`
          SELECT status, actions_json AS actionsJson
          FROM onchain_rounds WHERE id = ?
        `).get(eventData.caseId)
      : undefined;
    if (!currentCase || currentCase.status !== 'quorum-reached') return [];
    const currentTargets = new Set(actionTargets(parseJson(currentCase.actionsJson, [])));
    targets = targets.filter((target) => currentTargets.has(target));
    return targets;
  }

  isDeliverySendable(id) {
    const row = this.db.prepare(`
      SELECT endpoint.watchlist_id AS watchlistId, event.id AS eventId,
        event.type, event.data_json AS eventDataJson
      FROM deliveries delivery
      JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
      JOIN events event ON event.id = delivery.event_id
      WHERE delivery.id = ? AND delivery.status = 'sending'
        AND endpoint.enabled = 1
        AND (endpoint.verified_at IS NOT NULL OR event.source = 'test')
    `).get(id);
    if (!row) return false;
    if (
      row.type === 'onchain_quorum_candidate' &&
      this.deliveryTargets(
        row.watchlistId,
        row.eventId,
        row.type,
        parseJson(row.eventDataJson, {}),
      ).length === 0
    ) {
      this.db.prepare(`
        DELETE FROM deliveries WHERE id = ? AND status = 'sending'
      `).run(id);
      return false;
    }
    return true;
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
    terminalDeliveryRetentionMs = TERMINAL_DELIVERY_RETENTION_MS,
    telegramTokenRetentionMs = TELEGRAM_TOKEN_RETENTION_MS,
    abandonedWatchlistRetentionMs = DAY_MS,
    unverifiedEndpointRetentionMs = UNVERIFIED_ENDPOINT_RETENTION_MS,
    factRetentionMs = FACT_RETENTION_MS,
  } = {}) {
    for (const [name, value] of Object.entries({
      notificationTestRetentionMs,
      terminalDeliveryRetentionMs,
      telegramTokenRetentionMs,
      abandonedWatchlistRetentionMs,
      unverifiedEndpointRetentionMs,
      factRetentionMs,
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
      // Once every associated send is terminal, remove old internal alert rows
      // and let the foreign key cascade their outbox. Never prune live work.
      const testEvents = this.db.prepare(`
        DELETE FROM events
        WHERE source = 'test' AND created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM deliveries delivery
            WHERE delivery.event_id = events.id
              AND delivery.status IN ('pending', 'sending', 'retry')
          )
      `).run(now - notificationTestRetentionMs);
      const alerts = this.db.prepare(`
        DELETE FROM events
        WHERE source != 'test' AND created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM deliveries delivery
            WHERE delivery.event_id = events.id
              AND delivery.status IN ('pending', 'sending', 'retry')
          )
      `).run(now - factRetentionMs);
      const terminalDeliveries = this.db.prepare(`
        DELETE FROM deliveries
        WHERE status IN ('sent', 'failed') AND updated_at <= ?
      `).run(now - terminalDeliveryRetentionMs);
      const telegramTokens = this.db.prepare(`
        DELETE FROM telegram_link_tokens
        WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)
      `).run(now - telegramTokenRetentionMs, now - telegramTokenRetentionMs);
      const offenses = this.db.prepare(`
        DELETE FROM offenses WHERE status = 'resolved' AND resolved_at <= ?
      `).run(now - factRetentionMs);
      const rounds = this.db.prepare(`
        DELETE FROM onchain_rounds
        WHERE status IN ('expired', 'executed', 'vetoed', 'no-consensus', 'stack-retired')
          AND last_seen_at <= ?
      `).run(now - factRetentionMs);
      const outcomes = this.db.prepare(`
        DELETE FROM slash_outcomes WHERE last_seen_at <= ?
      `).run(now - factRetentionMs);
      return {
        unverifiedEndpoints,
        abandonedWatchlists: Number(abandonedWatchlists.changes),
        testEvents: Number(testEvents.changes),
        alerts: Number(alerts.changes),
        terminalDeliveries: Number(terminalDeliveries.changes),
        telegramTokens: Number(telegramTokens.changes),
        offenses: Number(offenses.changes),
        rounds: Number(rounds.changes),
        slashOutcomes: Number(outcomes.changes),
      };
    });
  }

  cancelUnsentL1CaseAlerts(
    network,
    row,
    types = ['onchain_quorum_candidate', 'onchain_ready'],
  ) {
    const allowedTypes = types.filter((type) =>
      ['onchain_quorum_candidate', 'onchain_ready'].includes(type)
    );
    if (allowedTypes.length === 0) return;
    const incidentId = stableId(
      'l1-case',
      network,
      row.proposer_address,
      row.round,
    );
    const typePlaceholders = allowedTypes.map(() => '?').join(',');
    this.db.prepare(`
      DELETE FROM deliveries
      WHERE status IN ('pending', 'retry')
        AND event_id IN (
          SELECT id FROM events
          WHERE network = ? AND source = 'ethereum_l1' AND incident_id = ?
            AND type IN (${typePlaceholders})
        )
    `).run(network, incidentId, ...allowedTypes);
    this.db.prepare(`
      DELETE FROM events
      WHERE network = ? AND source = 'ethereum_l1' AND incident_id = ?
        AND type IN (${typePlaceholders})
        AND NOT EXISTS (
          SELECT 1 FROM deliveries WHERE deliveries.event_id = events.id
        )
    `).run(network, incidentId, ...allowedTypes);
  }

  discardStaleCandidateDeliveries(network, row, currentTargets) {
    if (currentTargets.length === 0) return;
    const incidentId = stableId(
      'l1-case',
      network,
      row.proposer_address,
      row.round,
    );
    const targetPlaceholders = currentTargets.map(() => '?').join(',');
    const removed = Number(this.db.prepare(`
      DELETE FROM deliveries
      WHERE status IN ('pending', 'retry')
        AND event_id IN (
          SELECT id FROM events
          WHERE network = ? AND source = 'ethereum_l1' AND incident_id = ?
            AND type = 'onchain_quorum_candidate'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM event_targets target
          JOIN delivery_endpoints endpoint ON endpoint.id = deliveries.endpoint_id
          JOIN watchlist_addresses watched
            ON watched.watchlist_id = endpoint.watchlist_id
              AND watched.validator = target.validator
          WHERE target.event_id = deliveries.event_id
            AND target.validator IN (${targetPlaceholders})
        )
    `).run(network, incidentId, ...currentTargets).changes);
    if (removed === 0) return;
    this.db.prepare(`
      DELETE FROM events
      WHERE network = ? AND source = 'ethereum_l1' AND incident_id = ?
        AND type = 'onchain_quorum_candidate'
        AND NOT EXISTS (
          SELECT 1 FROM deliveries WHERE deliveries.event_id = events.id
        )
    `).run(network, incidentId);
  }

  recordSuccessfulL1Snapshot(network, snapshot, { observedAt = Date.now() } = {}) {
    if (!snapshot || !Array.isArray(snapshot.stacks) || !snapshot.blockHash || snapshot.blockNumber === undefined) {
      throw new Error('Refusing to persist an incomplete L1 snapshot');
    }
    assertCompleteL1Cases(snapshot);
    return this.transaction(() => {
      const flattened = [];
      for (const stack of snapshot.stacks) {
        if (!Array.isArray(stack.rounds)) throw new Error('Refusing to persist an incomplete L1 stack');
        for (const round of stack.rounds) flattened.push({ stack, round });
      }
      const seen = new Set();
      const scannedStacks = new Map(snapshot.stacks.map(
        (stack) => [stack.proposerAddress.toLowerCase(), stack],
      ));
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
        const round = canonicalL1Round(item.round, item.stack.currentRound);
        const rowId = stableId('l1-round', network, snapshot.chainId, item.stack.proposerAddress.toLowerCase(), round.round);
        seen.add(rowId);
        const existing = this.db.prepare('SELECT * FROM onchain_rounds WHERE id = ?').get(rowId);
        let eventType = l1AlertTransition(existing, round, {
          ...snapshot,
          currentRound: item.stack.currentRound,
        });
        const currentTargets = actionTargets(round.actions ?? []);
        this.discardStaleCandidateDeliveries(
          network,
          {
            proposer_address: item.stack.proposerAddress.toLowerCase(),
            round: round.round,
          },
          currentTargets,
        );
        let targets = eventType ? currentTargets : [];
        if (!eventType && l1CandidateState(round, item.stack.currentRound)) {
          const alreadyAlerted = new Set(this.db.prepare(`
            SELECT target.validator
            FROM event_targets target
            JOIN events event ON event.id = target.event_id
            WHERE event.network = ? AND event.source = 'ethereum_l1'
              AND event.incident_id = ? AND event.type = 'onchain_quorum_candidate'
          `).all(
            network,
            stableId(
              'l1-case',
              network,
              item.stack.proposerAddress.toLowerCase(),
              round.round,
            ),
          ).map((row) => row.validator));
          targets = currentTargets.filter((target) => !alreadyAlerted.has(target));
          if (targets.length > 0) eventType = 'onchain_quorum_candidate';
        }
        const alertRow = {
          proposer_address: item.stack.proposerAddress.toLowerCase(),
          round: round.round,
        };
        if (['executed', 'vetoed', 'expired', 'no-consensus'].includes(round.status)) {
          this.cancelUnsentL1CaseAlerts(network, alertRow);
        } else if (eventType === 'onchain_ready') {
          this.cancelUnsentL1CaseAlerts(
            network,
            alertRow,
            ['onchain_quorum_candidate'],
          );
        } else if (round.isExecutionPaused) {
          this.cancelUnsentL1CaseAlerts(network, alertRow, ['onchain_ready']);
        }
        if (!existing || l1RowChanged(existing, round, item.stack)) changed += 1;
        this.db.prepare(`
          INSERT INTO onchain_rounds (
            id, network, chain_id, block_number, block_hash, stack_role, slasher_address,
            proposer_address, round, status, ballot_count, is_executed, is_vetoed,
            payload_address, actions_json, details_json,
            first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            details_json = excluded.details_json,
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
          round.round,
          round.status,
          round.ballotCount,
          round.isExecuted ? 1 : 0,
          round.isVetoed ? 1 : 0,
          round.payloadAddress?.toLowerCase() ?? null,
          JSON.stringify(round.actions ?? []),
          JSON.stringify({
            targetEpochs: round.targetEpochs ?? [],
            executableSlot: round.executableSlot,
            expirySlot: round.expirySlot,
            l1GenesisTime: snapshot.l1GenesisTime,
            slotDuration: snapshot.slotDuration,
            epochDuration: snapshot.epochDuration,
            currentSlot: snapshot.currentSlot,
            currentEpoch: snapshot.currentEpoch,
            currentRound: item.stack.currentRound,
            isSlashingEnabled: Boolean(item.stack.isSlashingEnabled),
            isExecutionPaused: Boolean(round.isExecutionPaused),
            slashingDisabledUntil: item.stack.slashingDisabledUntil ?? null,
            pauseStartedAtSlot: item.stack.pauseStartedAtSlot ?? null,
            pauseEndsAtSlot: item.stack.pauseEndsAtSlot ?? null,
            parameters: item.stack.parameters,
            readyAt: item.stack.readyAt,
            authorizedUntil: item.stack.authorizedUntil,
          }),
          existing?.first_seen_at ?? observedAt,
          observedAt,
        );
        if (eventType && targets.length > 0) {
          const insertion = this.insertEvent(
            l1CaseEvent(
              eventType,
              {
                ...round,
                ...item.stack,
                id: rowId,
              },
              network,
              observedAt,
              snapshot,
              eventType === 'onchain_quorum_candidate'
                ? stableId('event', network, eventType, rowId, ...[...targets].sort())
                : stableId('event', network, eventType, rowId),
            ),
            targets,
          );
          events += Number(insertion.inserted);
        }
      }

      const previousRows = this.db.prepare(`
        SELECT * FROM onchain_rounds
        WHERE network = ? AND status NOT IN (
          'expired', 'executed', 'vetoed', 'no-consensus', 'stack-retired'
        )
      `).all(network);
      for (const old of previousRows) {
        if (seen.has(old.id)) continue;
        // A Slasher's role can change between complete snapshots (most notably
        // active -> legacy during rotation). Match a failed optional scan by
        // immutable Slasher identity, not the role stored on its previous rows,
        // or a transient first legacy scan would falsely expire live rounds.
        if (failedStackAddresses.has(old.slasher_address)) continue;
        if (failedRounds.get(old.proposer_address)?.has(String(old.round))) continue;
        const stack = scannedStacks.get(old.proposer_address);
        const targets = actionTargets(parseJson(old.actions_json, []));
        if (stack && BigInt(stack.currentRound) <= BigInt(old.round)) {
          // scanStack omits a completely empty round. If a reorg removes the
          // only canonical ballots while voting is still open, the proposal no
          // longer exists: remove it instead of manufacturing an expiry.
          this.cancelUnsentL1CaseAlerts(network, old);
          this.db.prepare('DELETE FROM onchain_rounds WHERE id = ?').run(old.id);
          changed += 1;
          continue;
        }

        const beyondLifetime = stack && (
          BigInt(stack.currentRound) >
          BigInt(old.round) + BigInt(stack.parameters.lifetimeInRounds)
        );
        const nextStatus = !stack
          ? 'stack-retired'
          : beyondLifetime && targets.length > 0
            ? 'expired'
            : 'no-consensus';
        const clearCanonicalProposal = Boolean(stack) && !beyondLifetime;
        this.cancelUnsentL1CaseAlerts(network, old);
        const details = parseJson(old.details_json, {});
        const nextDetails = stack ? {
          ...details,
          currentSlot: snapshot.currentSlot,
          currentEpoch: snapshot.currentEpoch,
          currentRound: stack.currentRound,
          isSlashingEnabled: Boolean(stack.isSlashingEnabled),
          isExecutionPaused: clearCanonicalProposal ? false : Boolean(details.isExecutionPaused),
          slashingDisabledUntil: stack.slashingDisabledUntil ?? null,
          pauseStartedAtSlot: stack.pauseStartedAtSlot ?? null,
          pauseEndsAtSlot: stack.pauseEndsAtSlot ?? null,
          parameters: stack.parameters,
          readyAt: stack.readyAt,
          authorizedUntil: stack.authorizedUntil,
        } : details;
        this.db.prepare(`
          UPDATE onchain_rounds SET status = ?, block_number = ?, block_hash = ?,
            stack_role = ?, slasher_address = ?, ballot_count = ?,
            is_executed = 0, is_vetoed = 0, payload_address = ?,
            actions_json = ?, details_json = ?, last_seen_at = ? WHERE id = ?
        `).run(
          nextStatus,
          snapshot.blockNumber,
          snapshot.blockHash,
          stack?.role ?? old.stack_role,
          stack?.slasherAddress?.toLowerCase() ?? old.slasher_address,
          clearCanonicalProposal ? '0' : old.ballot_count,
          clearCanonicalProposal ? null : old.payload_address,
          clearCanonicalProposal ? '[]' : old.actions_json,
          JSON.stringify(nextDetails),
          observedAt,
          old.id,
        );
        changed += 1;
        if (targets.length > 0 && nextStatus === 'expired') {
          const type = 'onchain_expired';
          const insertion = this.insertEvent(l1CaseEvent(
            type,
            {
              ...onchainRowToSnapshot(old),
              status: nextStatus,
            },
            network,
            observedAt,
            snapshot,
            stableId('event', network, type, old.id),
          ), targets);
          events += Number(insertion.inserted);
        }
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
          stacks: snapshot.stacks.map((stack) => ({
            role: stack.role,
            slasherAddress: stack.slasherAddress,
            proposerAddress: stack.proposerAddress,
            currentRound: stack.currentRound,
            isSlashingEnabled: Boolean(stack.isSlashingEnabled),
            slashingDisabledUntil: stack.slashingDisabledUntil ?? null,
            slashingDisableDuration: stack.slashingDisableDuration ?? null,
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
        this.db.prepare(`
          UPDATE l1_slash_logs SET canonical = 0, last_seen_at = ?
          WHERE network = ? AND block_number >= ?
        `).run(observedAt, network, normalized.fromBlock);
      }

      let inserted = 0;
      let queued = 0;
      let reconfirmed = 0;
      let outcomesInserted = 0;
      for (const outcome of groupSlashLogs(normalized)) {
        const existingOutcome = this.db.prepare(`
          SELECT * FROM slash_outcomes WHERE id = ?
        `).get(outcome.id);
        const correctionGeneration = Number(existingOutcome?.correction_generation ?? 0);
        const wasCanonical = Boolean(existingOutcome?.canonical);
        this.db.prepare(`
          INSERT INTO slash_outcomes (
            id, network, chain_id, rollup_address, block_number, block_hash,
            transaction_hash, validator, amount, log_count, log_indexes_json,
            canonical, backfilled, correction_generation, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            amount = excluded.amount,
            log_count = excluded.log_count,
            log_indexes_json = excluded.log_indexes_json,
            canonical = 1,
            last_seen_at = excluded.last_seen_at
        `).run(
          outcome.id,
          network,
          normalized.chainId,
          outcome.rollupAddress,
          outcome.blockNumber,
          outcome.blockHash,
          outcome.transactionHash,
          outcome.validator,
          outcome.amount,
          outcome.logCount,
          JSON.stringify(outcome.logIndexes),
          normalized.initialBackfill ? 1 : 0,
          correctionGeneration,
          existingOutcome?.first_seen_at ?? observedAt,
          observedAt,
        );
        outcomesInserted += Number(!existingOutcome);

        for (const slash of outcome.logs) {
          const logId = stableId(
            'l1-slashed-log',
            normalized.chainId,
            slash.blockHash,
            slash.transactionHash,
            slash.logIndex,
          );
          const existingLog = this.db.prepare(`
            SELECT * FROM l1_slash_logs
            WHERE chain_id = ? AND block_hash = ? AND transaction_hash = ? AND log_index = ?
          `).get(normalized.chainId, slash.blockHash, slash.transactionHash, slash.logIndex);
          if (existingLog) {
            if (
              existingLog.id !== logId ||
              existingLog.outcome_id !== outcome.id ||
              existingLog.rollup_address !== slash.rollupAddress ||
              existingLog.block_number !== slash.blockNumber ||
              existingLog.validator !== slash.validator ||
              existingLog.amount !== slash.amount
            ) {
              throw new Error('A persisted Slashed log identity decoded to different contents');
            }
            this.db.prepare(`
              UPDATE l1_slash_logs SET canonical = 1, last_seen_at = ? WHERE id = ?
            `).run(observedAt, logId);
            continue;
          }
          this.db.prepare(`
            INSERT INTO l1_slash_logs (
              id, outcome_id, network, chain_id, rollup_address, block_number, block_hash,
              transaction_hash, log_index, validator, amount, canonical, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).run(
            logId,
            outcome.id,
            network,
            normalized.chainId,
            slash.rollupAddress,
            slash.blockNumber,
            slash.blockHash,
            slash.transactionHash,
            slash.logIndex,
            slash.validator,
            slash.amount,
            observedAt,
            observedAt,
          );
          inserted += 1;
        }

        const confirmedEventId = slashConfirmedEventId(network, outcome.id);
        if (!existingOutcome && !normalized.initialBackfill) {
          const eventResult = this.insertEvent(
            confirmedSlashOutcomeEvent(confirmedEventId, network, outcome, observedAt, normalized.chainId),
            [outcome.validator],
          );
          queued += eventResult.queued;
        } else if (existingOutcome && !wasCanonical && !Boolean(existingOutcome.backfilled)) {
          setEventCanonicalFlag(this.db, confirmedEventId, true, observedAt);
          const correctionId = slashReorgCorrectionEventId(
            network,
            outcome.id,
            correctionGeneration,
          );
          if (this.db.prepare('SELECT 1 FROM events WHERE id = ?').get(correctionId)) {
            const restoration = this.insertEvent(
              slashOutcomeReconfirmedEvent(
                network,
                outcome,
                observedAt,
                normalized,
                correctionGeneration,
              ),
              [outcome.validator],
            );
            reconfirmed += Number(restoration.inserted);
            queued += restoration.queued;
          }
        }
      }

      let corrections = 0;
      const orphaned = this.db.prepare(`
        SELECT * FROM slash_outcomes
        WHERE network = ? AND canonical = 1 AND block_number BETWEEN ? AND ?
          AND NOT EXISTS (
            SELECT 1 FROM l1_slash_logs log
            WHERE log.outcome_id = slash_outcomes.id AND log.canonical = 1
          )
      `).all(network, normalized.fromBlock, normalized.toBlock);
      for (const outcome of orphaned) {
        const generation = Number(outcome.correction_generation) + 1;
        const confirmedEventId = slashConfirmedEventId(network, outcome.id);
        this.db.prepare(`
          UPDATE slash_outcomes SET canonical = 0, correction_generation = ?,
            last_seen_at = ? WHERE id = ?
        `).run(generation, observedAt, outcome.id);
        this.db.prepare(`
          UPDATE deliveries SET status = 'failed', lease_expires_at = NULL,
            last_error = 'L1 reorg removed the confirmed slash log', updated_at = ?
          WHERE event_id = ? AND status IN ('pending', 'sending', 'retry')
        `).run(observedAt, confirmedEventId);
        setEventCanonicalFlag(this.db, confirmedEventId, false, observedAt);
        if (!Boolean(outcome.backfilled) && this.db.prepare(
          'SELECT 1 FROM events WHERE id = ?',
        ).get(confirmedEventId)) {
          const correction = this.insertEvent(
            slashOutcomeReorgEvent(
              network,
              toSlashOutcome(outcome),
              observedAt,
              normalized,
              generation,
            ),
            [outcome.validator],
          );
          corrections += Number(correction.inserted);
          queued += correction.queued;
        }
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
        outcomesInserted,
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

  listSlashOutcomes({ network, validator, canonical, limit = 50 } = {}) {
    if (typeof canonical !== 'boolean') {
      throw new Error('Slash outcome queries must select canonical or removed records');
    }
    const clauses = ['network = ?', 'canonical = ?'];
    const parameters = [network, canonical ? 1 : 0];
    if (validator) {
      clauses.push('validator = ?');
      parameters.push(String(validator).toLowerCase());
    }
    const rows = this.db.prepare(`
      SELECT * FROM slash_outcomes
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${canonical ? 'block_number' : 'last_seen_at'} DESC,
        block_number DESC, transaction_hash DESC, validator
      LIMIT ?
    `).all(...parameters, limit);
    return rows.map(toSlashOutcome);
  }

  getMonitorSnapshot(network, {
    caseLimit = 100,
    confirmedSlashLimit = 50,
    removedSlashLimit = 10,
  } = {}) {
    const l1State = this.getSourceState('l1');
    const slashState = this.getSourceState('l1_slash_logs');
    const rows = this.db.prepare(`
      SELECT * FROM onchain_rounds
      WHERE network = ?
      ORDER BY last_seen_at DESC, CAST(round AS INTEGER) DESC
      LIMIT ?
    `).all(network, caseLimit);
    return {
      network,
      coverage: {
        cases: l1DatasetCoverage(l1State),
        slashes: slashDatasetCoverage(slashState),
      },
      protocol: this.getSlashingProtocolSnapshot() ?? null,
      cases: rows.map(toMonitorCase),
      slashes: {
        confirmed: this.listSlashOutcomes({
          network,
          canonical: true,
          limit: confirmedSlashLimit,
        }),
        removed: this.listSlashOutcomes({
          network,
          canonical: false,
          limit: removedSlashLimit,
        }),
      },
    };
  }

  getValidatorSnapshot(network, validator, {
    caseLimit = 100,
    confirmedSlashLimit = 100,
    removedSlashLimit = 20,
  } = {}) {
    const address = normalizeValidator(validator);
    const cases = this.db.prepare(`
      SELECT * FROM onchain_rounds
      WHERE network = ?
        AND EXISTS (
          SELECT 1 FROM json_each(onchain_rounds.actions_json) action
          WHERE lower(json_extract(action.value, '$.validator')) = ?
        )
      ORDER BY last_seen_at DESC, CAST(round AS INTEGER) DESC
      LIMIT ?
    `).all(network, address, caseLimit).map(toMonitorCase);
    const nodeOffenses = this.listOffenses({
      status: 'all',
      validators: [address],
      limit: 200,
    });
    const slashes = {
      confirmed: this.listSlashOutcomes({
        network,
        validator: address,
        canonical: true,
        limit: confirmedSlashLimit,
      }),
      removed: this.listSlashOutcomes({
        network,
        validator: address,
        canonical: false,
        limit: removedSlashLimit,
      }),
    };
    const latest = [
      ...cases.map((item) => Date.parse(item.observedAt)),
      ...nodeOffenses.map((offense) => Date.parse(offense.lastObservedAt)),
      ...slashes.confirmed.map((slash) => Date.parse(slash.observedAt)),
      ...slashes.removed.map((slash) => Date.parse(slash.observedAt)),
    ].filter((value) => Number.isFinite(value));
    return {
      address,
      observedAt: toIso(latest.length > 0 ? Math.max(...latest) : null),
      cases,
      nodeOffenses,
      slashes,
    };
  }

  close() {
    this.db.close();
  }
}

const PUBLIC_OFFENSE_SELECT = `
  SELECT id, validator, penalty, offense_type AS offenseType, offense_type_name AS offenseTypeName,
    epoch_or_slot AS epochOrSlot, time_unit AS timeUnit, status,
    first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, resolved_at AS resolvedAt,
    observation_count AS observationCount, reactivation_count AS reactivationCount,
    missed_polls AS missedPolls FROM offenses
`;

function toPublicOffense(row) {
  return {
    id: row.id,
    address: row.validator,
    configuredPenalty: row.penalty,
    offenseType: row.offenseType,
    offenseTypeName: row.offenseTypeName,
    epochOrSlot: row.epochOrSlot,
    timeUnit: row.timeUnit,
    status: row.status,
    firstObservedAt: toIso(row.firstSeenAt),
    lastObservedAt: toIso(row.lastSeenAt),
    resolvedAt: toIso(row.resolvedAt),
    observationCount: row.observationCount,
    reactivationCount: row.reactivationCount,
    missedPolls: row.missedPolls,
  };
}

function buildOffenseFilters(status, validators) {
  if (!['active', 'resolved', 'all'].includes(status)) throw new Error('status must be active, resolved, or all');
  const clauses = [];
  const parameters = [];
  if (status !== 'all') {
    clauses.push('status = ?');
    parameters.push(status);
  }
  if (validators.length > 0) {
    clauses.push(`validator IN (${validators.map(() => '?').join(',')})`);
    parameters.push(...validators.map((value) => value.toLowerCase()));
  }
  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', parameters };
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

function canonicalL1Round(round, currentRound) {
  let status = round.status;
  if (round.isExecuted) {
    status = 'executed';
  } else if (round.isVetoed && isVotingClosed(round.round, currentRound)) {
    status = 'vetoed';
  } else if ((round.actions ?? []).length === 0 && isVotingClosed(round.round, currentRound)) {
    status = 'no-consensus';
  }
  return status === round.status ? round : { ...round, status };
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
    (details.pauseStartedAtSlot ?? null) !== (stack.pauseStartedAtSlot ?? null) ||
    (details.pauseEndsAtSlot ?? null) !== (stack.pauseEndsAtSlot ?? null) ||
    row.actions_json !== JSON.stringify(round.actions ?? []);
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
  };
}

function actionTargets(actions) {
  return [...new Set((actions ?? []).map((action) =>
    String(action.validator ?? '').toLowerCase()
  ).filter((value) => /^0x[0-9a-f]{40}$/.test(value)))];
}

function nodeOffenseEvent(type, offense, network, observedAt) {
  return {
    id: stableId('event', network, type, offense.id),
    incidentId: stableId('node-offense', network, offense.id),
    network,
    source: 'aztec_node',
    type,
    severity: 'warning',
    data: {
      certainty: 'node',
      offenseId: offense.id,
      validator: offense.validator,
      configuredPenalty: String(offense.penalty),
      offenseType: offense.offenseType,
      offenseTypeName: offense.offenseTypeName,
      epochOrSlot: String(offense.epochOrSlot),
      timeUnit: offense.timeUnit,
    },
    observedAt,
  };
}

function l1AlertTransition(existing, round, snapshot) {
  const actions = Array.isArray(round.actions) ? round.actions : [];
  if (actions.length === 0 || round.isExecuted) return undefined;

  const ready = ['newly-executable', 'executable'].includes(round.status) &&
    !round.isVetoed &&
    !round.isExecutionPaused &&
    round.isAuthorized !== false;
  const finalVeto = round.isVetoed && isVotingClosed(round.round, snapshot.currentRound);
  if (!existing) {
    if (finalVeto) return 'onchain_vetoed';
    if (ready) return 'onchain_ready';
    return undefined;
  }

  const oldDetails = parseJson(existing.details_json, {});
  const oldReady = ['newly-executable', 'executable'].includes(existing.status) &&
    !Boolean(existing.is_vetoed) &&
    !Boolean(oldDetails.isExecutionPaused);
  if (
    finalVeto &&
    (!Boolean(existing.is_vetoed) || !isVotingClosed(existing.round, oldDetails.currentRound))
  ) return 'onchain_vetoed';
  if (ready && !oldReady) return 'onchain_ready';
  return undefined;
}

function l1CandidateState(round, currentRound) {
  const actions = Array.isArray(round.actions) ? round.actions : [];
  if (actions.length === 0 || round.isExecuted) return false;
  if (round.isVetoed && isVotingClosed(round.round, currentRound)) return false;
  return round.status === 'quorum-reached';
}

function isVotingClosed(round, currentRound) {
  try {
    return BigInt(currentRound) > BigInt(round);
  } catch {
    return false;
  }
}

function l1CaseEvent(type, round, network, observedAt, snapshot, explicitId) {
  const details = l1CaseFacts(round, snapshot);
  return {
    id: explicitId ?? stableId(
      'event',
      network,
      type,
      String(round.proposerAddress ?? '').toLowerCase(),
      round.round,
    ),
    incidentId: stableId(
      'l1-case',
      network,
      String(round.proposerAddress ?? '').toLowerCase(),
      round.round,
    ),
    network,
    source: 'ethereum_l1',
    type,
    severity: type === 'onchain_ready' ? 'critical' : type === 'onchain_quorum_candidate' ? 'warning' : 'info',
    data: details,
    observedAt,
  };
}

function l1CaseFacts(round, snapshot = {}) {
  const executableSlot = round.executableSlot ?? null;
  const expirySlot = round.expirySlot ?? null;
  return {
    caseId: round.id ?? null,
    certainty: 'confirmed',
    chainId: snapshot.chainId ?? round.chainId ?? null,
    role: round.role ?? round.stackRole ?? 'active',
    round: String(round.round),
    targetEpochs: round.targetEpochs ?? [],
    votesCast: String(round.ballotCount ?? '0'),
    quorum: round.parameters?.quorum ?? null,
    currentSlot: snapshot.currentSlot ?? round.currentSlot ?? null,
    currentEpoch: snapshot.currentEpoch ?? round.currentEpoch ?? null,
    votingOpen: !isVotingClosed(
      round.round,
      round.currentRound ?? snapshot.currentRound,
    ),
    executableSlot,
    executableAt: slotTimestamp(executableSlot, round, snapshot),
    expirySlot,
    expiryAt: slotTimestamp(expirySlot, round, snapshot),
    proposerAddress: round.proposerAddress,
    slasherAddress: round.slasherAddress,
    payloadAddress: round.payloadAddress ?? null,
    status: round.status,
    currentPayloadVetoed: Boolean(round.isVetoed),
    isExecutionPaused: Boolean(round.isExecutionPaused),
    pauseEndsAtSlot: round.pauseEndsAtSlot ?? null,
    pauseEndsAt: slotTimestamp(round.pauseEndsAtSlot ?? null, round, snapshot),
    actions: round.actions ?? [],
    blockNumber: snapshot.blockNumber ?? round.blockNumber ?? null,
    blockHash: snapshot.blockHash ?? round.blockHash ?? null,
  };
}

function groupSlashLogs(chunk) {
  const groups = new Map();
  for (const log of chunk.logs) {
    const key = [
      chunk.chainId,
      log.blockHash,
      log.transactionHash,
      log.validator,
    ].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        id: stableId(
          'l1-slash-outcome',
          chunk.chainId,
          log.blockHash,
          log.transactionHash,
          log.validator,
        ),
        rollupAddress: log.rollupAddress,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        validator: log.validator,
        amount: '0',
        logCount: 0,
        logIndexes: [],
        logs: [],
      };
      groups.set(key, group);
    }
    group.amount = (BigInt(group.amount) + BigInt(log.amount)).toString();
    group.logCount += 1;
    group.logIndexes.push(log.logIndex);
    group.logs.push(log);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      logIndexes: group.logIndexes.sort((left, right) => left - right),
      logs: group.logs.sort((left, right) => left.logIndex - right.logIndex),
    }))
    .sort((left, right) =>
      left.blockNumber - right.blockNumber ||
      left.transactionHash.localeCompare(right.transactionHash) ||
      left.validator.localeCompare(right.validator)
    );
}

function slashConfirmedEventId(network, outcomeId) {
  return stableId('event', network, 'l1_slash_confirmed', outcomeId);
}

function slashReorgCorrectionEventId(network, outcomeId, generation) {
  return stableId('event', network, 'l1_slash_reorged', outcomeId, generation);
}

function confirmedSlashOutcomeEvent(id, network, outcome, observedAt, chainId) {
  return {
    id,
    incidentId: outcome.id,
    network,
    source: 'ethereum_l1',
    type: 'l1_slash_confirmed',
    severity: 'critical',
    data: slashOutcomeFacts(outcome, chainId, {
      canonical: true,
      backfilled: false,
    }),
    observedAt,
  };
}

function slashOutcomeReorgEvent(network, outcome, observedAt, chunk, generation) {
  return {
    id: slashReorgCorrectionEventId(network, outcome.id, generation),
    incidentId: outcome.id,
    network,
    source: 'ethereum_l1',
    type: 'l1_slash_reorged',
    severity: 'warning',
    data: {
      ...slashOutcomeFacts(outcome, outcome.chainId, {
        canonical: false,
        correctionGeneration: generation,
      }),
      replacementCheckpoint: {
        blockNumber: String(chunk.toBlock),
        blockHash: chunk.toBlockHash,
      },
    },
    observedAt,
  };
}

function slashOutcomeReconfirmedEvent(network, outcome, observedAt, chunk, generation) {
  return {
    id: stableId('event', network, 'l1_slash_reconfirmed', outcome.id, generation),
    incidentId: outcome.id,
    network,
    source: 'ethereum_l1',
    type: 'l1_slash_reconfirmed',
    severity: 'critical',
    data: {
      ...slashOutcomeFacts(outcome, chunk.chainId, {
        canonical: true,
        correctionGeneration: generation,
      }),
      restorationCheckpoint: {
        blockNumber: String(chunk.toBlock),
        blockHash: chunk.toBlockHash,
      },
    },
    observedAt,
  };
}

function slashOutcomeFacts(outcome, chainId, extra = {}) {
  return {
    certainty: 'confirmed',
    chainId,
    validator: outcome.validator ?? outcome.address,
    actualAmount: String(outcome.amount ?? outcome.actualAmount),
    logCount: Number(outcome.logCount),
    logIndexes: outcome.logIndexes ?? [],
    rollupAddress: outcome.rollupAddress,
    blockNumber: String(outcome.blockNumber),
    blockHash: outcome.blockHash,
    transactionHash: outcome.transactionHash,
    ...extra,
  };
}

function toSlashOutcome(row) {
  return {
    id: row.id,
    address: row.validator,
    actualAmount: String(row.amount),
    logCount: Number(row.log_count ?? row.logCount),
    logIndexes: parseJson(row.log_indexes_json, row.logIndexes ?? []),
    canonical: Boolean(row.canonical),
    chainId: Number(row.chain_id ?? row.chainId),
    rollupAddress: row.rollup_address ?? row.rollupAddress,
    blockNumber: String(row.block_number ?? row.blockNumber),
    blockHash: row.block_hash ?? row.blockHash,
    transactionHash: row.transaction_hash ?? row.transactionHash,
    firstObservedAt: toIso(row.first_seen_at ?? row.firstSeenAt),
    observedAt: toIso(row.last_seen_at ?? row.lastSeenAt),
  };
}

function toMonitorCase(row) {
  const details = parseJson(row.details_json, {});
  const actions = parseJson(row.actions_json, []);
  const phase = monitorCasePhase(row, details);
  const quorum = safePositiveInteger(details.parameters?.quorum, 'case quorum');
  const executableSlot = safeUnsignedBigIntString(details.executableSlot, 'case executable slot');
  const expirySlot = safeUnsignedBigIntString(details.expirySlot, 'case expiry slot');
  const executableAt = slotTimestamp(executableSlot, details);
  const expiryAt = slotTimestamp(expirySlot, details);
  if (!executableAt || !expiryAt) throw new Error('Persisted L1 case has incomplete timing');
  return {
    id: row.id,
    role: row.stack_role,
    round: String(row.round),
    phase,
    outcome: monitorCaseOutcome(row, details),
    votesCast: String(row.ballot_count),
    quorum,
    targetEpochs: details.targetEpochs ?? [],
    targets: aggregateSlashActions(actions),
    proposerAddress: row.proposer_address,
    slasherAddress: row.slasher_address,
    payloadAddress: row.payload_address,
    currentPayloadVetoed: Boolean(row.is_vetoed),
    executableSlot,
    executableAt,
    expirySlot,
    expiryAt,
    isExecutionPaused: Boolean(details.isExecutionPaused),
    pauseEndsAtSlot: details.pauseEndsAtSlot ?? null,
    pauseEndsAt: slotTimestamp(details.pauseEndsAtSlot ?? null, details),
    blockNumber: String(row.block_number),
    blockHash: row.block_hash,
    firstObservedAt: toIso(row.first_seen_at),
    observedAt: toIso(row.last_seen_at),
  };
}

export function aggregateSlashActions(actions) {
  const byAddress = new Map();
  for (const action of actions ?? []) {
    const address = String(action.validator ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) continue;
    const current = byAddress.get(address) ?? {
      address,
      proposedAmount: '0',
      actionCount: 0,
    };
    current.proposedAmount = (
      BigInt(current.proposedAmount) +
      BigInt(action.amount ?? action.slashAmount ?? 0)
    ).toString();
    current.actionCount += 1;
    byAddress.set(address, current);
  }
  return [...byAddress.values()].sort((left, right) => left.address.localeCompare(right.address));
}

function monitorCasePhase(row, details) {
  if (monitorCaseOutcome(row, details) !== null) return 'closed';
  if (details.isExecutionPaused && ['newly-executable', 'executable'].includes(row.status)) return 'paused';
  if (['newly-executable', 'executable'].includes(row.status)) return 'ready';
  if (isVotingClosed(row.round, details.currentRound)) return 'review';
  return 'voting';
}

function monitorCaseOutcome(row, details) {
  if (row.is_executed || row.status === 'executed') return 'executed';
  if (row.status === 'stack-retired') return 'stack-retired';
  if (row.status === 'vetoed') return 'vetoed';
  if (row.status === 'no-consensus') return 'no-consensus';
  if (row.is_vetoed && isVotingClosed(row.round, details.currentRound)) return 'vetoed';
  if (row.status === 'expired') return 'expired';
  return null;
}

function stableId(...parts) {
  return createHash('sha256').update(parts.map(String).join('|')).digest('hex');
}

function assertCompleteL1Cases(snapshot) {
  let timing;
  for (const stack of snapshot.stacks) {
    if (!stack || !Array.isArray(stack.rounds)) {
      throw new Error('Refusing to persist an incomplete L1 stack');
    }
    safeUnsignedBigIntString(stack.currentRound, 'stack current round');
    safePositiveInteger(stack.parameters?.lifetimeInRounds, 'case lifetime');
    if (stack.rounds.length === 0) continue;
    timing ??= {
      l1GenesisTime: safeUnsignedBigIntString(snapshot.l1GenesisTime, 'L1 genesis time'),
      slotDuration: safePositiveInteger(snapshot.slotDuration, 'slot duration'),
    };
    safePositiveInteger(stack.parameters?.quorum, 'case quorum');
    for (const round of stack.rounds) {
      const executableSlot = safeUnsignedBigIntString(
        round.executableSlot,
        'case executable slot',
      );
      const expirySlot = safeUnsignedBigIntString(round.expirySlot, 'case expiry slot');
      if (BigInt(expirySlot) <= BigInt(executableSlot)) {
        throw new Error('L1 case expiry must follow its executable slot');
      }
      if (!slotTimestamp(executableSlot, timing) || !slotTimestamp(expirySlot, timing)) {
        throw new Error('Refusing to persist an L1 case with invalid timing');
      }
    }
  }
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
    const validator = normalizeHexAddress(log.validator, 'Slashed log validator');
    if (!Number.isSafeInteger(log.logIndex) || log.logIndex < 0) throw new Error('Slashed log index is invalid');
    if (!/^\d+$/.test(String(log.amount))) throw new Error('Slashed log amount is invalid');
    return {
      rollupAddress,
      blockNumber,
      blockHash: normalizeHash(log.blockHash, 'Slashed log block hash'),
      transactionHash: normalizeHash(log.transactionHash, 'Slashed log transaction hash'),
      logIndex: log.logIndex,
      validator,
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

function safeUnsignedInteger(value, label) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is out of range`);
  }
  return Number(parsed);
}

function safePositiveInteger(value, label) {
  const parsed = safeUnsignedInteger(value, label);
  if (parsed < 1) throw new Error(`${label} must be positive`);
  return parsed;
}

function checkedProduct(...input) {
  const label = input.pop();
  const result = input.reduce((product, value) => product * value, 1);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label} is out of range`);
  }
  return result;
}

function optionalUnsignedBigIntString(value) {
  if (value === null || value === undefined) return null;
  return safeUnsignedBigIntString(value, 'optional protocol value');
}

function safeUnsignedBigIntString(value, label) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (parsed < 0n) throw new Error(`${label} must be unsigned`);
  return parsed.toString();
}

function normalizeValidator(value) {
  return normalizeHexAddress(value, 'validator');
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

function l1DatasetCoverage(state) {
  const observedAt = toIso(state?.lastSuccessAt);
  return {
    observedAt,
    blockNumber: state?.lastBlockNumber ?? null,
    blockHash: state?.lastBlockHash ?? null,
    complete: observedAt !== null && !Boolean(state?.metadata?.degraded),
  };
}

function slashDatasetCoverage(state) {
  const observedAt = toIso(state?.lastSuccessAt);
  return {
    observedAt,
    fromBlock: state?.metadata?.lookbackStartBlock ?? null,
    blockNumber: state?.lastBlockNumber ?? null,
    blockHash: state?.lastBlockHash ?? null,
    confirmedBlockNumber: state?.metadata?.confirmedBlockNumber ?? null,
    complete: observedAt !== null &&
      state?.metadata?.caughtUp === true &&
      !Boolean(state?.metadata?.degraded),
  };
}

function toIso(value) {
  return value === null || value === undefined ? null : new Date(Number(value)).toISOString();
}
