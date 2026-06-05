import type { DatabaseSync } from "node:sqlite";

export type Migration = {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
};

export const migrations: readonly Migration[] = [
  {
    description: "Initial pipeline persistence schema",
    id: "0001_initial_schema",
    sql: `
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  config_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('mtgtop8', 'mtggoldfish', 'mtgo')),
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  http_status INTEGER,
  error TEXT,
  raw_path TEXT,
  parser_version TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (source, source_url, content_hash)
);

CREATE TABLE IF NOT EXISTS raw_decks (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT REFERENCES source_snapshots(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('mtgtop8', 'mtggoldfish', 'mtgo')),
  source_url TEXT NOT NULL,
  event_name TEXT,
  event_date TEXT,
  format TEXT NOT NULL CHECK (format = 'Modern'),
  player TEXT,
  placement TEXT,
  reported_archetype TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS raw_deck_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_deck_id TEXT NOT NULL REFERENCES raw_decks(id) ON DELETE CASCADE,
  zone TEXT NOT NULL CHECK (zone IN ('mainboard', 'sideboard')),
  name TEXT NOT NULL,
  copies INTEGER NOT NULL CHECK (copies > 0),
  position INTEGER NOT NULL,
  UNIQUE (raw_deck_id, zone, position)
);

CREATE TABLE IF NOT EXISTS cards (
  canonical_name TEXT PRIMARY KEY,
  scryfall_id TEXT,
  colors_json TEXT NOT NULL DEFAULT '[]',
  color_identity_json TEXT NOT NULL DEFAULT '[]',
  type_line TEXT,
  mana_value REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_name_mappings (
  raw_name TEXT PRIMARY KEY,
  canonical_name TEXT REFERENCES cards(canonical_name) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('mapped', 'unresolved', 'ignored')),
  source_context_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS archetype_mappings (
  reported_label TEXT PRIMARY KEY,
  archetype TEXT NOT NULL,
  archetype_family TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  manual_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0, 1)),
  audit_status TEXT NOT NULL DEFAULT 'mapped' CHECK (audit_status IN ('mapped', 'ambiguous', 'unmapped')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS normalized_decks (
  deck_id TEXT PRIMARY KEY,
  raw_deck_id TEXT REFERENCES raw_decks(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('mtgtop8', 'mtggoldfish', 'mtgo')),
  source_url TEXT NOT NULL,
  event_date TEXT NOT NULL,
  year INTEGER NOT NULL,
  archetype TEXT NOT NULL,
  archetype_family TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS normalized_deck_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id TEXT NOT NULL REFERENCES normalized_decks(deck_id) ON DELETE CASCADE,
  zone TEXT NOT NULL CHECK (zone IN ('mainboard', 'sideboard')),
  card_name TEXT NOT NULL,
  copies INTEGER NOT NULL CHECK (copies > 0),
  position INTEGER NOT NULL,
  UNIQUE (deck_id, zone, position)
);

CREATE TABLE IF NOT EXISTS dedupe_clusters (
  cluster_id TEXT PRIMARY KEY,
  strategy TEXT NOT NULL CHECK (strategy IN ('exact', 'near')),
  archetype_family TEXT,
  event_month TEXT,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deck_weights (
  deck_id TEXT PRIMARY KEY REFERENCES normalized_decks(deck_id) ON DELETE CASCADE,
  exact_duplicate_cluster_id TEXT REFERENCES dedupe_clusters(cluster_id) ON DELETE SET NULL,
  near_duplicate_cluster_id TEXT REFERENCES dedupe_clusters(cluster_id) ON DELETE SET NULL,
  weight REAL NOT NULL CHECK (weight >= 0),
  explanation TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_archetype_matrix (
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  archetype_family TEXT NOT NULL,
  decks_with_card REAL NOT NULL,
  total_decks_in_archetype REAL NOT NULL,
  mainboard_copies REAL NOT NULL,
  sideboard_copies REAL NOT NULL,
  affinity REAL NOT NULL,
  PRIMARY KEY (pipeline_run_id, card_name, archetype_family)
);

CREATE TABLE IF NOT EXISTS card_scores (
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  frequency REAL NOT NULL,
  glue_score REAL NOT NULL,
  weighted_glue_score REAL NOT NULL,
  highest_affinity REAL NOT NULL,
  second_highest_affinity REAL NOT NULL,
  exclusivity_score REAL NOT NULL,
  signpost_score REAL NOT NULL,
  parasitic_score REAL NOT NULL,
  cube_score REAL NOT NULL,
  PRIMARY KEY (pipeline_run_id, card_name)
);

CREATE TABLE IF NOT EXISTS candidate_pool_cards (
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  pool TEXT NOT NULL,
  score REAL NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]',
  explanation TEXT NOT NULL,
  PRIMARY KEY (pipeline_run_id, card_name, pool)
);

CREATE TABLE IF NOT EXISTS cube_runs (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  total_cards INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cube_run_cards (
  cube_run_id TEXT NOT NULL REFERENCES cube_runs(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  PRIMARY KEY (cube_run_id, card_name)
);

CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  cube_run_id TEXT NOT NULL REFERENCES cube_runs(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  total_cards INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail'))
);

CREATE TABLE IF NOT EXISTS validation_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  validation_run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('pass', 'warn', 'fail')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_raw_decks_source ON raw_decks(source);
CREATE INDEX IF NOT EXISTS idx_raw_deck_cards_name ON raw_deck_cards(name);
CREATE INDEX IF NOT EXISTS idx_normalized_decks_family ON normalized_decks(archetype_family);
CREATE INDEX IF NOT EXISTS idx_normalized_deck_cards_card ON normalized_deck_cards(card_name);
CREATE INDEX IF NOT EXISTS idx_matrix_pipeline_card ON card_archetype_matrix(pipeline_run_id, card_name);
CREATE INDEX IF NOT EXISTS idx_scores_pipeline_score ON card_scores(pipeline_run_id, cube_score DESC);
`
  },
  {
    description: "Structured cube validation metrics and card review rows",
    id: "0002_validation_metric_tables",
    sql: `
CREATE TABLE IF NOT EXISTS validation_metrics (
  validation_run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value REAL NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (validation_run_id, metric_key)
);

CREATE TABLE IF NOT EXISTS validation_zero_support_cards (
  validation_run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  section TEXT NOT NULL,
  position INTEGER NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (validation_run_id, card_name)
);

CREATE INDEX IF NOT EXISTS idx_validation_metrics_run ON validation_metrics(validation_run_id, metric_key);
CREATE INDEX IF NOT EXISTS idx_validation_zero_support_run ON validation_zero_support_cards(validation_run_id, position);
`
  },
  {
    description: "Pipeline stage lineage, config profiles, and output artifacts",
    id: "0003_pipeline_lineage_artifacts",
    sql: `
CREATE TABLE IF NOT EXISTS pipeline_stage_runs (
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  config_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  input_refs_json TEXT NOT NULL DEFAULT '{}',
  output_refs_json TEXT NOT NULL DEFAULT '{}',
  row_count INTEGER NOT NULL DEFAULT 0,
  error_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (pipeline_run_id, stage)
);

CREATE TABLE IF NOT EXISTS config_profiles (
  name TEXT PRIMARY KEY,
  config_hash TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS output_artifacts (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  path TEXT NOT NULL,
  format TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (path, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stage_runs_pipeline ON pipeline_stage_runs(pipeline_run_id, stage);
CREATE INDEX IF NOT EXISTS idx_output_artifacts_pipeline ON output_artifacts(pipeline_run_id, stage);
CREATE INDEX IF NOT EXISTS idx_output_artifacts_hash ON output_artifacts(content_hash);
`
  },
  {
    description: "Historical metagame periods and deck assignments",
    id: "0004_metagame_periods",
    sql: `
CREATE TABLE IF NOT EXISTS set_releases (
  set_code TEXT PRIMARY KEY,
  set_name TEXT NOT NULL,
  release_date TEXT NOT NULL,
  set_type TEXT NOT NULL CHECK (set_type IN ('core', 'expansion')),
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS metagame_periods (
  period_id TEXT PRIMARY KEY,
  model TEXT NOT NULL CHECK (model = 'standard_set_release'),
  set_code TEXT NOT NULL REFERENCES set_releases(set_code) ON DELETE RESTRICT,
  set_name TEXT NOT NULL,
  release_date TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  config_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deck_metagame_periods (
  deck_id TEXT PRIMARY KEY REFERENCES normalized_decks(deck_id) ON DELETE CASCADE,
  period_id TEXT NOT NULL REFERENCES metagame_periods(period_id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS metagame_period_assignment_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id TEXT REFERENCES normalized_decks(deck_id) ON DELETE CASCADE,
  event_date TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('missing_event_date', 'invalid_event_date', 'out_of_range')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_set_releases_release_date ON set_releases(release_date);
CREATE INDEX IF NOT EXISTS idx_metagame_periods_dates ON metagame_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_metagame_periods_sort ON metagame_periods(model, sort_order);
CREATE INDEX IF NOT EXISTS idx_deck_metagame_periods_period ON deck_metagame_periods(period_id);
CREATE INDEX IF NOT EXISTS idx_metagame_period_reviews_deck ON metagame_period_assignment_reviews(deck_id);
`
  },
  {
    description: "Historical source coverage summaries and warnings",
    id: "0005_historical_source_coverage",
    sql: `
CREATE TABLE IF NOT EXISTS historical_source_coverage (
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  period_id TEXT NOT NULL REFERENCES metagame_periods(period_id) ON DELETE CASCADE,
  set_code TEXT NOT NULL,
  set_name TEXT NOT NULL,
  period_start_date TEXT NOT NULL,
  period_end_date TEXT NOT NULL,
  year INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('mtgtop8', 'mtggoldfish', 'mtgo')),
  archetype_family TEXT NOT NULL,
  deck_count INTEGER NOT NULL CHECK (deck_count >= 0),
  source_status TEXT NOT NULL CHECK (source_status IN ('available', 'unavailable', 'unknown')),
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('observed_play', 'no_observed_play', 'missing_source_coverage')),
  warning_codes_json TEXT NOT NULL DEFAULT '[]',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pipeline_run_id, period_id, source, archetype_family)
);

CREATE TABLE IF NOT EXISTS historical_coverage_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  period_id TEXT NOT NULL REFERENCES metagame_periods(period_id) ON DELETE CASCADE,
  source TEXT CHECK (source IN ('mtgtop8', 'mtggoldfish', 'mtgo')),
  warning_type TEXT NOT NULL CHECK (warning_type IN ('empty_period', 'thin_period', 'missing_source_coverage')),
  severity TEXT NOT NULL CHECK (severity IN ('warn', 'fail')),
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_historical_source_coverage_period ON historical_source_coverage(period_id, source);
CREATE INDEX IF NOT EXISTS idx_historical_source_coverage_year ON historical_source_coverage(year, source);
CREATE INDEX IF NOT EXISTS idx_historical_coverage_warnings_run ON historical_coverage_warnings(pipeline_run_id, period_id);
`
  }
];

export function applyMigrations(database: DatabaseSync): readonly string[] {
  ensureMigrationTable(database);
  const applied = getAppliedMigrationIds(database);
  const appliedNow: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    database.exec("BEGIN;");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO schema_migrations (id, description, applied_at)
           VALUES (?, ?, ?)`
        )
        .run(migration.id, migration.description, new Date().toISOString());
      database.exec("COMMIT;");
      appliedNow.push(migration.id);
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }

  return appliedNow;
}

export function getAppliedMigrationIds(database: DatabaseSync): ReadonlySet<string> {
  ensureMigrationTable(database);
  const rows = database.prepare("SELECT id FROM schema_migrations").all();
  return new Set(rows.map((row) => String(row.id)));
}

function ensureMigrationTable(database: DatabaseSync): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
}
