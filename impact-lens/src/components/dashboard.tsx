"use client";

import Link from "next/link";
import { useState } from "react";

import { EvidenceDrawer } from "./evidence-drawer";
import { ImpactChart } from "./impact-chart";
import type { DashboardAnalysis, DashboardMetric, ProjectStatus } from "@/types/dashboard";

type Tab = "overall" | "warnings" | "outlook";

export function Dashboard({ analysis }: { analysis: DashboardAnalysis }) {
  const [activeTab, setActiveTab] = useState<Tab>("overall");
  const [selectedMetric, setSelectedMetric] = useState<DashboardMetric | null>(null);

  return (
    <main className="min-h-screen bg-[#f5f4ee] text-slate-950">
      <header className="border-b border-slate-200/80 bg-[#f5f4ee]/95 px-5 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link className="text-lg font-bold tracking-tight" href="/">ImpactLens<span className="text-emerald-700">.</span></Link>
          <Link className="text-sm font-semibold text-slate-600 transition hover:text-slate-950" href="/projects">All projects</Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        <section className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              <span>Impact assessment</span>
              {analysis.project.synthetic ? <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Synthetic demo</span> : null}
            </div>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">{analysis.project.name}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">{analysis.project.goal}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 text-sm text-slate-600">
            <div className="flex justify-between gap-4"><span>Data window</span><strong className="text-right text-slate-900">{analysis.project.dataWindow}</strong></div>
            <div className="mt-3 flex justify-between gap-4"><span>Sources</span><strong className="text-slate-900">{analysis.project.sourceCount}</strong></div>
            <div className="mt-3 flex justify-between gap-4"><span>Updated</span><strong className="text-right text-slate-900">{analysis.project.updatedAt}</strong></div>
          </div>
        </section>

        <nav aria-label="Dashboard sections" className="mt-10 flex gap-1 overflow-x-auto border-b border-slate-300" role="tablist">
          <TabButton active={activeTab === "overall"} onClick={() => setActiveTab("overall")}>Overall</TabButton>
          <TabButton active={activeTab === "warnings"} count={analysis.warnings.length} onClick={() => setActiveTab("warnings")}>Early warnings</TabButton>
          <TabButton active={activeTab === "outlook"} onClick={() => setActiveTab("outlook")}>Outlook</TabButton>
        </nav>

        <div className="pt-8">
          {activeTab === "overall" ? <Overall analysis={analysis} onEvidence={setSelectedMetric} /> : null}
          {activeTab === "warnings" ? <Warnings analysis={analysis} /> : null}
          {activeTab === "outlook" ? <Outlook analysis={analysis} /> : null}
        </div>
      </div>

      <EvidenceDrawer metric={selectedMetric} onClose={() => setSelectedMetric(null)} />
    </main>
  );
}

function TabButton({ active, children, count, onClick }: { active: boolean; children: React.ReactNode; count?: number; onClick: () => void }) {
  return (
    <button
      aria-selected={active}
      className={`min-h-12 whitespace-nowrap border-b-2 px-4 text-sm font-semibold transition ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500 hover:text-slate-900"}`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}{count ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{count}</span> : null}
    </button>
  );
}

