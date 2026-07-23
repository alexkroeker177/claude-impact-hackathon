"use client";

import { useMemo, useState } from "react";

type ReviewSource = {
  id: string;
  displayName: string;
  profile: unknown | null;
  parseWarnings: unknown[];
};

type ReviewStepProps = {
  semanticPlan: unknown;
  sources: ReviewSource[];
  onGenerate: (acceptedMetricIds: string[], confirmedJoinId?: string) => Promise<void>;
  generating: boolean;
};

export function ReviewStep({ semanticPlan, sources, onGenerate, generating }: ReviewStepProps) {
  const plan = asRecord(semanticPlan);
  const metrics = useMemo(() => proposedMetrics(plan, sources), [plan, sources]);
  const [acceptedIds, setAcceptedIds] = useState(() => metrics.map((metric) => metric.id));

  function toggleMetric(metricId: string) {
    setAcceptedIds((current) => current.includes(metricId) ? current.filter((id) => id !== metricId) : [...current, metricId]);
  }

  return (
    <section className="space-y-7" aria-label="Review proposed analysis">
      <div className="rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">What ImpactLens understood</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">Review the evidence plan before it calculates.</h2>
        <p className="mt-4 max-w-3xl leading-7 text-slate-300">{summaryFor(plan)}</p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Sources</p><h3 className="mt-2 text-2xl font-semibold tracking-tight">Files and tables</h3></div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">{sources.length} parsed {sources.length === 1 ? "table" : "tables"}</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {sources.map((source) => <SourceSummary key={source.id} source={source} />)}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Impact Management Project</p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight">Five Dimensions coverage</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">Evidence coverage, not a certification or compliance assessment.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-5">
          {fiveDimensions(plan).map((dimension) => (
            <article className="rounded-2xl border border-slate-200 p-4" key={dimension.label}>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${dimension.status === "identified" ? "bg-emerald-600" : dimension.status === "partial" ? "bg-amber-500" : "bg-slate-300"}`} />
              <h4 className="mt-3 font-semibold">{dimension.label}</h4>
              <p className="mt-2 text-xs leading-5 text-slate-500">{dimension.rationale}</p>
            </article>
          ))}
        </div>
      </section>

      {frameworkTags(plan).length > 0 ? (
        <section className="rounded-3xl border border-dashed border-emerald-300 bg-emerald-50/50 p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-800">Candidate alignment</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">{frameworkTags(plan).map((tag) => <FrameworkTag key={`${tag.framework}-${tag.label}`} tag={tag} />)}</div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Proposed KPIs</p><h3 className="mt-2 text-2xl font-semibold tracking-tight">Keep only metrics you want calculated</h3><p className="mt-2 text-sm leading-6 text-slate-500">Each result will stay tied to its source rows and formula. You can remove a KPI without asking the model again.</p></div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {metrics.map((metric) => (
            <label className={`cursor-pointer rounded-2xl border p-5 transition ${acceptedIds.includes(metric.id) ? "border-emerald-400 bg-emerald-50/50" : "border-slate-200 bg-slate-50 opacity-70"}`} key={metric.id}>
              <div className="flex gap-3"><input aria-label={`Include ${metric.label}`} checked={acceptedIds.includes(metric.id)} className="mt-1 h-4 w-4 accent-emerald-700" onChange={() => toggleMetric(metric.id)} type="checkbox" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-slate-950">{metric.label}</h4><span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-600">{Math.round(metric.confidence * 100)}% confidence</span><span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-600">~{Math.round(metric.coverage * 100)}% field coverage</span></div><p className="mt-2 text-sm leading-6 text-slate-600">{metric.description}</p><p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.formula}</p><p className="mt-3 text-xs leading-5 text-slate-500"><strong className="text-slate-700">Source:</strong> {metric.sources.join(", ")} · <strong className="text-slate-700">Fields:</strong> {metric.fields.join(", ")}</p><p className="mt-2 text-xs leading-5 text-slate-500"><strong className="text-slate-700">Why proposed:</strong> {metric.rationale}</p><p className="mt-2 text-xs leading-5 text-slate-500"><strong className="text-slate-700">Exclusions:</strong> {metric.exclusions}</p></div></div>
            </label>
          ))}
        </div>
        {metrics.length === 0 ? <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">No safely calculable KPIs survived validation.</p><p className="mt-2">The data needs a usable numeric measure, countable identifier, categorical grouping, or ordered time/stage field.</p>{uncertainties(plan).length ? <ul className="mt-3 list-disc space-y-1 pl-5">{uncertainties(plan).slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul> : null}</div> : null}

        {plan.candidateJoin ? <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-sm font-semibold text-amber-950">Cross-file relationship held for review</p><p className="mt-1 text-sm leading-6 text-amber-900">ImpactLens will not calculate cross-file KPIs until the proposed exact relationship passes a deterministic key audit. Tables remain analysed independently in this demo.</p></div> : null}

        <details className="mt-6 rounded-2xl bg-slate-50 p-5"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Advanced interpretation details</summary><pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{JSON.stringify(semanticPlan, null, 2)}</pre></details>

        <button className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-emerald-700 px-6 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300" disabled={generating} onClick={() => void onGenerate(acceptedIds)} type="button">{generating ? "Calculating evidence…" : acceptedIds.length ? "Generate dashboard" : "Generate limited dashboard"}</button>
      </section>
    </section>
  );
}

function SourceSummary({ source }: { source: ReviewSource }) {
  const profile = asRecord(source.profile);
  const fieldCount = Array.isArray(profile.fields) ? profile.fields.length : 0;
  const rowCount = typeof profile.rowCount === "number" ? profile.rowCount : 0;
  return <article className="rounded-2xl bg-slate-50 p-4"><h4 className="font-semibold text-slate-900">{source.displayName}</h4><p className="mt-2 text-sm text-slate-600">{rowCount.toLocaleString()} rows · {fieldCount} fields</p>{source.parseWarnings.length > 0 ? <p className="mt-2 text-xs font-semibold text-amber-800">{source.parseWarnings.length} parse warning{source.parseWarnings.length === 1 ? "" : "s"}: {String(source.parseWarnings[0])}</p> : null}</article>;
}

function FrameworkTag({ tag }: { tag: { framework: string; label: string; rationale: string; caveat: string } }) {
  return <article className="rounded-2xl border border-emerald-200 bg-white/70 p-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">Candidate alignment</p><h4 className="mt-2 font-semibold text-emerald-950">{tag.label}</h4><p className="mt-2 text-sm leading-6 text-emerald-950/75">{tag.rationale}</p><p className="mt-2 text-xs font-semibold text-emerald-900">{tag.caveat}</p></article>;
}

function proposedMetrics(plan: Record<string, unknown>, sources: ReviewSource[]) {
  const values = arrayAt(plan, "proposedMetrics", "metrics");
  const sourcesByProfileId = new Map(sources.map((source) => [firstString(asRecord(source.profile).sourceId) || source.id, source]));
  return values.map((value, index) => {
    const metric = asRecord(value);
    const definition = asRecord(metric.definition);
    const formula = metric.formula ?? definition.formula;
    const refs = referencedFields(formula, metric.groupBy ?? definition.groupBy);
    const id = firstString(metric.metricId, metric.id, definition.metricId, definition.id) || `metric-${index + 1}`;
    return {
      id,
      label: firstString(metric.label, metric.name, definition.label, definition.name) || `Proposed KPI ${index + 1}`,
      description: firstString(metric.description, metric.rationale, definition.description, definition.rationale) || "Calculated only from the uploaded data.",
      formula: formatFormula(formula),
      rationale: firstString(metric.rationale, definition.rationale) || "The referenced fields support this constrained calculation.",
      confidence: numberValue(metric.confidence ?? definition.confidence),
      coverage: estimatedCoverage(refs, sourcesByProfileId),
      sources: [...new Set(refs.map((field) => sourcesByProfileId.get(field.sourceId)?.displayName || field.sourceId))],
      fields: [...new Set(refs.map((field) => fieldHeader(field, sourcesByProfileId)))],
      exclusions: formatExclusions(metric.filters ?? definition.filters),
    };
  }).slice(0, 4);
}

function referencedFields(formulaValue: unknown, groupByValue: unknown) {
  const formula = asRecord(formulaValue);
  const candidates = formula.kind === "ratio"
    ? [asRecord(asRecord(formula.numerator).field), asRecord(asRecord(formula.denominator).field)]
    : [asRecord(formula.field)];
  if (groupByValue) candidates.push(asRecord(groupByValue));
  return candidates.map((field) => ({ sourceId: firstString(field.sourceId) || "Unknown source", fieldId: firstString(field.fieldId) || "Unknown field" }));
}

function estimatedCoverage(refs: Array<{ sourceId: string; fieldId: string }>, sourceMap: Map<string, ReviewSource>) {
  const values = refs.map((ref) => {
    const fields = arrayAt(asRecord(sourceMap.get(ref.sourceId)?.profile), "fields").map(asRecord);
    const field = fields.find((candidate) => firstString(candidate.fieldId) === ref.fieldId);
    return 1 - numberValue(field?.nullRate);
  });
  return values.length ? Math.max(0, Math.min(...values)) : 0;
}

function fieldHeader(ref: { sourceId: string; fieldId: string }, sourceMap: Map<string, ReviewSource>) {
  const fields = arrayAt(asRecord(sourceMap.get(ref.sourceId)?.profile), "fields").map(asRecord);
  const field = fields.find((candidate) => firstString(candidate.fieldId) === ref.fieldId);
  return firstString(field?.header, ref.fieldId) || ref.fieldId;
}

function formatExclusions(value: unknown) {
  if (!Array.isArray(value) || !value.length) return "Missing or invalid values are excluded from numeric calculations.";
  return value.map((candidate) => {
    const filter = asRecord(candidate);
    const field = asRecord(filter.field);
    return `${firstString(field.fieldId) || "field"} ${firstString(filter.operator) || "filter"}${firstString(filter.value) ? ` ${firstString(filter.value)}` : ""}`;
  }).join("; ");
}

function uncertainties(plan: Record<string, unknown>) {
  return arrayAt(plan, "uncertainties").filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function fiveDimensions(plan: Record<string, unknown>) {
  const coverage = asRecord(plan.fiveDimensions ?? plan.fiveDimensionsCoverage);
  const fromArray = Array.isArray(plan.fiveDimensions) ? plan.fiveDimensions : [];
  const dimensionNames = ["What", "Who", "How much", "Contribution", "Risk"];
  return dimensionNames.map((label) => {
    const arrayValue = fromArray.map(asRecord).find((value) => firstString(value.dimension, value.label)?.toLowerCase() === label.toLowerCase());
    const coverageKey = label === "How much" ? "howMuch" : label.toLowerCase();
    const value = arrayValue ?? asRecord(coverage[coverageKey] ?? coverage[label]);
    const status = firstString(value.status) || "not_found";
    return { label, status: status === "identified" || status === "partial" ? status : "not_found", rationale: firstString(value.rationale, value.evidence) || "No direct evidence identified." };
  });
}

function frameworkTags(plan: Record<string, unknown>) {
  return arrayAt(plan, "frameworkTags", "candidateFrameworks").map(asRecord).map((tag) => ({ framework: firstString(tag.framework) || "framework", label: firstString(tag.label) || "Candidate alignment", rationale: firstString(tag.rationale) || "Candidate interpretation based on available context.", caveat: firstString(tag.caveat) || "Not a standards compliance finding." }));
}

function summaryFor(plan: Record<string, unknown>) {
  return firstString(plan.summary, plan.interpretation, plan.rationale) || "The proposed KPIs and coverage below are constrained to fields found in your uploaded tables.";
}

function arrayAt(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [] as unknown[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function formatFormula(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  const formula = asRecord(value);
  if (formula.kind === "atomic") return formatAtomicFormula(formula);
  if (formula.kind === "ratio") {
    return `${formatAtomicFormula(asRecord(formula.numerator))} / ${formatAtomicFormula(asRecord(formula.denominator))}`;
  }
  return "Evidence-backed calculation";
}

function formatAtomicFormula(formula: Record<string, unknown>): string {
  const field = asRecord(formula.field);
  const operation = firstString(formula.operation) || "calculate";
  const sourceId = firstString(field.sourceId);
  const fieldId = firstString(field.fieldId) || "field";
  return `${operation}(${sourceId ? `${sourceId}.` : ""}${fieldId})`;
}
