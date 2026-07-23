import type { ParsedTable } from "@/lib/files/types";
import type { MetricDefinition, SemanticPlan } from "@/lib/semantic/schema";
import type { ChartSpec, MetricResult } from "@/lib/analysis/types";
import { sumParseableField } from "@/lib/metrics/evaluate";

const WAVE_HINTS = ["baseline", "midline", "endline", "follow-up", "followup", "wave"];

function isOrderedLabel(label: string): boolean {
  const norm = label.trim().toLowerCase();
  if (WAVE_HINTS.some((h) => norm.includes(h))) return true;
  if (/^\d{4}(-\d{2})?(-\d{2})?$/.test(norm)) return true;
  return !Number.isNaN(Date.parse(label));
}

function orderKey(label: string): string {
  const norm = label.trim().toLowerCase();
  const idx = WAVE_HINTS.findIndex((h) => norm.includes(h));
  if (idx >= 0) return `0${idx}`;
  const parsed = Date.parse(label);
  return Number.isNaN(parsed) ? label : String(parsed).padStart(20, "0");
}

/**
 * Deterministic chart selection: funnel > line (ordered periods) > bar (categories) > none.
 * Never uses an LLM — purely derived from the already-validated plan and computed results.
 */
export function selectChart(
  plan: SemanticPlan,
  tables: ParsedTable[],
  results: Array<{ definition: MetricDefinition; result: MetricResult }>,
): ChartSpec | null {
  return selectChartInner(plan, tables, results);
}

/** Short stage name for prose: text before any dash/colon/paren qualifier. */
function shortLabel(label: string): string {
  return label.split(/\s*[—–:(]/)[0].trim() || label;
}

/** Direction-aware funnel sentence — never claims "narrowing" when a later stage grows. */
export function funnelSummary(points: Array<{ label: string; value: number | null }>): string {
  const usable = points.filter((p): p is { label: string; value: number } => p.value !== null);
  if (usable.length < 2) return "Funnel stages compared.";
  const first = usable[0];
  const last = usable[usable.length - 1];
  const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
  const broken = usable.some((p, i) => i > 0 && p.value > usable[i - 1].value);
  if (broken) {
    return `${shortLabel(first.label)} starts at ${fmt(first.value)} people, but later stages grow instead of shrinking (${shortLabel(last.label)}: ${fmt(last.value)}) — a sign of reporting errors, flagged under “Needs review”.`;
  }
  return `Of ${fmt(first.value)} people at ${shortLabel(first.label)}, ${fmt(last.value)} reach ${shortLabel(last.label)}.`;
}

function selectChartInner(
  plan: SemanticPlan,
  tables: ParsedTable[],
  results: Array<{ definition: MetricDefinition; result: MetricResult }>,
): ChartSpec | null {
  if (plan.orderedFunnel && plan.orderedFunnel.stages.length >= 2) {
    const table = tables.find((t) => t.sourceId === plan.orderedFunnel!.sourceId);
    if (table) {
      const points = plan.orderedFunnel.stages
        .map((stage) => ({ label: stage.label, value: sumParseableField(table, stage.fieldId) }))
        .filter((p): p is { label: string; value: number } => p.value !== null);
      if (points.length >= 2) {
        return {
          type: "funnel",
          title: "Impact funnel",
          metricId: results[0]?.definition.id ?? "funnel",
          points,
          summary: funnelSummary(points),
        };
      }
    }
  }

  for (const { definition, result } of results) {
    if (result.series.length < 2) continue;
    if (result.series.every((p) => isOrderedLabel(p.label))) {
      const points = [...result.series].sort((a, b) => orderKey(a.label).localeCompare(orderKey(b.label)));
      return {
        type: "line",
        title: definition.name,
        metricId: definition.id,
        points,
        summary: `${definition.name} tracked across ${points.length} periods.`,
      };
    }
  }

  for (const { definition, result } of results) {
    if (result.series.length === 0) continue;
    const points = [...result.series]
      .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
      .slice(0, 12);
    return {
      type: "bar",
      title: definition.name,
      metricId: definition.id,
      points,
      summary: `${definition.name} broken down across ${points.length} categories.`,
    };
  }

  return null;
}
