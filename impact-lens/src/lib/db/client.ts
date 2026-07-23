import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  attention TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  error TEXT,
  synthetic INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  profile_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  result_json TEXT,
  accepted INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_project ON analysis_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_metrics_project ON metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_metrics_run ON metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id);
`;

interface DbGlobal {
  __impactlensDb?: Database.Database;
  __impactlensDbPath?: string;
}

const globalForDb = globalThis as unknown as DbGlobal;

/**
 * Open (or reuse) the singleton SQLite database. Safe across Next.js HMR
 * reloads via a globalThis stash; re-opens when IMPACTLENS_DB_PATH changes.
 *
 * Uses better-sqlite3 (a native Node addon) rather than bun:sqlite: Next.js's
 * Turbopack dev/prod server runs its request handlers under real Node.js even
 * when launched via `bun run dev`, so bun:sqlite is unavailable there. Run
 * standalone scripts against this module with `tsx` (Node), never `bun` directly
 * — better-sqlite3's native binary crashes Bun's own JS engine (N-API bug).
 */
export function getDb(): Database.Database {
  const dbPath = process.env.IMPACTLENS_DB_PATH || ".data/impactlens.db";
  if (globalForDb.__impactlensDb && globalForDb.__impactlensDbPath === dbPath) {
    return globalForDb.__impactlensDb;
  }
  if (globalForDb.__impactlensDb) {
    try {
      globalForDb.__impactlensDb.close();
    } catch {
      // Already closed — ignore.
    }
    globalForDb.__impactlensDb = undefined;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  globalForDb.__impactlensDb = db;
  globalForDb.__impactlensDbPath = dbPath;
  return db;
}

/** Close the singleton connection (test teardown helper). */
export function closeDb(): void {
  if (globalForDb.__impactlensDb) {
    try {
      globalForDb.__impactlensDb.close();
    } catch {
      // Already closed — ignore.
    }
    globalForDb.__impactlensDb = undefined;
    globalForDb.__impactlensDbPath = undefined;
  }
}
