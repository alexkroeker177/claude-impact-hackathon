"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  sourceCount: number;
  synthetic: boolean;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") {
    return <Badge className="border-transparent bg-emerald-100 text-emerald-800">Ready</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  return (
    <Badge className="flex items-center gap-1 border-transparent bg-amber-100 text-amber-800">
      <Spinner className="size-3" />
      {status}
    </Badge>
  );
}

export function RecentProjects() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((json) => setProjects(json.projects ?? []))
      .catch(() => setProjects([]));
  }, []);

  if (projects === null) return null;
  if (projects.length === 0) return null;

  return (
    <section className="mx-auto mt-16 max-w-5xl border-t border-slate-200 px-6 pt-10 pb-16">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
        Recent projects
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`}>
            <Card className="h-full transition hover:ring-emerald-600/40">
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <FolderKanban className="size-4 shrink-0 text-emerald-700" />
                  <span className="truncate font-medium text-slate-900">{project.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={project.status} />
                  {project.synthetic && <Badge variant="outline">Synthetic</Badge>}
                </div>
                <p className="text-xs text-slate-400">
                  {project.sourceCount} file{project.sourceCount === 1 ? "" : "s"} ·{" "}
                  {new Date(project.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
