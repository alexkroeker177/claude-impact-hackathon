import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import type { SourceProfile } from "@/lib/files/types";
import { semanticPlanSchema, type SemanticPlan } from "@/lib/semantic/schema";
import type { DashboardAnalysis, MetricResult } from "@/lib/analysis/types";

export type ProjectStatus =
  | "created"
  | "interpreting"
  | "interpreted"
  | "generating"
  | "ready"
  | "failed";

export interface ProjectRecord {
  id: string;
  name: string;
  goal: string;
  attention: string | null;
  status: ProjectStatus;
  createdAt: string;
  synthetic: boolean;
  error: string | null;
}

export interface ProjectListItem {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
  sourceCount: number;
  synthetic: boolean;
}

export interface SourceRecord {
  id: string;
  projectId: string;
  fileName: string;
  storedPath: string;
  profile: SourceProfile;
}

export interface RunRecord {
  id: string;
  projectId: string;
  status: string;
  createdAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  goal: string;
  attention: string | null;
  status: string;
  created_at: string;
  error: string | null;
  synthetic: number;
}

interface SourceRow {
  id: string;
  project_id: string;
  file_name: string;
  stored_path: string;
  profile_json: string;
}

function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    attention: row.attention,
    status: row.status as ProjectStatus,
    createdAt: row.created_at,
    synthetic: row.synthetic === 1,
    error: row.error,
  };
}

function rowToSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    storedPath: row.stored_path,
    profile: JSON.parse(row.profile_json) as SourceProfile,
  };
}

export function createProject(input: {
  name: string;
  goal: string;
  attention: string | null;
  synthetic?: boolean;
}): ProjectRecord {
  const db = getDb();
  const record: ProjectRecord = {
    id: randomUUID(),
    name: input.name,
    goal: input.goal,
    attention: input.attention,
    status: "created",
    createdAt: new Date().toISOString(),
    synthetic: input.synthetic === true,
    error: null,
  };
  db.prepare(
    `INSERT INTO projects (id, name, goal, attention, status, created_at, error, synthetic)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    record.id,
    record.name,
    record.goal,
    record.attention,
    record.status,
    record.createdAt,
    record.synthetic ? 1 : 0,
  );
  return record;
}

export function addSource(input: {
  projectId: string;
  fileName: string;
  storedPath: string;
  profile: SourceProfile;
}): SourceRecord {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sources (id, project_id, file_name, stored_path, profile_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.fileName, input.storedPath, JSON.stringify(input.profile));
  return {
    id,
    projectId: input.projectId,
    fileName: input.fileName,
    storedPath: input.storedPath,
    profile: input.profile,
  };
}

/** All projects, newest first. sourceCount counts uploaded files (distinct stored paths). */
export function listProjects(): ProjectListItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.status, p.created_at, p.synthetic,
              COUNT(DISTINCT s.stored_path) AS source_count
       FROM projects p
       LEFT JOIN sources s ON s.project_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC, p.rowid DESC`,
    )
    .all() as Array<{
    id: string;
    name: string;
    status: string;
    created_at: string;
    synthetic: number;
    source_count: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status as ProjectStatus,
    createdAt: row.created_at,
    sourceCount: row.source_count,
    synthetic: row.synthetic === 1,
  }));
}

export function getProject(id: string): ProjectRecord | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function getSources(projectId: string): SourceRecord[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM sources WHERE project_id = ? ORDER BY rowid ASC`)
    .all(projectId) as SourceRow[];
  return rows.map(rowToSource);
}

export function getProfiles(projectId: string): SourceProfile[] {
  return getSources(projectId).map((source) => source.profile);
}

/** Set status and clear any stale error (unless moving into "failed"). */
export function setProjectStatus(id: string, status: ProjectStatus): void {
  const db = getDb();
  if (status === "failed") {
    db.prepare(`UPDATE projects SET status = ? WHERE id = ?`).run(status, id);
  } else {
    db.prepare(`UPDATE projects SET status = ?, error = NULL WHERE id = ?`).run(status, id);
  }
}

export function setProjectError(id: string, message: string): void {
  const db = getDb();
  db.prepare(`UPDATE projects SET status = 'failed', error = ? WHERE id = ?`).run(message, id);
}

/** Create a new analysis run (status "interpreting"). Retries create fresh rows — idempotent. */
export function saveRun(projectId: string): RunRecord {
  const db = getDb();
  const record: RunRecord = {
    id: randomUUID(),
    projectId,
    status: "interpreting",
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO analysis_runs (id, project_id, status, plan_json, error, created_at)
     VALUES (?, ?, ?, NULL, NULL, ?)`,
  ).run(record.id, record.projectId, record.status, record.createdAt);
  return record;
}

