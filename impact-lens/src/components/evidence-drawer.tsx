"use client";

import type { DashboardMetric } from "@/types/dashboard";

type EvidenceDrawerProps = {
  metric: DashboardMetric | null;
  onClose: () => void;
};

export function EvidenceDrawer({ metric, onClose }: EvidenceDrawerProps) {
  if (!metric) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-sm" onMouseDown={onClose}>
      <aside
        aria-label={`${metric.label} evidence`}
        aria-modal="true"
        className="h-full w-full max-w-xl overflow-y-auto bg-[#fbfaf6] p-6 shadow-2xl sm:p-9"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Evidence trail</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{metric.label}</h2>
            <p className="mt-2 text-sm text-slate-600">
              {metric.recordsUsed} of {metric.recordsAvailable} records used · {Math.round(metric.coverage * 100)}% coverage
            </p>
          </div>
          <button
            aria-label="Close evidence"
            className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-white"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <dl className="mt-7 space-y-6 text-sm">
          <EvidenceSection label="Source">
            {metric.evidence.sources.map((source) => <p key={source}>{source}</p>)}
          </EvidenceSection>
          <EvidenceSection label="Fields">
            <p>{metric.evidence.fields.join(", ")}</p>
          </EvidenceSection>
          <EvidenceSection label="Formula">
            <p className="rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs leading-5 text-slate-100">{metric.evidence.formula}</p>
          </EvidenceSection>
          <EvidenceSection label="Filters">
            {metric.evidence.filters.map((filter) => <p key={filter}>{filter}</p>)}
          </EvidenceSection>
          <EvidenceSection label="Record accounting">
            <div className="grid grid-cols-3 gap-3">
              <EvidenceCount label="Missing" value={metric.missingRecords} />
              <EvidenceCount label="Excluded" value={metric.excludedRecords} />
              <EvidenceCount label="Confidence" value={metric.confidence} />
            </div>
          </EvidenceSection>
          <EvidenceSection label="Example source rows">
            <ul className="space-y-1">
              {metric.evidence.exampleRows.map((row) => <li key={`${row.sourceId}-${row.rowNumber}`}>{row.sourceId} · Row {row.rowNumber}</li>)}
            </ul>
          </EvidenceSection>
          <EvidenceSection label="Assumptions">
            {metric.evidence.assumptions.length ? <ul className="space-y-2">{metric.evidence.assumptions.map((assumption) => <li className="flex gap-2" key={assumption}><span aria-hidden="true">—</span>{assumption}</li>)}</ul> : <p>No additional assumptions recorded.</p>}
          </EvidenceSection>
          <EvidenceSection label="Caveats">
            <ul className="space-y-2">
              {metric.evidence.caveats.map((caveat) => (
                <li className="flex gap-2" key={caveat}><span aria-hidden="true">—</span>{caveat}</li>
              ))}
            </ul>
          </EvidenceSection>
        </dl>
      </aside>
    </div>
  );
}

function EvidenceSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className="space-y-2 leading-6 text-slate-800">{children}</dd>
    </div>
  );
}

function EvidenceCount({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-lg font-semibold capitalize text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}
