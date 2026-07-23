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

export interface DashboardAnalysis {
  generatedAt: string;
  understanding: string;
  /** Deterministic overall assessment sentence(s) computed from results. */
  assessment: string;
  profiles: SourceProfile[];
  plan: SemanticPlan;
  /** Only metrics accepted by the user AND still valid. */
  metrics: Array<{ definition: MetricDefinition; result: MetricResult }>;
  chart: ChartSpec | null;
  warnings: AnalysisWarning[];
}
