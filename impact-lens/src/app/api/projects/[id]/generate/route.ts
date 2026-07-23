import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { getProject, listSources, markAnalysisRunFailed, markProjectStatus, saveDashboard, startAnalysisRun } from "@/lib/db/projects";
import { runAnalysis } from "@/lib/analysis/pipeline";
import { semanticPlanSchema } from "@/lib/semantic/schema";

type GenerateRequest = {
  acceptedMetricIds?: unknown;
  confirmedJoinId?: unknown;
};

export async function POST(request: Request, context: RouteContext<"/api/projects/[id]/generate">) {
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  if (!project.semanticPlan) return Response.json({ error: "Interpret the project before generating a dashboard." }, { status: 409 });
  const savedPlan = semanticPlanSchema.safeParse(project.semanticPlan);
  if (!savedPlan.success) return Response.json({ error: "The saved interpretation is invalid. Retry interpretation before generating." }, { status: 409 });

  let body: GenerateRequest;
  try {
    body = await request.json() as GenerateRequest;
  } catch {
    return Response.json({ error: "Expected a JSON review submission." }, { status: 400 });
  }

  const acceptedMetricIds = normaliseStringArray(body.acceptedMetricIds);
  if (acceptedMetricIds.length === 0) {
    return Response.json({ error: "Keep at least one proposed KPI to generate a dashboard." }, { status: 400 });
  }
  const availableMetricIds = new Set(savedPlan.data.proposedMetrics.map((metric) => metric.metricId));
  if (acceptedMetricIds.some((metricId) => !availableMetricIds.has(metricId))) {
    return Response.json({ error: "The review contains a KPI that is not part of the saved interpretation." }, { status: 400 });
  }
  const confirmedJoinId = typeof body.confirmedJoinId === "string" && body.confirmedJoinId.trim() ? body.confirmedJoinId : undefined;

  let rawFiles: Awaited<ReturnType<typeof loadRawFiles>>;
  try {
    rawFiles = await loadRawFiles(id);
  } catch {
    return Response.json({ error: "The original uploads are no longer available." }, { status: 409 });
  }
  if (rawFiles.length === 0) return Response.json({ error: "The original uploads are no longer available." }, { status: 409 });

  const runId = startAnalysisRun(id, "generation");
  markProjectStatus(id, "generating");

  try {
    // The review has already persisted the only Claude response. The injected
    // interpreter returns that immutable plan so generation remains deterministic.
    const analysis = await runAnalysis({
      projectId: id,
      projectName: project.name,
      goal: project.goal,
      attention: project.attention,
      files: rawFiles,
      interpret: async () => savedPlan.data,
      acceptedMetricIds,
      confirmedJoinId,
    });
    const dashboard = withPersistedProject(analysis.dashboard, project, rawFiles.length);
    const savedProject = saveDashboard(id, dashboard, acceptedMetricIds, runId, analysis.metricDefinitions, analysis.metricResults);
    return Response.json({ project: savedProject, dashboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dashboard generation could not be completed.";
    // The semantic plan remains valid; return to review without another model run.
    markAnalysisRunFailed(id, runId, message, "review");
    return Response.json({ error: message, project: getProject(id) }, { status: 500 });
  }
}

async function loadRawFiles(projectId: string) {
  const unique = new Map<string, { name: string; storagePath: string; sourceKey: string }>();
  for (const source of listSources(projectId)) {
    const profile = asRecord(source.profile);
    const filename = typeof profile.filename === "string" ? profile.filename : source.displayName.split(" · ")[0] || source.displayName;
    unique.set(source.storagePath, {
      name: filename,
      storagePath: source.storagePath,
      sourceKey: basename(source.storagePath, extname(source.storagePath)),
    });
  }

  return Promise.all([...unique.values()].map(async (source) => ({
    name: source.name,
    sourceKey: source.sourceKey,
    bytes: new Uint8Array(await readFile(source.storagePath)),
  })));
}

function normaliseStringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))]
    : [];
}

function withPersistedProject(analysis: unknown, project: { id: string; name: string; goal: string }, sourceCount: number) {
  const dashboard = asRecord(analysis);
  const generatedProject = asRecord(dashboard.project);
  return {
    ...dashboard,
    project: {
      ...generatedProject,
      id: project.id,
      name: project.name,
      goal: project.goal,
      sourceCount,
      status: "ready",
      updatedAt: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
