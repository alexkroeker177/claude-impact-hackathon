"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileSpreadsheet, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ReviewStep } from "@/components/review-step";
import type { SourceProfile } from "@/lib/files/types";
import type { SemanticPlan } from "@/lib/semantic/schema";

type Step = "describe" | "analysing" | "review";

interface StageState {
  uploading: boolean;
  uploaded: boolean;
  interpreting: boolean;
  profiles: SourceProfile[];
  warnings: string[];
  error: string | null;
}

const numberFormat = new Intl.NumberFormat("en-US");

export function ProjectWizard() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("describe");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [attention, setAttention] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [stage, setStage] = useState<StageState>({
    uploading: false,
    uploaded: false,
    interpreting: false,
    profiles: [],
    warnings: [],
    error: null,
  });
  const [plan, setPlan] = useState<SemanticPlan | null>(null);
  const [generating, setGenerating] = useState(false);

  const combinedBytes = files.reduce((sum, f) => sum + f.size, 0);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter((f) => /\.(csv|xlsx)$/i.test(f.name));
    setFiles((prev) => [...prev, ...valid]);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const runInterpret = useCallback(async (id: string) => {
    setStage((s) => ({ ...s, interpreting: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${id}/interpret`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Interpretation failed.");
      setPlan(json.plan as SemanticPlan);
      setStep("review");
    } catch (err) {
      setStage((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Interpretation failed.",
      }));
    } finally {
      setStage((s) => ({ ...s, interpreting: false }));
    }
  }, []);

  const handleUpload = async () => {
    if (!name.trim() || !goal.trim() || files.length === 0) return;
    setStep("analysing");
    setStage({ uploading: true, uploaded: false, interpreting: false, profiles: [], warnings: [], error: null });

    const form = new FormData();
    form.set("name", name.trim());
    form.set("goal", goal.trim());
    if (attention.trim()) form.set("attention", attention.trim());
    for (const file of files) form.append("files", file);

    try {
      const res = await fetch("/api/projects", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed.");
      setProjectId(json.projectId);
      setStage((s) => ({
        ...s,
        uploading: false,
        uploaded: true,
        profiles: json.profiles,
        warnings: json.warnings ?? [],
      }));
      await runInterpret(json.projectId);
    } catch (err) {
      setStage((s) => ({
        ...s,
        uploading: false,
        error: err instanceof Error ? err.message : "Upload failed.",
      }));
    }
  };

  const handleGenerate = async (acceptedMetricIds: string[], confirmedJoinId: string | null) => {
    if (!projectId) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptedMetricIds, confirmedJoinId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Generation failed.");
      router.push(`/projects/${projectId}`);
    } catch (err) {
      setStage((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Generation failed.",
      }));
      setGenerating(false);
    }
  };

  if (step === "review" && plan) {
    return (
      <ReviewStep
        plan={plan}
        profiles={stage.profiles}
        onGenerate={handleGenerate}
        generating={generating}
      />
    );
  }

  if (step === "analysing") {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(stage.uploading || stage.interpreting) && <Spinner />}
              {stage.uploading
                ? "Uploading and profiling files…"
                : stage.interpreting
                  ? "Claude is interpreting the schema…"
                  : stage.error
                    ? "Something went wrong"
                    : "Ready"}
            </CardTitle>
            <CardDescription>
              {stage.interpreting &&
                "This step reads column headers, sample values and fill rates only — never raw uploads — and can take up to 90 seconds."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {stage.profiles.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {stage.profiles.map((p) => (
                  <div
                    key={p.sourceId}
                    className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700"
                  >
                    <FileSpreadsheet className="size-4 shrink-0 text-emerald-700" />
                    <span className="truncate">
                      {p.fileName}
                      {p.sheetName ? ` · ${p.sheetName}` : ""}
                    </span>
                    <span className="ml-auto shrink-0 text-slate-400">
                      {numberFormat.format(p.rowCount)} rows · {p.fields.length} fields
                    </span>
                  </div>
                ))}
              </div>
            )}
            {stage.warnings.length > 0 && (
              <Alert>
                <AlertTitle>Some files had issues</AlertTitle>
                <AlertDescription>{stage.warnings.join(" ")}</AlertDescription>
              </Alert>
            )}
            {stage.error && (
              <Alert variant="destructive">
                <AlertTitle>Interpretation failed</AlertTitle>
                <AlertDescription>{stage.error}</AlertDescription>
              </Alert>
            )}
            {stage.error && projectId && (
              <Button
                onClick={() => runInterpret(projectId)}
                className="w-fit rounded-full bg-emerald-700 px-5 text-white hover:bg-emerald-800"
              >
                Retry interpretation
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Describe the programme</CardTitle>
          <CardDescription>
            A short goal helps Claude propose KPIs that actually match what you care about.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Youth employment programme"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-goal">What is this programme trying to achieve?</Label>
            <Textarea
              id="project-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Move participants from unemployment into stable income within a year."
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-attention">Anything we should pay special attention to? (optional)</Label>
            <Textarea
              id="project-attention"
              value={attention}
              onChange={(e) => setAttention(e.target.value)}
              placeholder="e.g. We suspect dropout is undercounted in the midline wave."
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload data</CardTitle>
          <CardDescription>Any number of CSV or XLSX files, up to 10 MB combined.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragOver ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <CloudUpload className="size-8 text-emerald-700" />
            <p className="text-sm font-medium text-slate-700">
              Drop files here or click to browse
            </p>
            <p className="text-xs text-slate-400">.csv or .xlsx</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="flex flex-col gap-2">
              {files.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm"
                >
                  <FileSpreadsheet className="size-4 shrink-0 text-emerald-700" />
                  <span className="truncate text-slate-700">{file.name}</span>
                  <span className="ml-auto shrink-0 text-slate-400">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                    className="shrink-0 text-slate-400 hover:text-slate-700"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <p className="text-xs text-slate-400">
                {(combinedBytes / (1024 * 1024)).toFixed(2)} MB combined of 10 MB limit
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {stage.error && (
        <Alert variant="destructive">
          <AlertTitle>Could not start analysis</AlertTitle>
          <AlertDescription>{stage.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleUpload}
          disabled={!name.trim() || !goal.trim() || files.length === 0}
          className="h-11 rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800"
        >
          Analyse data
        </Button>
      </div>
    </div>
  );
}
