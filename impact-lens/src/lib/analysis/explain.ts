import type { SourceProfile } from "@/lib/files/types";
import type { AtomicExpr, MetricDefinition, MetricFilter } from "@/lib/semantic/schema";
import type { DashboardAnalysis } from "@/lib/analysis/types";

function headerFor(sourceId: string, fieldId: string, profiles: SourceProfile[]): string {
  const field = profiles.find((p) => p.sourceId === sourceId)?.fields.find((f) => f.fieldId === fieldId);
  return field?.header ?? fieldId;
}

function fileFor(sourceId: string, profiles: SourceProfile[]): string | null {
  return profiles.find((p) => p.sourceId === sourceId)?.fileName ?? null;
}

function describeFilters(filters: MetricFilter[], profiles: SourceProfile[]): string {
  if (filters.length === 0) return "";
  const parts = filters.map((f) => {
    const header = headerFor(f.ref.sourceId, f.ref.fieldId, profiles);
    return f.op === "equals" ? `“${header}” is “${f.value ?? ""}”` : `“${header}” is filled in`;
  });
  return ` where ${parts.join(" and ")}`;
}

function describeAtomic(expr: AtomicExpr, profiles: SourceProfile[]): string {
  const filters = describeFilters(expr.filters, profiles);
  if (expr.op === "count" && !expr.ref) return `counting the rows${filters}`;
  const header = expr.ref ? `“${headerFor(expr.ref.sourceId, expr.ref.fieldId, profiles)}”` : "the rows";
  const file = expr.ref ? fileFor(expr.ref.sourceId, profiles) : null;
  const inFile = file ? ` in ${file}` : "";
  switch (expr.op) {
    case "count":
      return `counting filled-in values of ${header}${inFile}${filters}`;
    case "distinct_count":
      return `counting the different values of ${header}${inFile}${filters}`;
    case "sum":
      return `adding up ${header}${inFile}${filters}`;
    case "average":
      return `averaging ${header}${inFile}${filters}`;
  }
}

/**
 * Deterministic plain-language explanation of how a metric is computed,
 * derived purely from its validated formula — used whenever a metric
 * doesn't carry an explicit howCalculated string.
 */
export function explainFormula(definition: MetricDefinition, profiles: SourceProfile[]): string {
  const f = definition.formula;
  const sentence =
    f.kind === "atomic"
      ? `Calculated by ${describeAtomic(f.expr, profiles)}.`
      : `Calculated by ${describeAtomic(f.numerator, profiles)}, divided by ${describeAtomic(f.denominator, profiles)}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export interface Insight {
  tone: "good" | "watch" | "problem";
  text: string;
}

const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" });

/**
 * Turns the computed dashboard into 2–4 plain-language, actionable takeaways.
 * Purely deterministic — reads only what was already computed and flagged.
 */
export function buildInsights(data: DashboardAnalysis): Insight[] {
  const insights: Insight[] = [];

  // 1. Reach story from the funnel chart, if there is one.
  if (data.chart?.type === "funnel" && data.chart.points.length >= 2) {
    const points = data.chart.points.filter((p) => p.value !== null) as Array<{ label: string; value: number }>;
    if (points.length >= 2) {
      const first = points[0];
      const last = points[points.length - 1];
      const broken = points.some((p, i) => i > 0 && p.value > points[i - 1].value);
      if (broken) {
        insights.push({
          tone: "problem",
          text: `The funnel numbers don't add up: a later stage reports more people than an earlier one. That usually means a reporting mistake, not real growth — check the flagged figures under “Needs review”.`,
        });
      } else if (last.value > 0 && first.value > 0) {
        const pct = Math.round((last.value / first.value) * 100);
        insights.push({
          tone: "good",
          text: `Of roughly ${compact.format(first.value)} people reached at the top of the funnel, about ${compact.format(last.value)} (${pct}%) made it to the deepest stage of change.`,
        });
      }
    }
  }

  // 2. Data reliability, when a %-unit reliability metric exists.
  const reliability = data.metrics.find((m) => m.definition.unit === "%" && m.result.value !== null);
  if (reliability && reliability.result.value !== null) {
    const v = Math.round(reliability.result.value);
    if (v >= 75) {
      insights.push({ tone: "good", text: `${v}% of the figures were actually measured or calculated — solid ground for decisions.` });
    } else if (v >= 50) {
      insights.push({ tone: "watch", text: `Only ${v}% of the figures were actually measured — the rest are estimates. Treat totals as directional, not exact.` });
    } else {
      insights.push({ tone: "problem", text: `Just ${v}% of the figures were actually measured — most numbers here are estimates or unverified. Ask for source data before relying on them.` });
    }
  }

  // 3. Problem summary from the warnings.
  const critical = data.warnings.filter((w) => w.severity === "critical");
  const warning = data.warnings.filter((w) => w.severity === "warning");
  if (critical.length > 0) {
    insights.push({
      tone: "problem",
      text: `${critical.length} figure${critical.length === 1 ? " is" : "s are"} impossible as reported (e.g. negative counts). Fix these before using this data anywhere.`,
    });
  } else if (warning.length > 0) {
    insights.push({
      tone: "watch",
      text: `${warning.length} figure${warning.length === 1 ? " needs" : "s need"} a closer look — see the “Needs review” tab for each one with its source file.`,
    });
  } else {
    insights.push({ tone: "good", text: "No data-quality issues were found — the reported figures are internally consistent." });
  }

  return insights.slice(0, 4);
}
