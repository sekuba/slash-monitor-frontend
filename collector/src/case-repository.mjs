import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  caseIdFor,
  projectCases,
  summarizeNetwork,
  transitionFor,
} from '../../shared/protocol/index.ts';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const MISSED_DUTIES = new Set([
  'checkpoint-invalid',
  'checkpoint-unvalidated',
  'checkpoint-missed',
  'blocks-missed',
  'attestation-missed',
]);
const DUTY_STATUSES = new Set([
  'checkpoint-mined',
  'checkpoint-valid',
  'checkpoint-invalid',
  'checkpoint-unvalidated',
  'checkpoint-missed',
  'blocks-missed',
  'attestation-sent',
  'attestation-missed',
]);
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60_000;
const TOKEN_RETENTION_MS = 24 * 60 * 60_000;

export class CaseRepository {
  constructor(databasePath) {
    if (databasePath !== ':memory:') {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = FULL');
      this.db.exec('PRAGMA foreign_keys = ON');
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.initializeSchema();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  initializeSchema() {
    const version = Number(this.db.prepare('PRAGMA user_version').get().user_version);
    const tableCount = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).get().count);
    if (version === 3 && tableCount > 0) return;
    if (version !== 0 || tableCount !== 0) {
      throw new Error(`slashveto.me v3 requires an empty database; found schema ${version}`);
    }
    this.db.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE runtime_identity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        network TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        registry_address TEXT NOT NULL
      );

