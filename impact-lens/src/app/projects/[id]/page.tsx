import { notFound } from "next/navigation";

import { Dashboard, ProjectStatusPanel } from "@/components/dashboard";
import { getProject } from "@/lib/db/projects";
import { dashboardAnalysisSchema } from "@/types/dashboard";
import syntheticDashboard from "../../../../fixtures/synthetic-dashboard.json";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "demo") return <Dashboard analysis={dashboardAnalysisSchema.parse(syntheticDashboard)} />;

  const project = getProject(id);
  if (!project) notFound();

  const savedDashboard = dashboardAnalysisSchema.safeParse(project.dashboard);
  if (project.status === "ready" && savedDashboard.success) {
    return <Dashboard analysis={savedDashboard.data} />;
  }

  if (project.status === "failed") {
    return <ProjectStatusPanel hasSemanticPlan={project.semanticPlan !== null} message={project.errorMessage ?? "The parsed profiles remain saved, but analysis did not complete."} projectId={project.id} status="failed" />;
  }

  return <ProjectStatusPanel hasSemanticPlan={project.semanticPlan !== null} message={project.status === "review" ? "The semantic plan is saved and waiting for KPI review in the project wizard." : "The uploaded tables are saved while ImpactLens prepares the next review step."} projectId={project.id} status="processing" />;
}
