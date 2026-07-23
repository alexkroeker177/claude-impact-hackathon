import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

const defaultDatabasePath = resolve(process.cwd(), ".data", "impactlens.db");

declare global {
  // eslint-disable-next-line no-var
  var __impactLensDatabase: Database.Database | undefined;
}

function databasePath() {
  return resolve(process.env.IMPACTLENS_DB_PATH || defaultDatabasePath);
}

function initialise(database: Database.Database) {
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      attention TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error_message TEXT,
      semantic_plan_json TEXT,
      dashboard_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      profile_json TEXT,
      parse_warnings_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      semantic_plan_json TEXT,
      result_json TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      metric_id TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      result_json TEXT,
      chart_series_json TEXT,
      evidence_json TEXT,
      accepted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sources_project_id_idx ON sources(project_id);
    CREATE INDEX IF NOT EXISTS analysis_runs_project_id_idx ON analysis_runs(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_interpretation_per_project
      ON analysis_runs(project_id)
      WHERE kind = 'interpretation' AND status = 'running';
    CREATE INDEX IF NOT EXISTS metrics_project_id_idx ON metrics(project_id);
    CREATE INDEX IF NOT EXISTS findings_project_id_idx ON findings(project_id);
  `);
  ensureColumn(database, "metrics", "metric_id", "TEXT NOT NULL DEFAULT ''");
  database.exec("CREATE INDEX IF NOT EXISTS metrics_project_metric_id_idx ON metrics(project_id, metric_id)");
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getDatabase() {
  if (!globalThis.__impactLensDatabase) {
    const path = databasePath();
    mkdirSync(dirname(path), { recursive: true });
    const database = new Database(path);
    initialise(database);
    globalThis.__impactLensDatabase = database;
  }

  return globalThis.__impactLensDatabase;
}

export function closeDatabaseForTests() {
  globalThis.__impactLensDatabase?.close();
  globalThis.__impactLensDatabase = undefined;
}
