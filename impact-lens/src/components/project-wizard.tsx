"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ReviewStep } from "./review-step";

type UploadResponse = {
  project?: { id: string };
  sources?: Array<{ id: string; displayName: string; profile: unknown | null; parseWarnings: unknown[] }>;
  error?: string;
};

type InterpretationResponse = UploadResponse & { semanticPlan?: unknown };

type WizardStage = "details" | "uploading" | "interpreting" | "review" | "generating";

export function ProjectWizard() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [goal, setGoal] = useState("");
  const [attention, setAttention] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<WizardStage>("details");
  const [projectId, setProjectId] = useState<string>();
  const [semanticPlan, setSemanticPlan] = useState<unknown>();
  const [sources, setSources] = useState<NonNullable<UploadResponse["sources"]>>([]);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    const savedProjectId = new URLSearchParams(window.location.search).get("project");
    if (!savedProjectId) return;
    const projectIdToRestore = savedProjectId;

    async function loadSavedReview() {
      try {
        const saved = await requestJson<InterpretationResponse>(`/api/projects?id=${encodeURIComponent(projectIdToRestore)}`, { method: "GET" });
        const project = saved.project as { id: string; semanticPlan?: unknown } | undefined;
        if (!project?.semanticPlan) return;
        setProjectId(project.id);
        setSemanticPlan(project.semanticPlan);
        setSources(saved.sources || []);
        setStage("review");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The saved review could not be restored.");
      }
    }

    void loadSavedReview();
  }, []);

  async function beginReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(undefined);
    if (files.length === 0) {
      setNotice("Choose at least one CSV or XLSX file.");
      return;
    }

    setStage("uploading");
    try {
      const payload = new FormData();
      payload.set("projectName", projectName);
      payload.set("goal", goal);
      payload.set("attention", attention);
      files.forEach((file) => payload.append("files", file));
      const upload = await requestJson<UploadResponse>("/api/projects", { method: "POST", body: payload });
      if (!upload.project?.id) throw new Error(upload.error || "The project could not be saved.");
      setProjectId(upload.project.id);
      setSources(upload.sources || []);
      await interpretExisting(upload.project.id, upload.sources || []);
    } catch (error) {
      setStage("details");
      setNotice(error instanceof Error ? error.message : "The project could not be processed.");
    }
  }

  async function interpretExisting(id: string, fallbackSources: NonNullable<UploadResponse["sources"]> = []) {
    setStage("interpreting");
    const interpretation = await requestJson<InterpretationResponse>(`/api/projects/${id}/interpret`, { method: "POST" });
    if (!interpretation.semanticPlan) throw new Error(interpretation.error || "The project could not be interpreted.");
    setSources(interpretation.sources || fallbackSources);
    setSemanticPlan(interpretation.semanticPlan);
    setStage("review");
    router.replace(`/projects/new?project=${encodeURIComponent(id)}`);
  }

  async function retryInterpretation() {
    if (!projectId) return;
    setNotice(undefined);
    try {
      await interpretExisting(projectId, sources);
    } catch (error) {
      setStage("details");
      setNotice(error instanceof Error ? error.message : "The project could not be interpreted.");
    }
  }

  async function generate(acceptedMetricIds: string[], confirmedJoinId?: string) {
    if (!projectId) return;
    setNotice(undefined);
    setStage("generating");
    try {
      await requestJson(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acceptedMetricIds, confirmedJoinId }),
      });
      router.push(`/projects/${projectId}`);
    } catch (error) {
      setStage("review");
      setNotice(error instanceof Error ? error.message : "The dashboard could not be generated.");
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f4ee] px-5 py-8 text-slate-950 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4"><Link className="text-lg font-bold tracking-tight" href="/">ImpactLens<span className="text-emerald-700">.</span></Link><Link className="text-sm font-semibold text-slate-600 hover:text-slate-950" href="/projects">All projects</Link></header>

        <div className="mt-12 max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">New impact assessment</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">Upload once. Review the logic. Keep the evidence.</h1><p className="mt-5 text-lg leading-8 text-slate-600">ImpactLens profiles every table, makes one bounded interpretation request, then calculates only the KPIs you accept.</p></div>

        <Progress stage={stage} />
        {notice ? <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm font-medium text-amber-950" role="alert"><span>{notice}</span>{projectId && !semanticPlan ? <button className="rounded-full border border-amber-400 bg-white px-4 py-2 text-xs font-bold text-amber-950" onClick={() => void retryInterpretation()} type="button">Retry interpretation</button> : null}</div> : null}

        {stage === "details" || stage === "uploading" || stage === "interpreting" ? <form className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8" onSubmit={beginReview}>
          <div className="grid gap-5 sm:grid-cols-2"><Field label="Project name" value={projectName} onChange={setProjectName} placeholder="e.g. Community skills pilot" required /><Field label="What decision should this support?" value={goal} onChange={setGoal} placeholder="e.g. Understand where participant outcomes improve" required /></div>
          <div className="mt-5"><Field label="Anything to pay special attention to? (optional)" value={attention} onChange={setAttention} placeholder="e.g. equitable reach across locations" /></div>
          <div className="mt-6"><label className="block text-sm font-semibold text-slate-800" htmlFor="source-files">CSV or XLSX files</label><p className="mt-1 text-sm leading-6 text-slate-500">Any number of files. The combined upload is limited to 10 MB and 25,000 parsed rows.</p><input accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-4 block w-full cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-emerald-100 file:px-4 file:py-2 file:font-semibold file:text-emerald-900 hover:border-emerald-400" id="source-files" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} type="file" /></div>
          {files.length > 0 ? <ul className="mt-4 grid gap-2 sm:grid-cols-2">{files.map((file) => <li className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700" key={`${file.name}-${file.lastModified}`}>{file.name} <span className="text-slate-400">· {formatBytes(file.size)}</span></li>)}</ul> : null}
          <button className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-emerald-700 px-6 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:bg-slate-400" disabled={stage !== "details"} type="submit">{stage === "uploading" ? "Saving tables…" : stage === "interpreting" ? "Understanding data…" : "Profile and interpret files"}</button>
        </form> : null}

        {stage === "review" || stage === "generating" ? <div className="mt-8"><ReviewStep generating={stage === "generating"} onGenerate={generate} semanticPlan={semanticPlan} sources={sources} /></div> : null}
      </div>
    </main>
  );
}

function Field({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return <label className="block text-sm font-semibold text-slate-800"><span>{label}</span><input className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base font-normal text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100" onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} value={value} /></label>;
}

function Progress({ stage }: { stage: WizardStage }) {
  const stages: Array<{ id: WizardStage; label: string }> = [{ id: "details", label: "Upload" }, { id: "interpreting", label: "Understand" }, { id: "review", label: "Review" }, { id: "generating", label: "Generate" }];
  const activeIndex = stage === "uploading" ? 0 : stages.findIndex((item) => item.id === stage);
  return <ol className="mt-10 flex overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Project progress">{stages.map((item, index) => <li className={`flex flex-1 items-center gap-2 px-3 py-3 text-xs font-bold sm:px-5 sm:text-sm ${index <= activeIndex ? "bg-emerald-50 text-emerald-900" : "text-slate-400"}`} key={item.id}><span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${index <= activeIndex ? "bg-emerald-700 text-white" : "bg-slate-100"}`}>{index + 1}</span><span className="hidden sm:inline">{item.label}</span></li>)}</ol>;
}

async function requestJson<T = unknown>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