      CREATE TABLE source_state (
        source TEXT PRIMARY KEY,
        last_attempt_at INTEGER,
        last_success_at INTEGER,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        successful_polls INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_block_number TEXT,
        last_block_hash TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE protocol_snapshot (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        snapshot_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE observations (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        sequencer TEXT NOT NULL,
        lineage_id TEXT NOT NULL,
        target_epoch TEXT NOT NULL,
        slot TEXT,
        round TEXT,
        observed_at INTEGER NOT NULL,
        block_number TEXT,
        block_hash TEXT,
        transaction_hash TEXT,
        canonical INTEGER NOT NULL CHECK (canonical IN (0, 1)),
        observation_json TEXT NOT NULL
      );
      CREATE INDEX observations_case_idx
        ON observations(network, lineage_id, sequencer, target_epoch, observed_at, id);
      CREATE INDEX observations_source_block_idx
        ON observations(source, block_number, canonical);

      CREATE TABLE cases (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        sequencer TEXT NOT NULL,
        lineage_id TEXT NOT NULL,
        target_epoch TEXT NOT NULL,
        stage TEXT NOT NULL,
        urgency TEXT NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        last_observed_at INTEGER NOT NULL,
        case_json TEXT NOT NULL
      );
      CREATE INDEX cases_address_idx
        ON cases(network, sequencer, active DESC, last_observed_at DESC);
      CREATE INDEX cases_network_idx
        ON cases(network, active DESC, urgency, last_observed_at DESC);

      CREATE TABLE case_transitions (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        sequencer TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        severity TEXT NOT NULL,
        transition_json TEXT NOT NULL
      );
      CREATE INDEX case_transitions_case_idx
        ON case_transitions(case_id, observed_at, id);

      CREATE TABLE offense_state (
        id TEXT PRIMARY KEY,
        offense_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
        missed_polls INTEGER NOT NULL DEFAULT 0,
        last_seen_sequence INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE sentinel_epoch_index (
        epoch INTEGER PRIMARY KEY,
        coverage_generation INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );
      CREATE TABLE sentinel_performance (
        sequencer TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        missed INTEGER NOT NULL,
        total INTEGER NOT NULL,
        inactive INTEGER NOT NULL CHECK (inactive IN (0, 1)),
        streak INTEGER NOT NULL,
        threshold INTEGER NOT NULL,
        target_percentage REAL NOT NULL,
        coverage_generation INTEGER NOT NULL,
        first_missed_slot INTEGER,
        last_missed_slot INTEGER,
        PRIMARY KEY(sequencer, epoch)
      );

      CREATE TABLE watches (
        id TEXT PRIMARY KEY,
        management_token_hash TEXT NOT NULL,
        network TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE watch_addresses (
        watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
        sequencer TEXT NOT NULL,
        PRIMARY KEY(watch_id, sequencer)
      );
      CREATE INDEX watch_addresses_target_idx
        ON watch_addresses(sequencer, watch_id);

      CREATE TABLE delivery_endpoints (
        id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('web_push', 'telegram')),
        destination TEXT,
        config_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(watch_id, kind)
      );
      CREATE UNIQUE INDEX telegram_chat_idx
        ON delivery_endpoints(destination)
        WHERE kind = 'telegram' AND destination IS NOT NULL;

      CREATE TABLE telegram_links (
        token_hash TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE telegram_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        update_offset INTEGER
      );
      INSERT INTO telegram_state(singleton) VALUES (1);

      CREATE TABLE deliveries (
        id TEXT PRIMARY KEY,
        endpoint_id TEXT NOT NULL REFERENCES delivery_endpoints(id) ON DELETE CASCADE,
        transition_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        leased_until INTEGER,
        event_json TEXT NOT NULL,
        last_error TEXT,
        provider_message_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(endpoint_id, transition_id)
      );
      CREATE INDEX deliveries_ready_idx
        ON deliveries(status, next_attempt_at, created_at);

      PRAGMA user_version = 3;
      COMMIT;
    `);
  }

  close() {
    this.db.close();
  }

  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = action();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  bindRuntimeIdentity(identity) {
    const normalized = {
      network: network(identity?.network),
      chainId: positiveInteger(identity?.chainId, 'chain id'),
      registryAddress: address(identity?.registryAddress, 'Registry'),
    };
    return this.transaction(() => {
      const existing = this.db.prepare(`
        SELECT network, chain_id AS chainId, registry_address AS registryAddress
        FROM runtime_identity WHERE singleton = 1
      `).get();
      if (!existing) {
        this.db.prepare(`
          INSERT INTO runtime_identity(singleton, network, chain_id, registry_address)
          VALUES (1, ?, ?, ?)
        `).run(normalized.network, normalized.chainId, normalized.registryAddress);
        return normalized;
      }
      if (
        existing.network !== normalized.network ||
        Number(existing.chainId) !== normalized.chainId ||
        existing.registryAddress !== normalized.registryAddress
      ) {
        throw new Error(
          `slashveto.me v3 database belongs to ${existing.network} chain ${existing.chainId} ` +
          `Registry ${existing.registryAddress}`,
        );
      }
      return normalized;
    });
  }

  ensureSource(source) {
    this.db.prepare('INSERT OR IGNORE INTO source_state(source) VALUES (?)').run(source);
  }

  recordSourceAttempt(source, at = Date.now()) {
    this.ensureSource(source);
    this.db.prepare(`
      UPDATE source_state SET last_attempt_at = ? WHERE source = ?
    `).run(at, source);
  }

  recordSourceSuccess(source, metadata = {}, at = Date.now(), checkpoint = {}) {
    this.ensureSource(source);
    this.db.prepare(`
      UPDATE source_state
      SET last_attempt_at = ?, last_success_at = ?, consecutive_failures = 0,
        successful_polls = successful_polls + 1, last_error = NULL,
        last_block_number = COALESCE(?, last_block_number),
        last_block_hash = COALESCE(?, last_block_hash),
        metadata_json = ?
      WHERE source = ?
    `).run(
      at,
      at,
      checkpoint.blockNumber ?? null,
      checkpoint.blockHash ?? null,
      JSON.stringify(metadata ?? {}),
      source,
    );
  }

  recordSourceFailure(source, error, at = Date.now()) {
    this.ensureSource(source);
    this.db.prepare(`
      UPDATE source_state
      SET last_attempt_at = ?, consecutive_failures = consecutive_failures + 1,
        last_error = ?
      WHERE source = ?
    `).run(at, truncate(error), source);
  }

  getSourceState(source) {
    const row = this.db.prepare(`
      SELECT source, last_attempt_at AS lastAttemptAt,
        last_success_at AS lastSuccessAt,
        consecutive_failures AS consecutiveFailures,
        successful_polls AS successfulPolls,
        last_error AS lastError,
        last_block_number AS lastBlockNumber,
        last_block_hash AS lastBlockHash,
        metadata_json AS metadataJson
      FROM source_state WHERE source = ?
    `).get(source);
    if (!row) return undefined;
    return {
      ...row,
      metadata: parseJson(row.metadataJson, {}),
    };
  }

  recordAttempt(at = Date.now()) {
    this.recordSourceAttempt('aztec_node', at);
  }

  recordFailure(error, at = Date.now()) {
    this.recordSourceFailure('aztec_node', error, at);
  }

  getSyncState() {
    const state = this.getSourceState('aztec_node');
    return {
      lastAttemptAt: state?.lastAttemptAt ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      consecutiveFailures: Number(state?.consecutiveFailures ?? 0),
      successfulPolls: Number(state?.successfulPolls ?? 0),
      lastError: state?.lastError ?? null,
    };
  }

  getProtocolSnapshot() {
    const row = this.db.prepare(`
      SELECT snapshot_json AS snapshotJson FROM protocol_snapshot WHERE singleton = 1
    `).get();
    return row ? parseJson(row.snapshotJson, null) : null;
  }

  setProtocolSnapshot(snapshot, at = Date.now()) {
    this.db.prepare(`
      INSERT INTO protocol_snapshot(singleton, snapshot_json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(snapshot), at);
  }

  recordObservations(observations, {
    protocol,
    notify = true,
  } = {}) {
    return this.transaction(() => {
      if (protocol) this.setProtocolSnapshot(protocol, Date.parse(protocol.observedAt));
      return this.insertObservations(observations, { notify });
    });
  }

  insertObservations(observations, {
    notify = true,
    affectedCaseIds = [],
  } = {}) {
    const insert = this.db.prepare(`
      INSERT INTO observations (
        id, network, source, kind, sequencer, lineage_id, target_epoch,
        slot, round, observed_at, block_number, block_hash, transaction_hash,
        canonical, observation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        observed_at = excluded.observed_at,
        canonical = excluded.canonical,
        observation_json = excluded.observation_json
      WHERE observations.canonical <> excluded.canonical
    `);
    const affected = new Set(affectedCaseIds);
    let inserted = 0;
    for (const input of observations ?? []) {
      const observation = normalizeObservation(input);
      const at = Date.parse(observation.provenance.observedAt);
      const result = insert.run(
        observation.id,
        observation.network,
        observation.source,
        observation.kind,
        observation.sequencer,
        observation.lineageId,
        observation.targetEpoch,
        observation.slot ?? null,
        observation.round ?? null,
        at,
        observation.provenance.blockNumber ?? null,
        observation.provenance.blockHash ?? null,
        observation.provenance.transactionHash ?? null,
        Number(observation.provenance.canonical),
        JSON.stringify(observation),
      );
      if (Number(result.changes) > 0) {
        inserted += 1;
        affected.add(caseIdFor(observation));
      }
    }
    const projection = this.reprojectCases([...affected], { notify });
    return {
      inserted,
      casesChanged: projection.changed,
      transitions: projection.transitions,
      queued: projection.queued,
    };
  }

  reprojectCases(caseIds, { notify = true } = {}) {
    const protocol = this.getProtocolSnapshot();
    let changed = 0;
    let transitions = 0;
    let queued = 0;
    for (const caseId of caseIds) {
      const rows = this.db.prepare(`
        SELECT observation_json AS observationJson
        FROM observations
        WHERE network || ':' || lineage_id || ':' || sequencer || ':' || target_epoch =
          substr(?, 6)
        ORDER BY observed_at, id
      `).all(caseId);
      if (rows.length === 0) continue;
      const observations = rows.map((row) => parseJson(row.observationJson, null));
      const current = projectCases(observations, protocol)[0];
      if (!current) continue;
      const previousRow = this.db.prepare(`
        SELECT case_json AS caseJson FROM cases WHERE id = ?
      `).get(caseId);
      const previous = previousRow ? parseJson(previousRow.caseJson, null) : null;
      const currentJson = JSON.stringify(current);
      if (previousRow?.caseJson === currentJson) continue;
      this.db.prepare(`
        INSERT INTO cases (
          id, network, sequencer, lineage_id, target_epoch, stage, urgency,
          active, last_observed_at, case_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          stage = excluded.stage,
          urgency = excluded.urgency,
          active = excluded.active,
          last_observed_at = excluded.last_observed_at,
          case_json = excluded.case_json
      `).run(
        current.id,
        current.network,
        current.sequencer,
        current.lineageId,
        current.targetEpoch,
        current.state.stage,
        current.state.urgency,
        Number(current.state.active),
        Date.parse(current.lastObservedAt),
        currentJson,
      );
      changed += 1;
      const transition = transitionFor(previous, current);
      if (!transition) continue;
      const insertedTransition = this.db.prepare(`
        INSERT OR IGNORE INTO case_transitions (
          id, case_id, sequencer, observed_at, severity, transition_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        transition.id,
        transition.caseId,
        transition.sequencer,
        Date.parse(transition.observedAt),
        transition.severity,
        JSON.stringify(transition),
      );
      if (Number(insertedTransition.changes) === 0) continue;
      transitions += 1;
      if (notify) queued += this.enqueueTransition(transition, current);
    }
    return { changed, transitions, queued };
  }

  listCases({ network: selectedNetwork, sequencers = [], active } = {}) {
    const clauses = [];
    const parameters = [];
    if (selectedNetwork) {
      clauses.push('network = ?');
      parameters.push(network(selectedNetwork));
    }
    if (sequencers.length > 0) {
      clauses.push(`sequencer IN (${sequencers.map(() => '?').join(',')})`);
      parameters.push(...sequencers.map((item) => address(item, 'sequencer')));
    }
    if (active !== undefined) {
      clauses.push('active = ?');
      parameters.push(Number(Boolean(active)));
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT case_json AS caseJson FROM cases ${where}
      ORDER BY active DESC,
        CASE urgency WHEN 'critical' THEN 3 WHEN 'warning' THEN 2
          WHEN 'info' THEN 1 ELSE 0 END DESC,
        last_observed_at DESC
    `).all(...parameters).map((row) => parseJson(row.caseJson, null));
  }

  getCase(id) {
    const row = this.db.prepare(`
      SELECT case_json AS caseJson FROM cases WHERE id = ?
    `).get(id);
    if (!row) return null;
    const item = parseJson(row.caseJson, null);
    const transitions = this.db.prepare(`
      SELECT transition_json AS transitionJson FROM case_transitions
      WHERE case_id = ? ORDER BY observed_at, id
    `).all(id).map((entry) => parseJson(entry.transitionJson, null));
    return { ...item, transitions };
  }

  getSequencerRecord(sequencer, selectedNetwork) {
    const normalized = address(sequencer, 'sequencer');
    return {
      sequencer: normalized,
      protocol: this.getProtocolSnapshot(),
      cases: this.listCases({
        network: selectedNetwork,
        sequencers: [normalized],
      }),
    };
  }

  getNetworkSummary(selectedNetwork) {
    const cases = this.listCases({ network: selectedNetwork });
    return {
      protocol: this.getProtocolSnapshot(),
      summary: summarizeNetwork(cases),
      cases,
    };
  }

  markMissingL1ObservationsNonCanonical({
    fromBlock,
    toBlock,
    seenIds,
    invalidatedAt = new Date().toISOString(),
  }) {
    const rows = this.db.prepare(`
      SELECT id, observation_json AS observationJson
      FROM observations
      WHERE source = 'ethereum_l1'
        AND (
          kind IN ('l1_slash', 'stake_status')
          OR (
            kind = 'l1_round'
            AND json_extract(observation_json, '$.data.historicalExecution') = 1
          )
        )
        AND canonical = 1
        AND CAST(block_number AS INTEGER) BETWEEN ? AND ?
    `).all(Number(fromBlock), Number(toBlock));
    const seen = new Set(seenIds);
    const affected = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      const observation = parseJson(row.observationJson, null);
      observation.provenance.canonical = false;
      observation.provenance.invalidatedAt = toIso(invalidatedAt);
      this.db.prepare(`
        UPDATE observations SET canonical = 0, observation_json = ? WHERE id = ?
      `).run(JSON.stringify(observation), row.id);
      affected.push(caseIdFor(observation));
    }
    return this.reprojectCases([...new Set(affected)], { notify: true });
  }

  recordSuccessfulPoll(offenses, {
    observedAt = Date.now(),
    withdrawAfterMissedPolls = 3,
    network: selectedNetwork = 'mainnet',
    absenceEvidence,
    syncCursor,
    degradedError,
  } = {}) {
    return this.transaction(() => {
      const source = this.getSourceState('aztec_node');
      const sequence = Number(source?.successfulPolls ?? 0) + 1;
      const protocol = this.getProtocolSnapshot();
      const activeLineage = protocol?.lineages?.find((item) => item.role === 'active');
      if (!protocol || !activeLineage) {
        throw new Error('Cannot record node offenses before the canonical L1 lineage');
      }
      const epochDuration = positiveInteger(protocol.epochDurationSlots, 'epoch duration');
      const observations = [];
      let inserted = 0;
      let updated = 0;
      let reactivated = 0;

      for (const offense of offenses) {
        const existing = this.db.prepare(`
          SELECT offense_json AS offenseJson, status FROM offense_state WHERE id = ?
        `).get(offense.id);
        const offenseJson = JSON.stringify(offense);
        let changed = false;
        if (!existing) {
          inserted += 1;
          changed = true;
        } else if (existing.status === 'withdrawn') {
          reactivated += 1;
          changed = true;
        } else if (existing.offenseJson !== offenseJson) {
          updated += 1;
          changed = true;
        }
        this.db.prepare(`
          INSERT INTO offense_state (
            id, offense_json, status, missed_polls, last_seen_sequence, updated_at
          ) VALUES (?, ?, 'active', 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            offense_json = excluded.offense_json,
            status = 'active',
            missed_polls = 0,
            last_seen_sequence = excluded.last_seen_sequence,
            updated_at = excluded.updated_at
        `).run(offense.id, offenseJson, sequence, observedAt);
        if (changed) {
          observations.push(nodeOffenseObservation({
            offense,
            status: 'active',
            protocol,
            lineage: activeLineage,
            epochDuration,
            network: selectedNetwork,
            observedAt,
          }));
        }
      }

      let withdrawn = 0;
      if (hasAdvancingAbsence(absenceEvidence)) {
        const missing = this.db.prepare(`
          SELECT id, offense_json AS offenseJson, missed_polls AS missedPolls
          FROM offense_state WHERE status = 'active' AND last_seen_sequence < ?
        `).all(sequence);
        for (const row of missing) {
          const offense = parseJson(row.offenseJson, null);
          if (!canAdvanceOffenseAbsence(offense, absenceEvidence)) continue;
          const missedPolls = Number(row.missedPolls) + 1;
          const status = missedPolls >= withdrawAfterMissedPolls ? 'withdrawn' : 'active';
          this.db.prepare(`
            UPDATE offense_state SET missed_polls = ?, status = ?, updated_at = ?
            WHERE id = ?
          `).run(missedPolls, status, observedAt, row.id);
          if (status === 'withdrawn') {
            withdrawn += 1;
            observations.push(nodeOffenseObservation({
              offense,
              status,
              protocol,
              lineage: activeLineage,
              epochDuration,
              network: selectedNetwork,
              observedAt,
            }));
          }
        }
      }

      if (syncCursor !== undefined) {
        this.recordSourceSuccess('aztec_sync', syncCursor, observedAt);
      }
      const projection = this.insertObservations(observations);
      if (degradedError) {
        this.recordSourceFailure('aztec_node', degradedError, observedAt);
      } else {
        this.recordSourceSuccess('aztec_node', {
          observed: offenses.length,
          sequence,
        }, observedAt);
      }
      return {
        sequence,
        observed: offenses.length,
        inserted,
        updated,
        reactivated,
        withdrawn,
        transitions: projection.transitions,
        queued: projection.queued,
        degraded: Boolean(degradedError),
        ...(degradedError ? { error: truncate(degradedError) } : {}),
      };
    });
  }

  getValidatorIndexCursor() {
    const row = this.db.prepare(`
      SELECT epoch, coverage_generation AS coverageGeneration
      FROM sentinel_epoch_index ORDER BY epoch DESC LIMIT 1
    `).get();
    return row
      ? { epoch: Number(row.epoch), coverageGeneration: Number(row.coverageGeneration) }
      : undefined;
  }

  recordValidatorEpoch(epochSnapshot, inactivityConfig, {
    epochDuration,
    network: selectedNetwork,
    observedAt = Date.now(),
    bootstrap = false,
    coverageGeneration = 0,
  }) {
    const protocol = this.getProtocolSnapshot();
    const lineage = protocol?.lineages?.find((item) => item.role === 'active');
    if (!protocol || !lineage) throw new Error('Canonical L1 lineage is unavailable');
    const epoch = unsignedInteger(epochSnapshot?.epoch, 'validator epoch');
    const duration = positiveInteger(epochDuration, 'epoch duration');
    const fromSlot = unsignedInteger(epochSnapshot?.fromSlot, 'epoch from slot');
    const toSlot = unsignedInteger(epochSnapshot?.toSlot, 'epoch to slot');
    if (fromSlot !== epoch * duration || toSlot !== fromSlot + duration - 1) {
      throw new Error(`validator epoch ${epoch} does not match its slot range`);
    }
    const committee = (epochSnapshot?.committee ?? []).map((item) => address(item, 'committee member'));
    if (committee.length === 0 || new Set(committee).size !== committee.length) {
      throw new Error(`validator epoch ${epoch} has an invalid committee`);
    }
    const targetPercentage = Number(inactivityConfig?.targetPercentage);
    const threshold = positiveInteger(
      inactivityConfig?.consecutiveEpochThreshold,
      'inactivity threshold',
    );
    if (!Number.isFinite(targetPercentage) || targetPercentage < 0 || targetPercentage > 1) {
      throw new Error('inactivity target percentage must be between 0 and 1');
    }
    const responseByAddress = new Map();
    let minimumProcessedSlot;
    for (const response of epochSnapshot?.validators ?? []) {
      const sequencer = address(response?.sequencer, 'validator response');
      if (!committee.includes(sequencer) || responseByAddress.has(sequencer)) {
        throw new Error(`unexpected validator response for ${sequencer}`);
      }
      const lastProcessed = unsignedInteger(
        response?.lastProcessedSlot,
        `last processed slot for ${sequencer}`,
      );
      if (lastProcessed < toSlot) {
        throw new Error(`Sentinel has not completed epoch ${epoch} for ${sequencer}`);
      }
      minimumProcessedSlot = minimumProcessedSlot === undefined
        ? lastProcessed
        : Math.min(minimumProcessedSlot, lastProcessed);
      const history = normalizeDutyHistory(response?.history, {
        sequencer,
        fromSlot,
        toSlot,
      });
      const summary = summarizeDutyHistory(history);
      const aggregate = (response?.allTimeEpochPerformance ?? []).find(
        (item) => unsignedInteger(item?.epoch, 'performance epoch') === epoch,
      );
      if (
        !aggregate ||
        unsignedInteger(aggregate.missed, 'aggregate missed') !== summary.missed ||
        unsignedInteger(aggregate.total, 'aggregate total') !== summary.total
      ) {
        throw new Error(`Sentinel history disagrees with epoch ${epoch} aggregate for ${sequencer}`);
      }
      responseByAddress.set(sequencer, { history, ...summary });
    }
    if (responseByAddress.size === 0 || minimumProcessedSlot === undefined) {
      throw new Error(`Sentinel returned no evaluated data for epoch ${epoch}`);
    }

    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM sentinel_epoch_index WHERE epoch = ?').get(epoch)) {
        throw new Error(`validator epoch ${epoch} is already indexed`);
      }
      const observations = [];
      let inactiveEpochs = 0;
      let dutiesInserted = 0;
      for (const sequencer of committee) {
        const performance = responseByAddress.get(sequencer) ?? {
          history: [],
          missed: 0,
          total: 0,
          firstMissedSlot: null,
          lastMissedSlot: null,
        };
        dutiesInserted += performance.history.length;
        const inactive = performance.total > 0 &&
          performance.missed / performance.total >= targetPercentage;
        const prior = this.db.prepare(`
          SELECT inactive, streak FROM sentinel_performance
          WHERE sequencer = ? AND epoch < ? AND coverage_generation = ?
          ORDER BY epoch DESC LIMIT 1
        `).get(sequencer, epoch, coverageGeneration);
        const streak = inactive ? (Number(prior?.inactive) ? Number(prior.streak) + 1 : 1) : 0;
        this.db.prepare(`
          INSERT INTO sentinel_performance (
            sequencer, epoch, missed, total, inactive, streak, threshold,
            target_percentage, coverage_generation, first_missed_slot,
            last_missed_slot
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sequencer,
          epoch,
          performance.missed,
          performance.total,
          Number(inactive),
          streak,
          threshold,
          targetPercentage,
          coverageGeneration,
          performance.firstMissedSlot,
          performance.lastMissedSlot,
        );
        if (performance.firstMissedSlot !== null) {
          observations.push(sentinelObservation({
            kind: 'duty_miss',
            network: selectedNetwork,
            lineage,
            sequencer,
            epoch,
            observedAt,
            l1BlockNumber: epochSnapshot.l1BlockNumber,
            l1BlockHash: epochSnapshot.l1BlockHash,
            data: {
              epoch,
              slot: String(performance.firstMissedSlot),
              status: performance.history.find((item) =>
                item.slot === performance.firstMissedSlot)?.status ?? 'missed',
            },
          }));
        }
        if (inactive) {
          inactiveEpochs += 1;
          observations.push(sentinelObservation({
            kind: 'inactivity_epoch',
            network: selectedNetwork,
            lineage,
            sequencer,
            epoch,
            observedAt,
            l1BlockNumber: epochSnapshot.l1BlockNumber,
            l1BlockHash: epochSnapshot.l1BlockHash,
            data: {
              epoch,
              missed: performance.missed,
              total: performance.total,
              firstMissedSlot: performance.firstMissedSlot === null
                ? null
                : String(performance.firstMissedSlot),
              lastMissedSlot: performance.lastMissedSlot === null
                ? null
                : String(performance.lastMissedSlot),
              streak,
              threshold,
              targetPercentage,
            },
          }));
        }
      }
      this.db.prepare(`
        INSERT INTO sentinel_epoch_index(epoch, coverage_generation, indexed_at)
        VALUES (?, ?, ?)
      `).run(epoch, coverageGeneration, observedAt);
      const snapshot = {
        ...protocol,
        inactivity: {
          targetPercentage,
          consecutiveEpochs: threshold,
        },
      };
      this.setProtocolSnapshot(snapshot, observedAt);
      const projection = this.insertObservations(observations, { notify: !bootstrap });
      return {
        epoch: String(epoch),
        committeeSize: committee.length,
        validatorsWithHistory: responseByAddress.size,
        dutiesInserted,
        epochsFinalized: committee.length,
        inactiveEpochs,
        transitions: projection.transitions,
        nodeLastProcessedSlot: String(minimumProcessedSlot),
        coverageGeneration,
      };
    });
  }

  recordSuccessfulL1Snapshot(selectedNetwork, snapshot, {
    observedAt = Date.now(),
  } = {}) {
    return this.transaction(() => {
      const protocol = protocolFromL1Snapshot(
        selectedNetwork,
        snapshot,
        this.getProtocolSnapshot()?.inactivity ?? null,
      );
      this.setProtocolSnapshot(protocol, observedAt);
      const observations = observationsFromL1Snapshot(selectedNetwork, snapshot, protocol);
      const reconciled = this.reconcileL1RoundObservations(snapshot, observations);
      const projection = this.insertObservations(observations, {
        affectedCaseIds: reconciled,
      });
      const metadata = {
        rollupAddress: snapshot.rollupAddress,
        currentSlot: snapshot.currentSlot,
        currentEpoch: snapshot.currentEpoch,
        epochDuration: snapshot.epochDuration,
        slotDuration: snapshot.slotDuration,
        protocol,
        roundCursors: snapshot.stacks.flatMap((stack) =>
          stack.rounds.map((round) => ({
            proposerAddress: stack.proposerAddress,
            round: round.round,
            ballotCount: round.ballotCount,
            earlyTargets: round.earlyTargets,
          }))),
      };
      this.recordSourceSuccess('l1', metadata, observedAt, {
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
      });
      return {
        changed: projection.casesChanged,
        transitions: projection.transitions,
        queued: projection.queued,
      };
    });
  }

  reconcileL1RoundObservations(snapshot, current) {
    const seen = new Set(current.map((item) => item.id));
    const coverage = new Set((snapshot.stacks ?? []).flatMap((stack) =>
      (stack.rounds ?? []).map((round) =>
        `${address(stack.proposerAddress, 'SlashingProposer')}:${unsignedString(round.round, 'round')}`)));
    if (coverage.size === 0) return [];
    const rows = this.db.prepare(`
      SELECT id, lineage_id AS lineageId, round, observation_json AS observationJson
      FROM observations
      WHERE source = 'ethereum_l1' AND kind = 'l1_round' AND canonical = 1
    `).all();
    const affected = new Set();
    for (const row of rows) {
      if (!coverage.has(`${row.lineageId}:${row.round}`) || seen.has(row.id)) continue;
      const observation = parseJson(row.observationJson, null);
      observation.provenance.canonical = false;
      observation.provenance.invalidatedAt = toIso(
        snapshot.blockTimestamp ?? snapshot.observedAt,
      );
      this.db.prepare(`
        UPDATE observations SET canonical = 0, observation_json = ? WHERE id = ?
      `).run(JSON.stringify(observation), row.id);
      affected.add(caseIdFor(observation));
    }
    return [...affected];
  }

  recordSuccessfulL1SlashLogChunk(selectedNetwork, chunk, {
    observedAt = Date.now(),
  } = {}) {
    return this.transaction(() => {
      const observations = [];
      const seenIds = [];
      for (const log of chunk.logs ?? []) {
        let execution = findExecutionForSlash(this.db, log);
        if (execution) {
          assertExecutionMatchesContext(execution, log);
        } else if (log.executionContext) {
          execution = historicalRoundObservation({
            network: selectedNetwork,
            log,
            observedAt,
          });
          observations.push(execution);
          seenIds.push(execution.id);
        }
        const observation = slashObservation({
          network: selectedNetwork,
          log,
          execution,
          observedAt,
        });
        observations.push(observation);
        seenIds.push(observation.id);
        if (log.ejected) {
          const stakeStatus = stakeStatusObservation({
            slash: observation,
            status: log.attesterStatus,
          });
          observations.push(stakeStatus);
          seenIds.push(stakeStatus.id);
        }
      }
      let corrections = 0;
      if (chunk.reorgDetected) {
        const correction = this.markMissingL1ObservationsNonCanonical({
          fromBlock: chunk.fromBlock,
          toBlock: chunk.toBlock,
          seenIds,
          invalidatedAt: observedAt,
        });
        corrections = correction.changed;
      }
      const projection = this.insertObservations(observations, {
        notify: !chunk.initialBackfill,
      });
      this.recordSourceSuccess('l1_slash_logs', {
        initialBackfill: Boolean(chunk.initialBackfill && chunk.hasMore),
        backfillStartBlock: chunk.backfillStartBlock ?? null,
        confirmedBlockNumber: chunk.confirmedBlockNumber,
        rollupAddresses: chunk.rollupAddresses,
      }, observedAt, {
        blockNumber: chunk.toBlock,
        blockHash: chunk.toBlockHash,
      });
      return {
        inserted: projection.inserted,
        queued: projection.queued,
        corrections,
        fromBlock: chunk.fromBlock,
        toBlock: chunk.toBlock,
        hasMore: chunk.hasMore,
        reorgDetected: chunk.reorgDetected,
      };
    });
  }

  getSourceStates() {
    return this.db.prepare(`
      SELECT source, last_attempt_at AS lastAttemptAt,
        last_success_at AS lastSuccessAt,
        consecutive_failures AS consecutiveFailures,
        successful_polls AS successfulPolls, last_error AS lastError,
        last_block_number AS lastBlockNumber, last_block_hash AS lastBlockHash,
        metadata_json AS metadataJson
      FROM source_state ORDER BY source
    `).all().map((row) => ({
      ...row,
      metadata: parseJson(row.metadataJson, {}),
    }));
  }

  createWatch({
    id = randomUUID(),
    managementTokenHash,
    network: selectedNetwork,
    addresses,
    now = Date.now(),
  }) {
    const normalizedAddresses = normalizeAddressList(addresses);
    return this.transaction(() => {
      this.db.prepare(`
        INSERT INTO watches(id, management_token_hash, network, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, managementTokenHash, network(selectedNetwork), now, now);
      this.replaceWatchAddresses(id, normalizedAddresses);
      return this.getWatch(id);
    });
  }

  getWatch(id) {
    const row = this.db.prepare(`
      SELECT id, management_token_hash AS managementTokenHash, network,
        created_at AS createdAt, updated_at AS updatedAt
      FROM watches WHERE id = ?
    `).get(id);
    if (!row) return null;
    const addresses = this.db.prepare(`
      SELECT sequencer FROM watch_addresses WHERE watch_id = ? ORDER BY sequencer
    `).all(id).map((item) => item.sequencer);
    const endpoints = this.db.prepare(`
      SELECT id, kind, enabled, verified, created_at AS createdAt,
        updated_at AS updatedAt
      FROM delivery_endpoints WHERE watch_id = ? ORDER BY kind
    `).all(id).map((item) => ({
      ...item,
      enabled: Boolean(item.enabled),
      verified: Boolean(item.verified),
    }));
    return { ...row, addresses, endpoints };
  }

  updateWatch(id, { addresses, now = Date.now() } = {}) {
    return this.transaction(() => {
      const current = this.getWatch(id);
      if (!current) return null;
      if (addresses !== undefined) {
        this.replaceWatchAddresses(id, normalizeAddressList(addresses));
        this.db.prepare('UPDATE watches SET updated_at = ? WHERE id = ?').run(now, id);
        this.deleteUnmatchedDeliveries(id);
      }
      return this.getWatch(id);
    });
  }

  deleteWatch(id) {
    return Number(this.db.prepare('DELETE FROM watches WHERE id = ?').run(id).changes) > 0;
  }

  replaceWatchAddresses(id, addresses) {
    this.db.prepare('DELETE FROM watch_addresses WHERE watch_id = ?').run(id);
    const insert = this.db.prepare(`
      INSERT INTO watch_addresses(watch_id, sequencer) VALUES (?, ?)
    `);
    for (const sequencer of addresses) insert.run(id, sequencer);
  }

  deleteUnmatchedDeliveries(watchId) {
    this.db.prepare(`
      DELETE FROM deliveries
      WHERE status IN ('pending', 'leased')
        AND endpoint_id IN (
          SELECT endpoint.id FROM delivery_endpoints endpoint
          WHERE endpoint.watch_id = ?
        )
        AND json_extract(event_json, '$.source') = 'case'
        AND NOT EXISTS (
          SELECT 1 FROM watch_addresses watched
          WHERE watched.watch_id = ?
            AND watched.sequencer =
              lower(json_extract(deliveries.event_json, '$.data.sequencer'))
        )
    `).run(watchId, watchId);
  }

  upsertEndpoint({
    watchId,
    kind,
    destination = null,
    configJson = null,
    now = Date.now(),
  }) {
    if (!['web_push', 'telegram'].includes(kind)) {
      throw new Error(`Unsupported notification channel: ${kind}`);
    }
    if (!this.getWatch(watchId)) return null;
    const id = stableId('endpoint', watchId, kind);
    this.db.prepare(`
      INSERT INTO delivery_endpoints(
        id, watch_id, kind, destination, config_json, enabled, verified,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      ON CONFLICT(watch_id, kind) DO UPDATE SET
        destination = excluded.destination,
        config_json = excluded.config_json,
        enabled = 1,
        verified = 1,
        updated_at = excluded.updated_at
    `).run(id, watchId, kind, destination, configJson, now, now);
    return this.getWatch(watchId);
  }

  deleteEndpoint(watchId, kind) {
    return Number(this.db.prepare(`
      DELETE FROM delivery_endpoints WHERE watch_id = ? AND kind = ?
    `).run(watchId, kind).changes) > 0;
  }

  createTelegramLink({ tokenHash, watchId, expiresAt, now = Date.now() }) {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM telegram_links WHERE expires_at <= ? OR watch_id = ?')
        .run(now, watchId);
      this.db.prepare(`
        INSERT INTO telegram_links(token_hash, watch_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(tokenHash, watchId, expiresAt, now);
      return { expiresAt };
    });
  }

  consumeTelegramLink(tokenHash, chatId, now = Date.now()) {
    return this.transaction(() => {
      const link = this.db.prepare(`
        SELECT watch_id AS watchId FROM telegram_links
        WHERE token_hash = ? AND expires_at > ?
      `).get(tokenHash, now);
      if (!link) return null;
      this.db.prepare(`
        DELETE FROM delivery_endpoints
        WHERE kind = 'telegram' AND destination = ?
      `).run(String(chatId));
      const endpointId = stableId('endpoint', link.watchId, 'telegram');
      this.db.prepare(`
        INSERT INTO delivery_endpoints(
          id, watch_id, kind, destination, config_json, enabled, verified,
          created_at, updated_at
        ) VALUES (?, ?, 'telegram', ?, NULL, 1, 1, ?, ?)
        ON CONFLICT(watch_id, kind) DO UPDATE SET
          destination = excluded.destination, enabled = 1, verified = 1,
          updated_at = excluded.updated_at
      `).run(endpointId, link.watchId, String(chatId), now, now);
      this.db.prepare('DELETE FROM telegram_links WHERE token_hash = ?').run(tokenHash);
      return this.getWatch(link.watchId);
    });
  }

  getWatchByTelegramChat(chatId) {
    const endpoint = this.db.prepare(`
      SELECT watch_id AS watchId, enabled FROM delivery_endpoints
      WHERE kind = 'telegram' AND destination = ?
    `).get(String(chatId));
    if (!endpoint) return null;
    const watch = this.getWatch(endpoint.watchId);
    return watch ? { ...watch, telegramEnabled: Boolean(endpoint.enabled) } : null;
  }

  setTelegramEndpointEnabled(chatId, enabled, now = Date.now()) {
    const result = this.db.prepare(`
      UPDATE delivery_endpoints SET enabled = ?, updated_at = ?
      WHERE kind = 'telegram' AND destination = ?
    `).run(Number(Boolean(enabled)), now, String(chatId));
    if (!enabled) {
      this.db.prepare(`
        DELETE FROM deliveries WHERE status IN ('pending', 'leased')
          AND endpoint_id IN (
            SELECT id FROM delivery_endpoints
            WHERE kind = 'telegram' AND destination = ?
          )
      `).run(String(chatId));
    }
    return Number(result.changes) > 0;
  }

  deleteTelegramEndpoint(chatId) {
    return Number(this.db.prepare(`
      DELETE FROM delivery_endpoints
      WHERE kind = 'telegram' AND destination = ?
    `).run(String(chatId)).changes) > 0;
  }

  getTelegramOffset() {
    return this.db.prepare(`
      SELECT update_offset AS offset FROM telegram_state WHERE singleton = 1
    `).get().offset ?? undefined;
  }

  setTelegramOffset(offset) {
    this.db.prepare(`
      UPDATE telegram_state SET update_offset = ? WHERE singleton = 1
    `).run(offset);
  }

  enqueueTransition(transition, currentCase) {
    const endpoints = this.db.prepare(`
      SELECT endpoint.id
      FROM delivery_endpoints endpoint
      JOIN watch_addresses watched ON watched.watch_id = endpoint.watch_id
      WHERE watched.sequencer = ? AND endpoint.enabled = 1
    `).all(transition.sequencer);
    if (endpoints.length === 0) return 0;
    const event = transitionEvent(transition, currentCase);
    const createdAt = Date.parse(transition.observedAt);
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO deliveries(
        id, endpoint_id, transition_id, status, attempts, next_attempt_at,
        event_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `);
    let queued = 0;
    for (const endpoint of endpoints) {
      queued += Number(insert.run(
        stableId('delivery', transition.id, endpoint.id),
        endpoint.id,
        transition.id,
        createdAt,
        JSON.stringify(event),
        createdAt,
        createdAt,
      ).changes);
    }
    return queued;
  }

  enqueueWatchTest(watchId, now = Date.now()) {
    const watch = this.getWatch(watchId);
    if (!watch) return 0;
    const endpoints = this.db.prepare(`
      SELECT id FROM delivery_endpoints WHERE watch_id = ? AND enabled = 1
    `).all(watchId);
    const event = {
      id: `test:${randomUUID()}`,
      network: watch.network,
      source: 'test',
      type: 'notification_test',
      severity: 'info',
      title: 'slashveto.me notifications are connected',
      body: `Watching ${watch.addresses.length} sequencer${watch.addresses.length === 1 ? '' : 's'}.`,
      targets: watch.addresses,
      data: { watchId },
      observedAt: new Date(now).toISOString(),
    };
    const insert = this.db.prepare(`
      INSERT INTO deliveries(
        id, endpoint_id, transition_id, status, attempts, next_attempt_at,
        event_json, created_at, updated_at
      ) VALUES (?, ?, NULL, 'pending', 0, ?, ?, ?, ?)
    `);
    for (const endpoint of endpoints) {
      insert.run(
        stableId('delivery-test', event.id, endpoint.id),
        endpoint.id,
        now,
        JSON.stringify(event),
        now,
        now,
      );
    }
    return endpoints.length;
  }

  recoverStuckDeliveries(cutoff) {
    return Number(this.db.prepare(`
      UPDATE deliveries SET status = 'pending', next_attempt_at = ?,
        leased_until = NULL, updated_at = ? WHERE status = 'leased'
        AND leased_until <= ?
    `).run(cutoff, cutoff, cutoff).changes);
  }

  claimDeliveries({ now = Date.now(), limit = 50, leaseMs = 120_000 } = {}) {
    return this.transaction(() => {
      this.recoverStuckDeliveries(now);
      const rows = this.db.prepare(`
        WITH due AS (
          SELECT delivery.id, delivery.endpoint_id,
            CASE json_extract(delivery.event_json, '$.severity')
              WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END AS priority,
            ROW_NUMBER() OVER (
              PARTITION BY delivery.endpoint_id
              ORDER BY
                CASE json_extract(delivery.event_json, '$.severity')
                  WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                delivery.next_attempt_at, delivery.created_at
            ) AS endpoint_rank
          FROM deliveries delivery
          JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
          WHERE delivery.status = 'pending' AND delivery.next_attempt_at <= ?
            AND endpoint.enabled = 1
            AND NOT EXISTS (
              SELECT 1 FROM deliveries active
              WHERE active.endpoint_id = delivery.endpoint_id
                AND active.status = 'leased'
            )
        )
        SELECT id FROM due WHERE endpoint_rank = 1
        ORDER BY priority, id LIMIT ?
      `).all(now, limit);
      const lease = this.db.prepare(`
        UPDATE deliveries SET status = 'leased', attempts = attempts + 1,
          leased_until = ?, updated_at = ? WHERE id = ?
      `);
      for (const row of rows) lease.run(now + leaseMs, now, row.id);
      return rows.map((row) => this.getDelivery(row.id)).filter(Boolean);
    });
  }

  getDelivery(id) {
    const row = this.db.prepare(`
      SELECT delivery.id, delivery.endpoint_id AS endpointId, delivery.attempts,
        endpoint.kind, endpoint.destination,
        endpoint.config_json AS endpointConfig, delivery.event_json AS eventJson
      FROM deliveries delivery
      JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
      WHERE delivery.id = ?
    `).get(id);
    return row ? { ...row, event: parseJson(row.eventJson, {}) } : null;
  }

  isDeliverySendable(id) {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM deliveries delivery
      JOIN delivery_endpoints endpoint ON endpoint.id = delivery.endpoint_id
      WHERE delivery.id = ? AND delivery.status = 'leased'
        AND endpoint.enabled = 1
    `).get(id));
  }

  completeDelivery(id, providerMessageId, now = Date.now()) {
    return Number(this.db.prepare(`
      UPDATE deliveries SET status = 'sent', leased_until = NULL,
        provider_message_id = ?, last_error = NULL, updated_at = ?
      WHERE id = ? AND status = 'leased'
    `).run(providerMessageId, now, id).changes) > 0;
  }

  retryDelivery(id, error, nextAttemptAt, now = Date.now()) {
    return Number(this.db.prepare(`
      UPDATE deliveries SET status = 'pending', next_attempt_at = ?,
        leased_until = NULL, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'leased'
    `).run(nextAttemptAt, truncate(error), now, id).changes) > 0;
  }

  retryDeliveryForChannelFailure(id, channel, error, nextAttemptAt, now = Date.now()) {
    const retried = this.retryDelivery(id, error, nextAttemptAt, now);
    this.recordSourceFailure(channel, error, now);
    return retried;
  }

  failDelivery(id, error, now = Date.now()) {
    return Number(this.db.prepare(`
      UPDATE deliveries SET status = 'failed', leased_until = NULL,
        last_error = ?, updated_at = ? WHERE id = ? AND status = 'leased'
    `).run(truncate(error), now, id).changes) > 0;
  }

  failDeliveryForChannelFailure(id, channel, error, now = Date.now()) {
    const failed = this.failDelivery(id, error, now);
    this.recordSourceFailure(channel, error, now);
    return failed;
  }

  failDeliveryAndDisableEndpoint(id, endpointId, error, now = Date.now()) {
    return this.transaction(() => {
      const failed = this.failDelivery(id, error, now);
      if (!failed) return false;
      this.db.prepare(`
        UPDATE delivery_endpoints SET enabled = 0, updated_at = ?
        WHERE id = ?
      `).run(now, endpointId);
      this.db.prepare(`
        UPDATE deliveries SET status = 'failed', leased_until = NULL,
          last_error = ?, updated_at = ?
        WHERE endpoint_id = ? AND status IN ('pending', 'leased')
      `).run('Endpoint disabled after a permanent delivery failure', now, endpointId);
      return true;
    });
  }

  enqueueUnverifiedWebPushChecks() {
    return 0;
  }

  pruneNotificationData({ now = Date.now() } = {}) {
    return this.transaction(() => ({
      deliveries: Number(this.db.prepare(`
        DELETE FROM deliveries WHERE status IN ('sent', 'failed') AND updated_at < ?
      `).run(now - DELIVERY_RETENTION_MS).changes),
      telegramLinks: Number(this.db.prepare(`
        DELETE FROM telegram_links WHERE expires_at < ?
      `).run(now - TOKEN_RETENTION_MS).changes),
    }));
  }
}

function protocolFromL1Snapshot(selectedNetwork, snapshot, inactivity) {
  return {
    network: network(selectedNetwork),
    chainId: positiveInteger(snapshot.chainId, 'chain id'),
    observedAt: toIso(snapshot.blockTimestamp ?? snapshot.observedAt),
    blockNumber: unsignedString(snapshot.blockNumber, 'block number'),
    blockHash: hash(snapshot.blockHash, 'block hash'),
    registryAddress: address(snapshot.registryAddress, 'Registry'),
    rollupAddress: address(snapshot.rollupAddress, 'Rollup'),
    genesisTime: unsignedString(snapshot.l1GenesisTime, 'genesis time'),
    currentSlot: unsignedString(snapshot.currentSlot, 'current slot'),
    currentEpoch: unsignedString(snapshot.currentEpoch, 'current epoch'),
    slotDurationSeconds: positiveInteger(snapshot.slotDuration, 'slot duration'),
    epochDurationSlots: positiveInteger(snapshot.epochDuration, 'epoch duration'),
    lineages: (snapshot.stacks ?? []).map((stack) => ({
      role: stack.role,
      rollupAddress: address(stack.rollupAddress ?? snapshot.rollupAddress, 'Rollup'),
      slasherAddress: address(stack.slasherAddress, 'Slasher'),
      proposerAddress: address(stack.proposerAddress, 'SlashingProposer'),
      currentRound: unsignedString(stack.currentRound, 'current round'),
      isSlashingEnabled: Boolean(stack.isSlashingEnabled),
      disabledUntil: BigInt(stack.slashingDisabledUntil ?? 0) === 0n
        ? null
        : unsignedString(stack.slashingDisabledUntil, 'disabled until'),
      parameters: {
        quorum: positiveInteger(stack.parameters.quorum, 'quorum'),
        roundSizeSlots: positiveInteger(stack.parameters.roundSize, 'round size'),
        roundSizeEpochs: positiveInteger(
          stack.parameters.roundSizeInEpochs,
          'round size in epochs',
        ),
        executionDelayRounds: unsignedInteger(
          stack.parameters.executionDelayInRounds,
          'execution delay',
        ),
        lifetimeRounds: positiveInteger(stack.parameters.lifetimeInRounds, 'lifetime'),
        slashOffsetRounds: unsignedInteger(
          stack.parameters.slashOffsetInRounds,
          'slash offset',
        ),
        committeeSize: positiveInteger(stack.parameters.committeeSize, 'committee size'),
      },
    })),
    inactivity,
  };
}

function observationsFromL1Snapshot(selectedNetwork, snapshot, protocol) {
  const result = [];
  for (const stack of snapshot.stacks ?? []) {
    const lineage = protocol.lineages.find((item) =>
      item.proposerAddress === String(stack.proposerAddress).toLowerCase());
    if (!lineage) continue;
    for (const round of stack.rounds ?? []) {
      const actions = round.actionDetails ?? [];
      const byPosition = new Map(actions.map((detail) => [
        targetPosition(detail),
        detail,
      ]));
      const details = (round.earlyTargets ?? []).map((target) => ({
        ...target,
        ...byPosition.get(targetPosition(target)),
      }));
      const present = new Set(details.map(targetPosition));
      details.push(...actions.filter((detail) => !present.has(targetPosition(detail))));
      for (const detail of details) {
        if (detail.targetEpoch === undefined || detail.targetEpoch === null) continue;
        const sequencer = address(detail.sequencer, 'slash target');
        const targetEpoch = unsignedString(detail.targetEpoch, 'target epoch');
        const data = {
          round: unsignedString(round.round, 'round'),
          status: String(round.status),
          support: Number(detail.voteCount ?? detail.support ?? 0),
          quorum: lineage.parameters.quorum,
          amount: detail.amount === undefined || detail.amount === null
            ? null
            : unsignedString(detail.amount, 'slash amount'),
          actionIndex: detail.actionIndex === undefined
            ? null
            : Number(detail.actionIndex),
          maxSlashUnits: Number(detail.maxSlashUnits ?? 0),
          unitVoteCounts: detail.unitVoteCounts ?? [0, 0, 0],
          escaped: Boolean(detail.escaped),
          payloadAddress: round.payloadAddress
            ? address(round.payloadAddress, 'payload')
            : null,
          isVetoed: Boolean(round.isVetoed),
          isExecuted: Boolean(round.isExecuted),
          stable: BigInt(lineage.currentRound) > BigInt(round.round),
          isExecutionPaused: Boolean(round.isExecutionPaused),
          isProtected: Boolean(round.isProtected),
          roundEndSlot: (
            (BigInt(round.round) + 1n) * BigInt(lineage.parameters.roundSizeSlots)
          ).toString(),
          executableSlot: unsignedString(round.executableSlot, 'executable slot'),
          expirySlot: unsignedString(round.expirySlot, 'expiry slot'),
        };
        data.roundEndAt = slotTime(protocol, data.roundEndSlot);
        data.executableAt = slotTime(protocol, data.executableSlot);
        data.expiryAt = slotTime(protocol, data.expirySlot);
        result.push({
          id: stableId(
            'l1-round',
            lineage.proposerAddress,
            round.round,
            sequencer,
            targetEpoch,
            JSON.stringify(data),
          ),
          network: network(selectedNetwork),
          source: 'ethereum_l1',
          kind: 'l1_round',
          sequencer,
          lineageId: lineage.proposerAddress,
          targetEpoch,
          round: String(round.round),
          provenance: {
            observedAt: protocol.observedAt,
            blockNumber: protocol.blockNumber,
            blockHash: protocol.blockHash,
            canonical: true,
          },
          data,
        });
      }
    }
  }
  return result;
}

function targetPosition(target) {
  return [
    Number(target.epochIndex),
    Number(target.committeeIndex),
    String(target.sequencer).toLowerCase(),
  ].join(':');
}

function findExecutionForSlash(db, log) {
  const candidates = log.executionCandidates ??
    (log.proposerAddress && log.round !== undefined
      ? [{ proposerAddress: log.proposerAddress, round: log.round }]
      : []);
  for (const candidate of candidates) {
    const row = db.prepare(`
      SELECT observation_json AS observationJson FROM observations
      WHERE kind = 'l1_round' AND lineage_id = ? AND round = ?
        AND sequencer = ? AND canonical = 1
        AND json_extract(observation_json, '$.data.actionIndex') = ?
      ORDER BY observed_at DESC LIMIT 1
    `).get(
      address(candidate.proposerAddress, 'SlashingProposer'),
      unsignedString(candidate.round, 'round'),
      address(log.sequencer, 'sequencer'),
      unsignedInteger(log.transactionSlashIndex, 'transaction slash index'),
    );
    if (row) return parseJson(row.observationJson, null);
  }
  return null;
}

function assertExecutionMatchesContext(execution, log) {
  if (!log.executionContext) return;
  const context = log.executionContext;
  const mismatches = [
    execution.lineageId !== address(context.proposerAddress, 'SlashingProposer'),
    execution.round !== unsignedString(context.round, 'round'),
    execution.sequencer !== address(context.sequencer, 'sequencer'),
    execution.targetEpoch !== unsignedString(context.targetEpoch, 'target epoch'),
    unsignedInteger(execution.data.actionIndex, 'stored action index') !==
      unsignedInteger(context.actionIndex, 'historical action index'),
    execution.data.amount !== unsignedString(context.amount, 'slash amount'),
  ];
  if (mismatches.some(Boolean)) {
    throw new Error(
      `Slashed log ${log.transactionHash}:${log.logIndex} disagrees with its stored RoundExecuted case`,
    );
  }
}

function historicalRoundObservation({
  network: selectedNetwork,
  log,
  observedAt,
}) {
  const context = log.executionContext;
  const sequencer = address(log.sequencer, 'sequencer');
  const contextSequencer = address(context?.sequencer, 'historical sequencer');
  const actionIndex = unsignedInteger(
    context?.actionIndex,
    'historical action index',
  );
  if (
    contextSequencer !== sequencer ||
    actionIndex !== unsignedInteger(log.transactionSlashIndex, 'transaction slash index')
  ) {
    throw new Error(
      `Slashed log ${log.transactionHash}:${log.logIndex} has inconsistent historical execution context`,
    );
  }
  const lineageId = address(context.proposerAddress, 'SlashingProposer');
  const round = unsignedString(context.round, 'round');
  const targetEpoch = unsignedString(context.targetEpoch, 'target epoch');
  const data = {
    round,
    status: 'executed',
    support: unsignedInteger(context.support, 'slash support'),
    quorum: positiveInteger(context.quorum, 'quorum'),
    amount: unsignedString(context.amount, 'slash amount'),
    actionIndex,
    maxSlashUnits: unsignedInteger(context.maxSlashUnits, 'maximum slash units'),
    unitVoteCounts: (context.unitVoteCounts ?? []).map((value) =>
      unsignedInteger(value, 'unit vote count')),
    escaped: Boolean(context.escaped),
    payloadAddress: address(context.payloadAddress, 'payload'),
    isVetoed: false,
    isExecuted: true,
    stable: true,
    isExecutionPaused: false,
    isProtected: false,
    historicalExecution: true,
  };
  return {
    id: stableId(
      'l1-executed-round',
      hash(log.blockHash, 'block hash'),
      hash(log.transactionHash, 'transaction hash'),
      lineageId,
      round,
      sequencer,
      targetEpoch,
      actionIndex,
      JSON.stringify(data),
    ),
    network: network(selectedNetwork),
    source: 'ethereum_l1',
    kind: 'l1_round',
    sequencer,
    lineageId,
    targetEpoch,
    round,
    provenance: {
      observedAt: toIso(observedAt),
      blockNumber: unsignedString(log.blockNumber, 'block number'),
      blockHash: hash(log.blockHash, 'block hash'),
      transactionHash: hash(log.transactionHash, 'transaction hash'),
      canonical: true,
    },
    data,
  };
}

function slashObservation({ network: selectedNetwork, log, execution, observedAt }) {
  if (!execution) {
    throw new Error(
      `Slashed log ${log.transactionHash}:${log.logIndex} has no exact RoundExecuted case link`,
    );
  }
  return {
    id: `l1-slash:${hash(log.blockHash, 'block hash')}:${unsignedInteger(log.logIndex, 'log index')}`,
    network: network(selectedNetwork),
    source: 'ethereum_l1',
    kind: 'l1_slash',
    sequencer: address(log.sequencer, 'sequencer'),
    lineageId: execution.lineageId,
    targetEpoch: execution.targetEpoch,
    round: execution.round,
    provenance: {
      observedAt: toIso(observedAt),
      blockNumber: unsignedString(log.blockNumber, 'block number'),
      blockHash: hash(log.blockHash, 'block hash'),
      transactionHash: hash(log.transactionHash, 'transaction hash'),
      canonical: true,
    },
    data: {
      amount: unsignedString(log.amount, 'slash amount'),
      actionIndex: unsignedInteger(log.transactionSlashIndex, 'transaction slash index'),
      round: execution.round,
      rollupAddress: address(log.rollupAddress, 'Rollup'),
    },
  };
}

function stakeStatusObservation({ slash, status }) {
  return {
    ...slash,
    id: stableId('stake-status', slash.id, status),
    kind: 'stake_status',
    data: {
      ejected: true,
      status: Number(status) === 2 ? 'zombie' : 'exiting',
      actualAmount: slash.data.amount,
      round: slash.round,
    },
  };
}

function nodeOffenseObservation({
  offense,
  status,
  lineage,
  epochDuration,
  network: selectedNetwork,
  observedAt,
}) {
  const targetEpoch = offense.timeUnit === 'slot'
    ? (BigInt(offense.epochOrSlot) / BigInt(epochDuration)).toString()
    : offense.epochOrSlot;
  const expectedRound = (
    BigInt(targetEpoch) / BigInt(lineage.parameters.roundSizeEpochs) +
    BigInt(lineage.parameters.slashOffsetRounds)
  ).toString();
  return {
    id: stableId('node-offense', offense.id, status, observedAt),
    network: network(selectedNetwork),
    source: 'aztec_node',
    kind: 'node_offense',
    sequencer: address(offense.sequencer, 'sequencer'),
    lineageId: lineage.proposerAddress,
    targetEpoch,
    slot: offense.timeUnit === 'slot' ? offense.epochOrSlot : undefined,
    round: expectedRound,
    provenance: {
      observedAt: toIso(observedAt),
      nodeCursor: offense.id,
      canonical: true,
    },
    data: {
      ...offense,
      status,
      expectedRound,
      amount: unsignedString(offense.amount, 'offense amount'),
    },
  };
}

function sentinelObservation({
  kind,
  network: selectedNetwork,
  lineage,
  sequencer,
  epoch,
  observedAt,
  l1BlockNumber,
  l1BlockHash,
  data,
}) {
  return {
    id: stableId('sentinel', kind, lineage.proposerAddress, sequencer, epoch),
    network: network(selectedNetwork),
    source: 'aztec_sentinel',
    kind,
    sequencer: address(sequencer, 'sequencer'),
    lineageId: lineage.proposerAddress,
    targetEpoch: String(epoch),
    slot: data.slot ?? data.firstMissedSlot ?? undefined,
    provenance: {
      observedAt: toIso(observedAt),
      ...(l1BlockNumber === undefined
        ? {}
        : { blockNumber: unsignedString(l1BlockNumber, 'L1 block') }),
      ...(l1BlockHash
        ? { blockHash: hash(l1BlockHash, 'L1 block hash') }
        : {}),
      canonical: true,
    },
    data,
  };
}

function normalizeObservation(input) {
  const observation = {
    ...input,
    id: String(input?.id ?? ''),
    network: network(input?.network),
    source: String(input?.source ?? ''),
    kind: String(input?.kind ?? ''),
    sequencer: address(input?.sequencer, 'sequencer'),
    lineageId: address(input?.lineageId, 'lineage'),
    targetEpoch: unsignedString(input?.targetEpoch, 'target epoch'),
    provenance: {
      ...input?.provenance,
      observedAt: toIso(input?.provenance?.observedAt),
      canonical: input?.provenance?.canonical !== false,
    },
    data: input?.data && typeof input.data === 'object' ? input.data : {},
  };
  if (!observation.id) throw new Error('observation id is required');
  if (!['aztec_sentinel', 'aztec_node', 'ethereum_l1'].includes(observation.source)) {
    throw new Error(`invalid observation source: ${observation.source}`);
  }
  return observation;
}

function normalizeAddressList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('At least one sequencer address is required');
  }
  return [...new Set(values.map((item) => address(item, 'sequencer')))].sort();
}

function transitionEvent(transition, currentCase) {
  const latestL1 = [...currentCase.observations].reverse().find(
    (item) => item.source === 'ethereum_l1' && item.provenance.canonical,
  );
  return {
    id: transition.id,
    network: currentCase.network,
    source: 'case',
    type: 'case_transition',
    severity: transition.severity,
    title: transition.title,
    body: transition.body,
    targets: [transition.sequencer],
    data: {
      caseId: transition.caseId,
      sequencer: transition.sequencer,
      targetEpoch: currentCase.targetEpoch,
      lineageId: currentCase.lineageId,
      fromStage: transition.fromStage,
      toStage: transition.toStage,
      payloadAddress: currentCase.state.payloadAddress,
      blockNumber: latestL1?.provenance.blockNumber ?? null,
      transactionHash: currentCase.observations.find(
        (item) => item.kind === 'l1_slash',
      )?.provenance.transactionHash ?? null,
    },
    observedAt: transition.observedAt,
  };
}

function normalizeDutyHistory(history, { sequencer, fromSlot, toSlot }) {
  if (!Array.isArray(history)) throw new Error(`Sentinel history for ${sequencer} is invalid`);
  const seen = new Set();
  return history.map((item) => {
    const slot = unsignedInteger(item?.slot, `duty slot for ${sequencer}`);
    if (slot < fromSlot || slot > toSlot || seen.has(slot)) {
      throw new Error(`Sentinel history for ${sequencer} contains an invalid duty slot`);
    }
    seen.add(slot);
    const status = String(item?.status ?? '');
    if (!DUTY_STATUSES.has(status)) {
      throw new Error(`Sentinel history for ${sequencer} has invalid status ${status}`);
    }
    return { slot, status };
  }).sort((left, right) => left.slot - right.slot);
}

function summarizeDutyHistory(history) {
  const missedItems = history.filter((item) => MISSED_DUTIES.has(item.status));
  return {
    missed: missedItems.length,
    total: history.length,
    firstMissedSlot: missedItems[0]?.slot ?? null,
    lastMissedSlot: missedItems[missedItems.length - 1]?.slot ?? null,
  };
}

function hasAdvancingAbsence(evidence) {
  return Boolean(evidence?.slot?.advanced || evidence?.epoch?.advanced);
}

function canAdvanceOffenseAbsence(offense, evidence) {
  const cursor = evidence?.[offense?.timeUnit];
  if (!cursor?.advanced) return false;
  try {
    return BigInt(cursor.value) >= BigInt(offense.epochOrSlot);
  } catch {
    return false;
  }
}

function slotTime(protocol, slot) {
  const seconds = BigInt(protocol.genesisTime) +
    BigInt(slot) * BigInt(protocol.slotDurationSeconds);
  const milliseconds = seconds * 1_000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return new Date(Number(milliseconds)).toISOString();
}

function stableId(...parts) {
  return createHash('sha256').update(parts.map(String).join('|')).digest('hex');
}

function network(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (!['mainnet', 'testnet'].includes(normalized)) {
    throw new Error(`unsupported network: ${value}`);
  }
  return normalized;
}

function address(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!ADDRESS.test(normalized)) throw new Error(`${label} must be a 20-byte hex address`);
  return normalized;
}

function hash(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!HASH.test(normalized)) throw new Error(`${label} must be a 32-byte hex value`);
  return normalized;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function unsignedInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return number;
}

function unsignedString(value, label) {
  try {
    const result = BigInt(value);
    if (result < 0n) throw new Error();
    return result.toString();
  } catch {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function toIso(value) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('observation time is invalid');
  const milliseconds = number < 10_000_000_000 ? number * 1_000 : number;
  return new Date(milliseconds).toISOString();
}

function parseJson(value, fallback) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function truncate(value, max = 1_000) {
  return String(value?.message ?? value ?? 'Unknown error').slice(0, max);
}
