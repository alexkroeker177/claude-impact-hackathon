import { beginInterpretationRun, getProject, listSources, markAnalysisRunFailed, saveInterpretation } from "@/lib/db/projects";
import { interpretProject } from "@/lib/semantic/interpret";
import type { SemanticSourceProfile } from "@/lib/semantic/schema";

export async function POST(_request: Request, context: RouteContext<"/api/projects/[id]/interpret">) {
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.semanticPlan) {
    return Response.json({ project, semanticPlan: project.semanticPlan, sources: listSources(id).map(publicSource), cached: true });
  }

  const profiles = listSources(id).flatMap((source) => source.profile === null ? [] : [source.profile]) as SemanticSourceProfile[];
  if (profiles.length === 0) {
    return Response.json({ error: "This project has no parsed tables to interpret." }, { status: 422 });
  }

  const runId = beginInterpretationRun(id);
  if (!runId) {
    const current = getProject(id);
    if (current?.semanticPlan) {
      return Response.json({ project: current, semanticPlan: current.semanticPlan, sources: listSources(id).map(publicSource), cached: true });
    }
    return Response.json({ error: "Interpretation is already in progress for this project.", project: current }, { status: 409 });
  }

  try {
    const semanticPlan = await interpretProject({
      projectName: project.name,
      goal: project.goal,
      attention: project.attention,
      profiles,
    });
    const savedProject = saveInterpretation(id, semanticPlan, runId);
    return Response.json({ project: savedProject, semanticPlan, sources: listSources(id).map(publicSource) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Interpretation could not be completed.";
    markAnalysisRunFailed(id, runId, message);
    return Response.json({ error: message, project: getProject(id) }, { status: 502 });
  }
}

function publicSource(source: { id: string; displayName: string; mediaType: string; byteSize: number; profile: unknown | null; parseWarnings: unknown[] }) {
  return {
    id: source.id,
    displayName: source.displayName,
    mediaType: source.mediaType,
    byteSize: source.byteSize,
    profile: source.profile,
    parseWarnings: source.parseWarnings,
  };
}
