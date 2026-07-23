import fsp from "node:fs/promises";
import { isMockMode, loadMockPlan, mockDelay } from "@/lib/mock";
import { interpretProject } from "@/lib/semantic/interpret";
import { parseTabularFile } from "@/lib/files/parse";
import type { ParsedTable } from "@/lib/files/types";
import {
  failRun,
  getProfiles,
  getProject,
  getSources,
  savePlanMetrics,
  saveRun,
  setProjectError,
  setProjectStatus,
  updateRunPlan,
} from "@/lib/db/projects";

export const runtime = "nodejs";

function jsonError(status: number, kind: string, message: string): Response {
  return Response.json({ error: { kind, message } }, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return jsonError(404, "not_found", `Project ${id} not found.`);
  }
  const profiles = getProfiles(id);
  if (profiles.length === 0) {
    return jsonError(400, "no_sources", "Project has no uploaded sources to interpret.");
  }

  // Re-parse stored uploads so Claude sees actual rows, not just column stats.
  // Best-effort: interpretation still works from profiles alone if a file is unreadable.
  let tables: ParsedTable[] | null = null;
  try {
    const parsed: ParsedTable[] = [];
    const seenPaths = new Set<string>();
    for (const source of getSources(id)) {
      if (seenPaths.has(source.storedPath)) continue;
      seenPaths.add(source.storedPath);
      const bytes = await fsp.readFile(source.storedPath);
      parsed.push(...parseTabularFile({ name: source.fileName, bytes: new Uint8Array(bytes) }));
    }
    tables = parsed;
  } catch {
    tables = null;
  }

  setProjectStatus(id, "interpreting");
  const run = saveRun(id);
  try {
    let plan;
    if (isMockMode()) {
      await mockDelay(1800);
      plan = loadMockPlan();
    } else {
      plan = await interpretProject({
        projectName: project.name,
        goal: project.goal,
        attention: project.attention,
        profiles,
        tables,
      });
    }
    updateRunPlan(run.id, plan);
    savePlanMetrics(id, run.id, plan);
    setProjectStatus(id, "interpreted");
    return Response.json({ plan, profiles });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failRun(run.id, message);
    setProjectError(id, message);
    return jsonError(502, "interpretation_failed", message);
  }
}
