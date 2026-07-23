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
  if (plan.orderedFunnel && plan.orderedFunnel.stages.length >= 2) {
    const table = tables.find((t) => t.sourceId === plan.orderedFunnel!.sourceId);
    if (table) {
      const points = plan.orderedFunnel.stages
        .map((stage) => ({ label: stage.label, value: sumParseableField(table, stage.fieldId) }))
        .filter((p): p is { label: string; value: number } => p.value !== null);
      if (points.length >= 2) {
        const first = points[0];
        const last = points[points.length - 1];
        return {
          type: "funnel",
          title: "Impact funnel",
          metricId: results[0]?.definition.id ?? "funnel",
          points,
          summary: `${first.label} reaches ${Math.round(first.value).toLocaleString("en-US")}, narrowing to ${Math.round(last.value).toLocaleString("en-US")} at ${last.label}.`,
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
