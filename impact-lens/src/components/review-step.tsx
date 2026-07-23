"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  FileSpreadsheet,
  GitMerge,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SourceProfile } from "@/lib/files/types";
import type {
  AtomicExpr,
  CoverageStatus,
  FieldRef,
  MetricDefinition,
  SemanticPlan,
} from "@/lib/semantic/schema";

interface ReviewStepProps {
  plan: SemanticPlan;
  profiles: SourceProfile[];
  onGenerate: (
    acceptedMetricIds: string[],
    confirmedJoinId: string | null,
  ) => void | Promise<void>;
  generating?: boolean;
}

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const compactFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

function formatNumber(value: number): string {
  return Math.abs(value) > 99999
    ? compactFormat.format(value)
    : numberFormat.format(value);
}

function formatPercent(x: number): string {
  return Math.round(x * 100) + "%";
}

const DIMENSIONS: Array<{
  key: keyof SemanticPlan["fiveDimensions"];
  label: string;
}> = [
  { key: "what", label: "What" },
  { key: "who", label: "Who" },
  { key: "howMuch", label: "How much" },
  { key: "contribution", label: "Contribution" },
  { key: "risk", label: "Risk" },
];

const STATUS_BADGE: Record<CoverageStatus, string> = {
  identified: "border-transparent bg-emerald-100 text-emerald-800",
  partial: "border-transparent bg-amber-100 text-amber-800",
  not_found: "border-transparent bg-slate-200 text-slate-600",
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  identified: "Identified",
  partial: "Partial",
  not_found: "Not found",
};

const PURPOSE_LABEL: Record<string, string> = {
  survey_responses: "Survey responses",
  financials: "Financials",
  activity_log: "Activity log",
  reference: "Reference",
  aggregate_report: "Aggregate report",
  other: "Other",
};

const FRAMEWORK_LABEL: Record<string, string> = {
  five_dimensions: "Five Dimensions of Impact",
  sdg: "UN SDGs",
  iris_plus: "IRIS+",
  esg: "ESG",
  triple_bottom_line: "Triple Bottom Line",
};

function opLabel(op: AtomicExpr["op"]): string {
  return op === "distinct_count" ? "distinct count" : op;
}

function formatAtomic(
  expr: AtomicExpr,
  resolve: (ref: FieldRef) => string,
): string {
  const target = expr.ref ? resolve(expr.ref) : "rows";
  const base = `${opLabel(expr.op)}(${target})`;
  if (expr.filters.length === 0) return base;
  const filters = expr.filters
    .map((f) =>
      f.op === "equals"
        ? `${resolve(f.ref)} = "${f.value ?? ""}"`
        : `${resolve(f.ref)} is present`,
    )
    .join(" and ");
  return `${base} where ${filters}`;
}

function formatFormula(
  metric: MetricDefinition,
  resolve: (ref: FieldRef) => string,
): string {
  if (metric.formula.kind === "atomic") {
    return formatAtomic(metric.formula.expr, resolve);
  }
  return `${formatAtomic(metric.formula.numerator, resolve)} ÷ ${formatAtomic(
    metric.formula.denominator,
    resolve,
  )}`;
}

