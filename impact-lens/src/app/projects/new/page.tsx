import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProjectWizard } from "@/components/project-wizard";

export default function NewProjectPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-950">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">
          New project
        </p>
        <h1 className="mb-8 text-3xl font-semibold tracking-tight">
          Turn your data into an explainable impact dashboard
        </h1>
        <ProjectWizard />
      </div>
    </main>
  );
}