export function updateRunPlan(runId: string, plan: SemanticPlan): void {
  const db = getDb();
  db.prepare(
    `UPDATE analysis_runs SET status = 'interpreted', plan_json = ?, error = NULL WHERE id = ?`,
  ).run(JSON.stringify(plan), runId);
}

export function failRun(runId: string, message: string): void {
  const db = getDb();
  db.prepare(`UPDATE analysis_runs SET status = 'failed', error = ? WHERE id = ?`).run(
    message,
    runId,
  );
}

/** Replace the project's metric rows with the plan's proposed metrics (accepted = 1 by default). */
export function savePlanMetrics(projectId: string, runId: string, plan: SemanticPlan): void {
  const db = getDb();
  const replace = db.transaction(() => {
    db.prepare(`DELETE FROM metrics WHERE project_id = ?`).run(projectId);
    const insert = db.prepare(
      `INSERT INTO metrics (id, project_id, run_id, definition_json, result_json, accepted)
       VALUES (?, ?, ?, ?, NULL, 1)`,
    );
    for (const metric of plan.proposedMetrics) {
      insert.run(`${runId}:${metric.id}`, projectId, runId, JSON.stringify(metric));
    }
  });
  replace();
}

/** Flip accepted flags for a run's metric rows based on the metric definition ids the user kept. */
export function updateMetricsAccepted(runId: string, acceptedMetricIds: string[]): void {
  const db = getDb();
  const accepted = new Set(acceptedMetricIds);
  const rows = db
    .prepare(`SELECT id, definition_json FROM metrics WHERE run_id = ?`)
    .all(runId) as Array<{ id: string; definition_json: string }>;
  const update = db.prepare(`UPDATE metrics SET accepted = ? WHERE id = ?`);
  const apply = db.transaction(() => {
    for (const row of rows) {
      const definition = JSON.parse(row.definition_json) as { id: string };
      update.run(accepted.has(definition.id) ? 1 : 0, row.id);
    }
  });
  apply();
}

/** Attach computed results to the run's metric rows (matched by metricId). */
export function saveMetricResults(runId: string, results: MetricResult[]): void {
  const db = getDb();
  const update = db.prepare(`UPDATE metrics SET result_json = ? WHERE id = ?`);
  const apply = db.transaction(() => {
    for (const result of results) {
      update.run(JSON.stringify(result), `${runId}:${result.metricId}`);
    }
  });
  apply();
}

/** Cache the full dashboard as a findings row (kind "dashboard"), replacing any prior one. */
export function saveDashboard(
  projectId: string,
  runId: string,
  dashboard: DashboardAnalysis,
): void {
  const db = getDb();
  const replace = db.transaction(() => {
    db.prepare(`DELETE FROM findings WHERE project_id = ? AND kind = 'dashboard'`).run(projectId);
    db.prepare(
      `INSERT INTO findings (id, project_id, run_id, kind, payload_json)
       VALUES (?, ?, ?, 'dashboard', ?)`,
    ).run(randomUUID(), projectId, runId, JSON.stringify(dashboard));
  });
  replace();
}

export function getDashboard(projectId: string): DashboardAnalysis | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT payload_json FROM findings
       WHERE project_id = ? AND kind = 'dashboard'
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get(projectId) as { payload_json: string } | undefined;
  return row ? (JSON.parse(row.payload_json) as DashboardAnalysis) : null;
}

/** Latest interpreted plan (Zod-validated) plus current source profiles. */
export function getPlanAndProfiles(projectId: string): {
  runId: string | null;
  plan: SemanticPlan | null;
  profiles: SourceProfile[];
} {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, plan_json FROM analysis_runs
       WHERE project_id = ? AND plan_json IS NOT NULL
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(projectId) as { id: string; plan_json: string } | undefined;
  const plan = row ? semanticPlanSchema.parse(JSON.parse(row.plan_json)) : null;
  return {
    runId: row ? row.id : null,
    plan,
    profiles: getProfiles(projectId),
  };
}
