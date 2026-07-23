import { interpretProject } from "@/lib/semantic/interpret";
import {
  failRun,
  getProfiles,
  getProject,
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

  setProjectStatus(id, "interpreting");
  const run = saveRun(id);
  try {
    const plan = await interpretProject({
      projectName: project.name,
      goal: project.goal,
      attention: project.attention,
      profiles,
    });
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
