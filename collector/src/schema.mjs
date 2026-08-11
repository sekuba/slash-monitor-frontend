export const DATABASE_APPLICATION_ID = 0x534c4d4e;
export const DATABASE_SCHEMA_VERSION = 3;
export const DATABASE_TABLES = new Set([
  'runtime_identity',
  'source_state',
  'protocol_snapshot',
  'observations',
  'cases',
  'case_transitions',
  'offense_state',
  'sentinel_epoch_index',
  'sentinel_performance',
  'watches',
  'watch_addresses',
  'delivery_endpoints',
  'telegram_links',
  'telegram_state',
  'deliveries',
]);

// Creates the schema in an empty database, or verifies that an existing
// database carries exactly the expected schema. Anything else is refused —
// there are no in-place migrations.
export function initializeSchema(db) {
  const applicationId = Number(
    db.prepare('PRAGMA application_id').get().application_id,
  );
  const version = Number(db.prepare('PRAGMA user_version').get().user_version);
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  if (
    applicationId === DATABASE_APPLICATION_ID &&
    version === DATABASE_SCHEMA_VERSION &&
    sameValues(tables, DATABASE_TABLES)
  ) {
    return;
  }
  if (applicationId !== 0 || version !== 0 || tables.length !== 0) {
    throw new Error(
      `slashveto.me requires an empty database or its exact current schema; ` +
      `found application ${applicationId}, schema ${version}, ${tables.length} tables`,
    );
  }
  db.exec(`
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

    PRAGMA application_id = ${DATABASE_APPLICATION_ID};
    PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
    COMMIT;
  `);
}

function sameValues(values, expected) {
  return values.length === expected.size &&
    values.every((value) => expected.has(value));
}