function Overall({ analysis, onEvidence }: { analysis: DashboardAnalysis; onEvidence: (metric: DashboardMetric) => void }) {
  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Overall assessment</p>
            <div className="mt-4 flex items-baseline gap-2"><span className="text-5xl font-semibold">{Math.round(analysis.assessment.coverage * 100)}%</span><span className="text-sm text-slate-400">coverage</span></div>
          </div>
          <div>
            <h2 className="text-2xl font-medium leading-9 sm:text-3xl">Programme impact at a glance</h2>
            <p className="mt-3 max-w-3xl leading-7 text-slate-300">{analysis.assessment.summary}</p>
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{analysis.assessment.confidence} confidence · based on available records</p>
          </div>
        </div>
      </section>

      <section aria-label="Key performance indicators" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {analysis.metrics.map((metric) => (
          <article className="group flex min-h-64 flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_-48px_rgba(15,23,42,0.5)]" key={metric.id}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-slate-700">{metric.label}</p>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">{Math.round(metric.coverage * 100)}%</span>
            </div>
            <div className="mt-8"><span className="text-4xl font-semibold tracking-tight">{metric.displayValue}</span><span className="ml-2 text-sm text-slate-500">{metric.unit}</span></div>
            <p className="mt-3 flex-1 text-sm leading-6 text-slate-500">{metric.context}</p>
            <button
              aria-label={`View evidence for ${metric.label}`}
              className="mt-5 border-t border-slate-100 pt-4 text-left text-sm font-bold text-emerald-700 transition group-hover:text-emerald-900"
              onClick={() => onEvidence(metric)}
              type="button"
            >
              View evidence <span aria-hidden="true">→</span>
            </button>
          </article>
        ))}
      </section>

      {analysis.chart ? <ImpactChart {...analysis.chart} /> : <LimitedResult />}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Impact Management Project</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Five Dimensions coverage</h2></div>
          <p className="max-w-lg text-sm leading-6 text-slate-500">What the available data can support—not a certification or compliance assessment.</p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-5">
          {analysis.fiveDimensions.map((item) => (
            <article className="rounded-2xl border border-slate-200 p-4" key={item.dimension}>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${item.status === "identified" ? "bg-emerald-600" : item.status === "partial" ? "bg-amber-500" : "bg-slate-300"}`} />
              <h3 className="mt-4 font-semibold">{item.dimension}</h3>
              <p className="mt-2 text-xs leading-5 text-slate-500">{item.evidence}</p>
            </article>
          ))}
        </div>
      </section>

      {analysis.frameworkTags.length ? (
        <section>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Candidate alignment</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {analysis.frameworkTags.map((tag) => (
              <article className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 p-5" key={`${tag.framework}-${tag.label}`}>
                <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-emerald-950">{tag.label}</h3><span className="text-xs font-bold text-emerald-800">{Math.round(tag.confidence * 100)}%</span></div>
                <p className="mt-2 text-sm leading-6 text-emerald-950/70">{tag.rationale}</p>
                <p className="mt-3 text-xs font-semibold text-emerald-900">{tag.caveat}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Warnings({ analysis }: { analysis: DashboardAnalysis }) {
  const dataWarnings = analysis.warnings.filter((warning) => warning.scope === "data");
  const projectWarnings = analysis.warnings.filter((warning) => warning.scope === "project");
  return (
    <section className="mx-auto max-w-4xl">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Review queue</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">Early warning signs</h2>
      <p className="mt-3 max-w-2xl leading-7 text-slate-600">Signals to investigate before using these results for decisions. ImpactLens never silently repairs the source data.</p>
      <WarningGroup title="Data warnings" warnings={dataWarnings} />
      <WarningGroup title="Project warnings" warnings={projectWarnings} />
    </section>
  );
}

function WarningGroup({ title, warnings }: { title: string; warnings: DashboardAnalysis["warnings"] }) {
  if (!warnings.length) return null;
  return <section className="mt-8"><h3 className="text-lg font-semibold">{title}</h3><div className="mt-4 space-y-4">{warnings.map((warning) => <article className="rounded-3xl border border-amber-200 bg-white p-6" key={warning.id}><div className="flex items-start gap-4"><span className="mt-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase text-amber-800">{warning.severity}</span><div><h4 className="text-lg font-semibold">{warning.title}</h4><p className="mt-2 leading-7 text-slate-600">{warning.detail}</p><p className="mt-4 text-sm font-semibold text-slate-900">Next check: {warning.recommendation}</p></div></div></article>)}</div></section>;
}

function Outlook({ analysis }: { analysis: DashboardAnalysis }) {
  return (
    <section className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-7 sm:p-10">
      <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-600">No forecast generated</span>
      <h2 className="mt-6 text-4xl font-semibold tracking-tight">Insufficient evidence</h2>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">{analysis.outlook.summary}</p>
      <div className="mt-8 border-t border-slate-200 pt-6"><h3 className="font-semibold">What would unlock a prognosis</h3><ul className="mt-4 grid gap-3 sm:grid-cols-2">{analysis.outlook.missingRequirements.map((item) => <li className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700" key={item}>{item}</li>)}</ul></div>
    </section>
  );
}

function LimitedResult() {
  return <section className="rounded-3xl border border-dashed border-slate-300 bg-white/50 p-8"><h2 className="text-xl font-semibold">Limited result</h2><p className="mt-2 text-slate-600">The available data supports KPI cards, but not a trustworthy chart.</p></section>;
}

export function ProjectStatusPanel({ status, message, projectId, hasSemanticPlan = false }: { status: Exclude<ProjectStatus, "ready">; message: string; projectId?: string; hasSemanticPlan?: boolean }) {
  const failed = status === "failed";
  const [retrying, setRetrying] = useState(false);

  async function retryInterpretation() {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/interpret`, { method: "POST" });
      if (!response.ok) throw new Error("Interpretation retry failed.");
      window.location.assign(`/projects/new?project=${encodeURIComponent(projectId)}`);
    } finally {
      setRetrying(false);
    }
  }
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-2xl flex-col justify-center px-6 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">{failed ? "Analysis paused" : "Analysis in progress"}</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">{failed ? "Your parsed data is safe" : "Building an evidence-backed view"}</h1>
      <p className="mt-4 leading-7 text-slate-600">{message}</p>
      {hasSemanticPlan && projectId ? <Link className="mx-auto mt-8 rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white" href={`/projects/new?project=${encodeURIComponent(projectId)}`}>Continue review</Link> : failed ? <button className="mx-auto mt-8 rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white disabled:bg-slate-400" disabled={retrying} onClick={() => void retryInterpretation()} type="button">{retrying ? "Retrying…" : "Retry interpretation"}</button> : <div className="mx-auto mt-8 h-2 w-64 overflow-hidden rounded-full bg-slate-200"><div className="h-full w-2/3 rounded-full bg-emerald-600" /></div>}
    </section>
  );
}
