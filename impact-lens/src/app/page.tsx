import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-950">
      <section className="mx-auto flex min-h-[70vh] max-w-5xl flex-col justify-center">
        <p className="mb-5 text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">
          Impact intelligence
        </p>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight sm:text-7xl">
          ImpactLens
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
          Turn previously unseen programme spreadsheets into explainable KPIs,
          evidence, and a clear first-pass impact dashboard.
        </p>
        <div className="mt-10">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
            href="/projects/new"
          >
            Create project
          </Link>
        </div>
        <div className="mt-16 grid gap-4 border-t border-slate-200 pt-8 text-sm text-slate-600 sm:grid-cols-3">
          <p>Upload CSV and XLSX files</p>
          <p>Review proposed KPIs</p>
          <p>Trace every result to evidence</p>
        </div>
      </section>
    </main>
  );
}
