import fsp from "node:fs/promises";
import { z } from "zod";
import { runAnalysis } from "@/lib/analysis/pipeline";
import { computeMetricsWithClaude } from "@/lib/analysis/llm-compute";
import { narrateDashboard } from "@/lib/analysis/narrate";
import { isMockMode, loadMockDashboard, mockDelay } from "@/lib/mock";
import type { FileInput } from "@/lib/files/types";
import {
  getPlanAndProfiles,
  getProject,
  getSources,
  saveDashboard,
  saveMetricResults,
  setProjectError,
  setProjectStatus,
  updateMetricsAccepted,
} from "@/lib/db/projects";

export const runtime = "nodejs";

const bodySchema = z.object({
  acceptedMetricIds: z.array(z.string()),
  confirmedJoinId: z.string().nullable().optional(),
});

function jsonError(status: number, kind: string, message: string): Response {
  return Response.json({ error: { kind, message } }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return jsonError(404, "not_found", `Project ${id} not found.`);
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(400, "validation", `Invalid request body: ${message}`);
  }

  const { runId, plan } = getPlanAndProfiles(id);
  if (!plan || !runId) {
    return jsonError(409, "no_plan", "Project has no interpreted plan yet — POST interpret first.");
  }

  // Re-read the original uploads (one FileInput per stored file, dedup across sheets).
  const files: FileInput[] = [];
  const seenPaths = new Set<string>();
  try {
    for (const source of getSources(id)) {
      if (seenPaths.has(source.storedPath)) continue;
      seenPaths.add(source.storedPath);
      const bytes = await fsp.readFile(source.storedPath);
      files.push({ name: source.fileName, bytes: new Uint8Array(bytes) });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, "missing_upload", `Could not re-read stored uploads: ${message}`);
  }

  setProjectStatus(id, "generating");
  try {
    let dashboard;
    if (isMockMode()) {
      await mockDelay(2200);
      dashboard = loadMockDashboard();
    } else {
      dashboard = await runAnalysis({
        context: { projectName: project.name, goal: project.goal, attention: project.attention },
        files,
        // Stored plan for the semantic step; compute + narrate are their own Claude calls.
        interpret: async () => plan,
        compute: computeMetricsWithClaude,
        narrate: narrateDashboard,
        acceptedMetricIds: body.acceptedMetricIds,
        confirmedJoinId: body.confirmedJoinId ?? null,
      });
    }
    saveDashboard(id, runId, dashboard);
    updateMetricsAccepted(runId, body.acceptedMetricIds);
    saveMetricResults(
      runId,
      dashboard.metrics.map((metric) => metric.result),
    );
    setProjectStatus(id, "ready");
    return Response.json({ dashboard });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setProjectError(id, message);
    return jsonError(500, "generation_failed", message);
  }
}
