"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dashboard } from "@/components/dashboard";
import { ReviewStep } from "@/components/review-step";
import type { SourceProfile } from "@/lib/files/types";
import type { SemanticPlan } from "@/lib/semantic/schema";
import type { DashboardAnalysis } from "@/lib/analysis/types";

interface ProjectPayload {
  project: {
    id: string;
    name: string;
    goal: string;
    attention: string | null;
    status: string;
    createdAt: string;
    synthetic: boolean;
    error: string | null;
  };
  profiles: SourceProfile[];
  plan: SemanticPlan | null;
  dashboard: DashboardAnalysis | null;
}

export function ProjectLoader({ id }: { id: string }) {
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load project.");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount/id change, not a render-loop setState
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleGenerate = async (acceptedMetricIds: string[], confirmedJoinId: string | null) => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptedMetricIds, confirmedJoinId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Generation failed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load project</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        All projects
      </Link>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data.dashboard ? (
        <Dashboard data={data.dashboard} project={data.project} />
      ) : data.plan ? (
        <ReviewStep
          plan={data.plan}
          profiles={data.profiles}
          onGenerate={handleGenerate}
          generating={generating}
        />
      ) : (
        <Alert>
          <AlertTitle>Still processing</AlertTitle>
          <AlertDescription>
            This project has not finished interpretation yet (status: {data.project.status}
            {data.project.error ? ` — ${data.project.error}` : ""}).
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
