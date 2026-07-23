import Link from "next/link";

import { listProjects, listSources, type ProjectRecord } from "@/lib/db/projects";
import { dashboardAnalysisSchema } from "@/types/dashboard";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const projects = listProjects();
  return (
    <main className="min-h-screen bg-[#f5f4ee] px-5 py-10 text-slate-950 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between"><Link className="text-lg font-bold" href="/">ImpactLens<span className="text-emerald-700">.</span></Link><Link className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white" href="/projects/new">New project</Link></div>
        <div className="mt-16"><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Workspace</p><h1 className="mt-3 text-5xl font-semibold tracking-tight">Projects</h1><p className="mt-4 text-slate-600">Open a cached assessment or return to an analysis that needs attention.</p></div>
        <div className="mt-10 space-y-3">
          <ProjectLink detail="Synthetic fallback · Ready without Claude" id="demo" metadata="1 source · 4 accepted KPIs" name="Harbor Health Collective" status="ready" />
          {projects.filter((project) => project.id !== "demo").map((project) => <ProjectLink detail={projectDetail(project)} id={project.id} key={project.id} metadata={projectMetadata(project)} name={project.name} status={project.status} />)}
        </div>
      </div>
    </main>
  );
}

function ProjectLink({ id, name, detail, metadata, status }: { id: string; name: string; detail: string; metadata: string; status: ProjectRecord["status"] | "ready" }) {
  const presentation = statusPresentation(status);
  return (
    <Link className="flex flex-col justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lg sm:flex-row sm:items-center" href={status === "review" ? `/projects/new?project=${encodeURIComponent(id)}` : `/projects/${id}`}>
      <div><h2 className="text-xl font-semibold">{name}</h2><p className="mt-2 text-sm text-slate-500">{detail}</p><p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{metadata}</p></div>
      <span className={`self-start rounded-full px-3 py-1 text-xs font-bold sm:self-auto ${presentation.tone}`}>{presentation.label}</span>
    </Link>
  );
}

function projectMetadata(project: ProjectRecord): string {
  const sourceCount = listSources(project.id).length;
  const parsed = dashboardAnalysisSchema.safeParse(project.dashboard);
  const metricCount = parsed.success ? parsed.data.metrics.length : 0;
  return `${sourceCount} ${sourceCount === 1 ? "source" : "sources"} · ${metricCount} accepted ${metricCount === 1 ? "KPI" : "KPIs"}`;
}

function projectDetail(project: ProjectRecord): string {
  if (project.errorMessage) return project.errorMessage;
  if (project.status === "review") return "Semantic plan ready for KPI review";
  return `Updated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(project.updatedAt))}`;
}

function statusPresentation(status: ProjectRecord["status"] | "ready") {
  if (status === "ready") return { label: "Ready", tone: "bg-emerald-100 text-emerald-800" };
  if (status === "failed") return { label: "Needs attention", tone: "bg-amber-100 text-amber-800" };
  if (status === "review") return { label: "Review", tone: "bg-violet-100 text-violet-800" };
  return { label: "Processing", tone: "bg-blue-100 text-blue-800" };
}
