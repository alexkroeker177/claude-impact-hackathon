import { getDashboard, getPlanAndProfiles, getProject } from "@/lib/db/projects";

export const runtime = "nodejs";

function jsonError(status: number, kind: string, message: string): Response {
  return Response.json({ error: { kind, message } }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return jsonError(404, "not_found", `Project ${id} not found.`);
  }
  try {
    const { plan, profiles } = getPlanAndProfiles(id);
    const dashboard = getDashboard(id);
    return Response.json({
      project: {
        id: project.id,
        name: project.name,
        goal: project.goal,
        attention: project.attention,
        status: project.status,
        createdAt: project.createdAt,
        synthetic: project.synthetic,
        error: project.error,
      },
      profiles,
      plan,
      dashboard,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, "internal", message);
  }
}
