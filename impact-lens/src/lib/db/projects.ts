import { randomUUID } from "node:crypto";

import type { Database as DatabaseType } from "better-sqlite3";
import { dashboardAnalysisSchema } from "@/types/dashboard";

import { getDatabase } from "./client";

export type StoredProjectStatus = "uploaded" | "interpreting" | "review" | "generating" | "ready" | "failed";

export type ProjectRecord = {
  id: string;
  name: string;
  goal: string;
  attention: string;
  status: StoredProjectStatus;
  errorMessage: string | null;
  semanticPlan: unknown | null;
  dashboard: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export type SourceRecord = {
  id: string;
  projectId: string;
  displayName: string;
  storagePath: string;
  mediaType: string;
  byteSize: number;
  profile: unknown | null;
  parseWarnings: unknown[];
  createdAt: string;
};

type ProjectRow = {
  id: string;
  name: string;
  goal: string;
  attention: string;
  status: StoredProjectStatus;
  error_message: string | null;
  semantic_plan_json: string | null;
  dashboard_json: string | null;
  created_at: string;
  updated_at: string;
};

type SourceRow = {
  id: string;
  project_id: string;
  display_name: string;
  storage_path: string;
  media_type: string;
  byte_size: number;
  profile_json: string | null;
  parse_warnings_json: string;
  created_at: string;
};

function now() {
  return new Date().toISOString();
}

function json(value: unknown) {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string") throw new Error("Cannot persist an undefined JSON value.");
  JSON.parse(encoded);
  return encoded;
}

function parseJson(value: string | null): unknown | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonArray(value: string): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    attention: row.attention,
    status: row.status,
    errorMessage: row.error_message,
    semanticPlan: parseJson(row.semantic_plan_json),
    dashboard: parseJson(row.dashboard_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    displayName: row.display_name,
    storagePath: row.storage_path,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    profile: parseJson(row.profile_json),
    parseWarnings: parseJsonArray(row.parse_warnings_json),
    createdAt: row.created_at,
  };
}

function projectStatement(database: DatabaseType) {
  return database.prepare("SELECT * FROM projects WHERE id = ?");
}

export function createProject(input: Pick<ProjectRecord, "name" | "goal" | "attention"> & { id?: string }) {
  const database = getDatabase();
  const id = input.id || randomUUID();
  const timestamp = now();
  database.prepare(`
    INSERT INTO projects (id, name, goal, attention, status, created_at, updated_at)
    VALUES (@id, @name, @goal, @attention, 'uploaded', @timestamp, @timestamp)
  `).run({ id, name: input.name, goal: input.goal, attention: input.attention, timestamp });
  return getProject(id)!;
}