export function ReviewStep({
  plan,
  profiles,
  onGenerate,
  generating = false,
}: ReviewStepProps) {
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(plan.proposedMetrics.map((m) => m.id)),
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [joinConfirmed, setJoinConfirmed] = useState(false);

  const fieldLookup = useMemo(() => {
    const map = new Map<string, { header: string; fileName: string }>();
    for (const profile of profiles) {
      for (const field of profile.fields) {
        map.set(`${profile.sourceId}:${field.fieldId}`, {
          header: field.header,
          fileName: profile.fileName,
        });
      }
    }
    return map;
  }, [profiles]);

  const resolveField = (ref: FieldRef): string =>
    fieldLookup.get(`${ref.sourceId}:${ref.fieldId}`)?.header ?? ref.fieldId;

  const resolveFieldWithFile = (ref: FieldRef): string => {
    const hit = fieldLookup.get(`${ref.sourceId}:${ref.fieldId}`);
    return hit ? `${hit.header} (${hit.fileName})` : ref.fieldId;
  };

  const purposeBySource = useMemo(() => {
    const map = new Map<string, string>();
    for (const table of plan.tables) map.set(table.sourceId, table.purpose);
    return map;
  }, [plan.tables]);

  const toggleMetric = (id: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = () => {
    void onGenerate(
      plan.proposedMetrics.filter((m) => accepted.has(m.id)).map((m) => m.id),
      plan.candidateJoin && joinConfirmed ? plan.candidateJoin.id : null,
    );
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-8">
        {/* Understanding */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-emerald-700" />
              What we understood
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-base leading-7 text-slate-700">
              {plan.understanding}
            </p>
            {plan.uncertainties.length > 0 && (
              <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <p className="font-medium">Open questions</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {plan.uncertainties.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sources */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
            Data sources
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {profiles.map((profile) => (
              <Card key={profile.sourceId} size="sm">
                <CardContent className="flex items-start gap-3">
                  <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-emerald-700" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {profile.fileName}
                      {profile.sheetName ? ` · ${profile.sheetName}` : ""}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {formatNumber(profile.rowCount)} rows ·{" "}
                      {profile.fields.length} fields
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-slate-200 text-slate-600"
                  >
                    {PURPOSE_LABEL[
                      purposeBySource.get(profile.sourceId) ?? "other"
                    ] ?? "Other"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Five Dimensions coverage */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
            Five Dimensions of Impact — coverage
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {DIMENSIONS.map(({ key, label }) => {
              const entry = plan.fiveDimensions[key];
              return (
                <Tooltip key={key}>
                  <TooltipTrigger
                    render={<span className="flex" />}
                  >
                    <Card size="sm" className="w-full cursor-help">
                      <CardContent className="flex flex-col items-start gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {label}
                        </span>
                        <Badge className={STATUS_BADGE[entry.status]}>
                          {STATUS_LABEL[entry.status]}
                        </Badge>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent>{entry.rationale}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </section>

        {/* Framework tags */}
        {plan.frameworkTags.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
              Framework alignment
            </h3>
            <div className="flex flex-col gap-2">
              {plan.frameworkTags.map((tag, i) => (
                <Card key={i} size="sm">
                  <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 text-emerald-800"
                    >
                      Candidate alignment
                    </Badge>
                    <span className="font-medium text-slate-900">
                      {FRAMEWORK_LABEL[tag.framework] ?? tag.framework}:{" "}
                      {tag.label}
                      {tag.referenceId ? ` (${tag.referenceId})` : ""}
                    </span>
                    <span className="text-sm text-slate-500">
                      {formatPercent(tag.confidence)} confidence
                    </span>
                    <p className="w-full text-sm text-slate-500">
                      {tag.caveat}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Proposed KPIs */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
            Proposed KPIs — choose what to compute
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {plan.proposedMetrics.map((metric) => {
              const included = accepted.has(metric.id);
              const isExpanded = expanded.has(metric.id);
              const lastRemaining = included && accepted.size <= 1;
              return (
                <Card
                  key={metric.id}
                  className={
                    included ? "ring-emerald-600/40" : "opacity-70"
                  }
                >
                  <CardHeader>
                    <CardTitle>{metric.name}</CardTitle>
                    <CardDescription>{metric.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
                      {formatFormula(metric, resolveField)}
                      {metric.groupBy
                        ? ` · grouped by ${resolveField(metric.groupBy)}`
                        : ""}
                    </p>
                    <div className="flex items-center gap-3 text-sm text-slate-500">
                      <span>
                        Confidence {formatPercent(metric.confidence)}
                      </span>
                      {metric.unit && <span>Unit: {metric.unit}</span>}
                    </div>
                    {(metric.assumptions.length > 0 ||
                      metric.caveats.length > 0) && (
                      <div>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(metric.id)}
                          className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
                        >
                          <ChevronDown
                            className={`size-4 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                          Assumptions & caveats
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-2 text-sm text-slate-600">
                            {metric.assumptions.length > 0 && (
                              <div>
                                <p className="font-medium text-slate-700">
                                  Assumptions
                                </p>
                                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                  {metric.assumptions.map((a, i) => (
                                    <li key={i}>{a}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {metric.caveats.length > 0 && (
                              <div>
                                <p className="font-medium text-slate-700">
                                  Caveats
                                </p>
                                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                  {metric.caveats.map((c, i) => (
                                    <li key={i}>{c}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <Separator />
                    <label
                      className={`flex items-center gap-2 text-sm font-medium ${
                        lastRemaining
                          ? "cursor-not-allowed text-slate-400"
                          : "cursor-pointer text-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={included}
                        disabled={lastRemaining}
                        onChange={() => toggleMetric(metric.id)}
                        className="size-4 accent-emerald-700"
                      />
                      Include in dashboard
                      {lastRemaining && (
                        <span className="font-normal text-slate-400">
                          (at least one KPI required)
                        </span>
                      )}
                    </label>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Join confirmation */}
        {plan.candidateJoin && (
          <Card className="border-l-4 border-l-emerald-600">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitMerge className="size-4 text-emerald-700" />
                Possible link between tables
              </CardTitle>
              <CardDescription>
                {plan.candidateJoin.rationale}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
                {resolveFieldWithFile(plan.candidateJoin.left)} ={" "}
                {resolveFieldWithFile(plan.candidateJoin.right)}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={joinConfirmed}
                  onChange={(e) => setJoinConfirmed(e.target.checked)}
                  className="size-4 accent-emerald-700"
                />
                Confirm this join — records will be matched across tables
              </label>
            </CardContent>
          </Card>
        )}

        {/* Advanced details */}
        <details className="group rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-600 hover:text-slate-900">
            Advanced details — raw interpretation plan
          </summary>
          <pre className="max-h-96 overflow-auto border-t border-slate-200 bg-slate-950 p-4 text-xs leading-5 text-slate-100">
            {JSON.stringify(plan, null, 2)}
          </pre>
        </details>

        {/* CTA */}
        <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-6">
          <p className="text-sm text-slate-500">
            {accepted.size} of {plan.proposedMetrics.length} KPI
            {plan.proposedMetrics.length === 1 ? "" : "s"} selected
          </p>
          <Button
            onClick={handleGenerate}
            disabled={generating || accepted.size === 0}
            className="h-11 rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800"
          >
            {generating && <Spinner className="text-white" />}
            {generating ? "Generating dashboard…" : "Generate dashboard"}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
