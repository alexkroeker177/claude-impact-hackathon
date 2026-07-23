import type { SourceProfile } from "@/lib/files/types";
import type {
  FieldRef,
  MetricDefinition,
  MetricFilter,
  SemanticPlan,
} from "@/lib/semantic/schema";

export interface MetricResult {
  metricId: string;
  value: number | null;
  /** Share of available records that actually contributed, 0..1. */
  coverage: number;
  recordsUsed: number;
  recordsAvailable: number;
  missingRecords: number;
  excludedRecords: number;
  /** Group-by series (empty when no groupBy). */
  series: Array<{ label: string; value: number | null }>;
  evidence: {
    sourceIds: string[];
    fieldRefs: FieldRef[];
    /** Human-readable formula, e.g. "sum(beneficiaries) / count(rows)". */
    formula: string;
    filters: MetricFilter[];
    exampleRows: Array<{ sourceId: string; rowNumber: number }>;
    caveats: string[];
  };
}

export type ChartType = "line" | "bar" | "funnel";

export interface ChartSpec {
  type: ChartType;
  title: string;
  metricId: string;
  points: Array<{ label: string; value: number | null }>;
  /** Textual summary of the chart for accessibility / evidence. */
  summary: string;
}

export type WarningScope = "data" | "project";

export interface AnalysisWarning {
  id: string;
  scope: WarningScope;
  severity: "info" | "warning" | "critical";
  message: string;
  sourceId: string | null;
  fieldRefs: FieldRef[];
}

/** Optional per-enterprise reach-vs-impact comparison (currently mock/demo only). */
export interface ComparisonChartSpec {
  title: string;
  summary: string;
  points: Array<{ label: string; reach: number | null; impact: number | null }>;
}

export interface DashboardAnalysis {
  generatedAt: string;
  understanding: string;
  /** Overall assessment sentence(s) — Claude-written when available, deterministic fallback otherwise. */
  assessment: string;
  /** Claude-written takeaways; null when the narrate step was unavailable (UI falls back to deterministic insights). */
  insights?: Array<{ tone: "good" | "watch" | "problem"; text: string }> | null;
  profiles: SourceProfile[];
  plan: SemanticPlan;
  /** Only metrics accepted by the user AND still valid. */
  metrics: Array<{ definition: MetricDefinition; result: MetricResult }>;
  chart: ChartSpec | null;
  secondaryChart?: ComparisonChartSpec | null;
  warnings: AnalysisWarning[];
}