export function getProject(id: string) {
  const row = projectStatement(getDatabase()).get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function listProjects() {
  return (getDatabase().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[]).map(toProject);
}

export function addSource(input: Omit<SourceRecord, "id" | "createdAt"> & { id?: string }) {
  const database = getDatabase();
  const id = input.id || randomUUID();
  const createdAt = now();
  database.prepare(`
    INSERT INTO sources (id, project_id, display_name, storage_path, media_type, byte_size, profile_json, parse_warnings_json, created_at)
    VALUES (@id, @projectId, @displayName, @storagePath, @mediaType, @byteSize, @profile, @warnings, @createdAt)
  `).run({
    id,
    projectId: input.projectId,
    displayName: input.displayName,
    storagePath: input.storagePath,
    mediaType: input.mediaType,
    byteSize: input.byteSize,
    profile: input.profile === null ? null : json(input.profile),
    warnings: json(input.parseWarnings),
    createdAt,
  });
  return getSource(id)!;
}

export function getSource(id: string) {
  const row = getDatabase().prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
  return row ? toSource(row) : null;
}

export function listSources(projectId: string) {
  return (getDatabase().prepare("SELECT * FROM sources WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as SourceRow[]).map(toSource);
}

export function saveInterpretation(projectId: string, semanticPlan: unknown, runId?: string) {
  const database = getDatabase();
  const timestamp = now();
  const transaction = database.transaction(() => {
    database.prepare("UPDATE projects SET status = 'review', error_message = NULL, semantic_plan_json = ?, updated_at = ? WHERE id = ?")
      .run(json(semanticPlan), timestamp, projectId);
    if (runId) {
      database.prepare("UPDATE analysis_runs SET status = 'complete', semantic_plan_json = ?, completed_at = ? WHERE id = ?")
        .run(json(semanticPlan), timestamp, runId);
    } else {
      database.prepare(`
        INSERT INTO analysis_runs (id, project_id, kind, status, semantic_plan_json, started_at, completed_at)
        VALUES (?, ?, 'interpretation', 'complete', ?, ?, ?)
      `).run(randomUUID(), projectId, json(semanticPlan), timestamp, timestamp);
    }
  });
  transaction();
  return getProject(projectId)!;
}

export function startAnalysisRun(projectId: string, kind: "interpretation" | "generation") {
  const database = getDatabase();
  const id = randomUUID();
  const timestamp = now();
  database.prepare("INSERT INTO analysis_runs (id, project_id, kind, status, started_at) VALUES (?, ?, ?, 'running', ?)")
    .run(id, projectId, kind, timestamp);
  return id;
}

/** Atomically claims the single permitted interpretation run for a project. */
export function beginInterpretationRun(projectId: string): string | null {
  const database = getDatabase();
  const runId = randomUUID();
  const timestamp = now();
  const transaction = database.transaction(() => {
    const claimed = database.prepare(`
      UPDATE projects
      SET status = 'interpreting', error_message = NULL, updated_at = ?
      WHERE id = ?
        AND semantic_plan_json IS NULL
        AND status IN ('uploaded', 'failed')
    `).run(timestamp, projectId);
    if (claimed.changes !== 1) return null;
    database.prepare("INSERT INTO analysis_runs (id, project_id, kind, status, started_at) VALUES (?, ?, 'interpretation', 'running', ?)")
      .run(runId, projectId, timestamp);
    return runId;
  });
  return transaction();
}

export function markAnalysisRunFailed(projectId: string, runId: string, message: string, fallbackStatus: StoredProjectStatus = "failed") {
  const timestamp = now();
  const database = getDatabase();
  const transaction = database.transaction(() => {
    database.prepare("UPDATE analysis_runs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?")
      .run(message, timestamp, runId);
    database.prepare("UPDATE projects SET status = ?, error_message = ?, updated_at = ? WHERE id = ?")
      .run(fallbackStatus, message, timestamp, projectId);
  });
  transaction();
}

export function markProjectStatus(projectId: string, status: StoredProjectStatus, errorMessage: string | null = null) {
  getDatabase().prepare("UPDATE projects SET status = ?, error_message = ?, updated_at = ? WHERE id = ?")
    .run(status, errorMessage, now(), projectId);
}

export function saveDashboard(
  projectId: string,
  dashboard: unknown,
  acceptedMetricIds: string[],
  runId?: string,
  metricDefinitions: unknown[] = [],
  metricResults: unknown[] = [],
) {
  const database = getDatabase();
  const timestamp = now();
  const validatedDashboard = dashboardAnalysisSchema.parse(dashboard);
  const dashboardRecord = asRecord(validatedDashboard);
  const metrics = Array.isArray(dashboardRecord.metrics) ? dashboardRecord.metrics : [];
  const transaction = database.transaction(() => {
    database.prepare("DELETE FROM metrics WHERE project_id = ?").run(projectId);
    database.prepare("DELETE FROM findings WHERE project_id = ?").run(projectId);
    database.prepare("UPDATE projects SET status = 'ready', error_message = NULL, dashboard_json = ?, updated_at = ? WHERE id = ?")
      .run(json(validatedDashboard), timestamp, projectId);
    if (runId) {
      database.prepare("UPDATE analysis_runs SET status = 'complete', result_json = ?, completed_at = ? WHERE id = ?")
        .run(json(validatedDashboard), timestamp, runId);
    } else {
      database.prepare(`
        INSERT INTO analysis_runs (id, project_id, kind, status, result_json, started_at, completed_at)
        VALUES (?, ?, 'generation', 'complete', ?, ?, ?)
      `).run(randomUUID(), projectId, json(validatedDashboard), timestamp, timestamp);
    }

    for (const metric of metrics) {
      const metricRecord = asRecord(metric);
      const metricId = typeof metricRecord.metricId === "string"
        ? metricRecord.metricId
        : typeof metricRecord.id === "string"
          ? metricRecord.id
          : randomUUID();
      const definition = metricDefinitions.map(asRecord).find((candidate) =>
        candidate.metricId === metricId || candidate.id === metricId,
      ) ?? metricRecord.definition ?? metricRecord;
      const calculatedResult = metricResults.map(asRecord).find((candidate) =>
        candidate.metricId === metricId || candidate.id === metricId,
      ) ?? metricRecord;
      database.prepare(`
        INSERT INTO metrics (id, project_id, metric_id, definition_json, result_json, chart_series_json, evidence_json, accepted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        projectId,
        metricId,
        json(definition),
        json(calculatedResult),
        calculatedResult.series === undefined ? null : json(calculatedResult.series),
        calculatedResult.evidence === undefined ? null : json(calculatedResult.evidence),
        acceptedMetricIds.includes(metricId) ? 1 : 0,
        timestamp,
      );
    }

    for (const warning of asArray(dashboardRecord.warnings)) {
      database.prepare("INSERT INTO findings (id, project_id, kind, payload_json, created_at) VALUES (?, ?, 'warning', ?, ?)")
        .run(randomUUID(), projectId, json(warning), timestamp);
    }
    if (dashboardRecord.chart !== undefined) {
      database.prepare("INSERT INTO findings (id, project_id, kind, payload_json, created_at) VALUES (?, ?, 'chart', ?, ?)")
        .run(randomUUID(), projectId, json(dashboardRecord.chart), timestamp);
    }
    for (const frameworkTag of asArray(dashboardRecord.frameworkTags)) {
      database.prepare("INSERT INTO findings (id, project_id, kind, payload_json, created_at) VALUES (?, ?, 'framework_tag', ?, ?)")
        .run(randomUUID(), projectId, json(frameworkTag), timestamp);
    }
    for (const dimension of asArray(dashboardRecord.fiveDimensions)) {
      database.prepare("INSERT INTO findings (id, project_id, kind, payload_json, created_at) VALUES (?, ?, 'five_dimension', ?, ?)")
        .run(randomUUID(), projectId, json(dimension), timestamp);
    }
  });
  transaction();
  return getProject(projectId)!;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}
