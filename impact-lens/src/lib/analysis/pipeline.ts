import { parseTabularFile } from "@/lib/files/parse";
import { profileTable } from "@/lib/files/profile";
import type { FileInput, ParsedTable, SourceProfile } from "@/lib/files/types";
import type { FieldRef, MetricDefinition, SemanticPlan } from "@/lib/semantic/schema";
import { evaluateMetric } from "@/lib/metrics/evaluate";
import { toMetricResult, type LlmComputeResult } from "@/lib/analysis/llm-compute";
import { auditExactJoin } from "@/lib/analysis/joins";
import { buildWarnings } from "@/lib/analysis/warnings";
import { funnelSummary, selectChart } from "@/lib/analysis/charts";
import type { AnalysisWarning, DashboardAnalysis } from "@/lib/analysis/types";

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ROWS = 25_000;

export interface RunAnalysisInput {
  context: { projectName: string; goal: string; attention: string | null };
  files: FileInput[];
  interpret: (args: {
    projectName: string;
    goal: string;
    attention: string | null;
    profiles: SourceProfile[];
  }) => Promise<SemanticPlan>;
  /** LLM metric computation (normalizes messy cells, returns per-row receipts). Falls back to deterministic evaluation per metric. */
  compute?: (args: {
    goal: string;
    metrics: MetricDefinition[];
    tables: ParsedTable[];
    funnel: SemanticPlan["orderedFunnel"];
  }) => Promise<LlmComputeResult>;
  /** LLM narrative (assessment + insights). Falls back to the deterministic assessment sentence. */
  narrate?: (args: {
    projectName: string;
    goal: string;
    understanding: string;
    metrics: DashboardAnalysis["metrics"];
    chart: DashboardAnalysis["chart"];
    warnings: AnalysisWarning[];
    plan: SemanticPlan;
  }) => Promise<{ assessment: string; insights: Array<{ tone: "good" | "watch" | "problem"; text: string }> }>;
  acceptedMetricIds?: string[] | null;
  confirmedJoinId?: string | null;
  precomputed?: { tables: ParsedTable[]; profiles: SourceProfile[] } | null;
}

/**
 * Pure orchestration: parse+profile -> one interpret call -> evaluate accepted
 * metrics -> pick one chart -> collect warnings. No file-count limit; only
 * combined bytes/rows are capped. Never calls Claude a second time.
 */
export async function runAnalysis(input: RunAnalysisInput): Promise<DashboardAnalysis> {
  let tables: ParsedTable[];
  let profiles: SourceProfile[];

  if (input.precomputed) {
    tables = input.precomputed.tables;
    profiles = input.precomputed.profiles;
  } else {
    const totalBytes = input.files.reduce((sum, f) => sum + f.bytes.byteLength, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`Combined upload size ${totalBytes} bytes exceeds the 10 MB limit.`);
    }
    tables = input.files.flatMap((file) => parseTabularFile(file));
    const totalRows = tables.reduce((sum, t) => sum + t.rows.length, 0);
    if (totalRows > MAX_TOTAL_ROWS) {
      throw new Error(`Total parsed rows (${totalRows}) exceed the ${MAX_TOTAL_ROWS} row limit.`);
    }
    profiles = tables.map((table) => profileTable(table));
  }

  const plan = await input.interpret({
    projectName: input.context.projectName,
    goal: input.context.goal,
    attention: input.context.attention,
    profiles,
  });

  const acceptedIds = input.acceptedMetricIds ?? plan.proposedMetrics.map((m) => m.id);
  const acceptedSet = new Set(acceptedIds);

  let joinAudit: { eligible: boolean; reasons: string[] } | null = null;
  let confirmedJoin: { left: FieldRef; right: FieldRef } | null = null;
  if (plan.candidateJoin) {
    joinAudit = auditExactJoin(plan.candidateJoin, tables);
    if (input.confirmedJoinId === plan.candidateJoin.id && joinAudit.eligible) {
      confirmedJoin = { left: plan.candidateJoin.left, right: plan.candidateJoin.right };
    }
  }

  const acceptedDefinitions = plan.proposedMetrics.filter((m) => acceptedSet.has(m.id));
  const evalWarnings: string[] = [];

  // LLM compute pass (Opus normalizes cells + returns per-row receipts); per-metric deterministic fallback.
  let llmComputed: LlmComputeResult | null = null;
  if (input.compute && acceptedDefinitions.length > 0) {
    try {
      llmComputed = await input.compute({
        goal: input.context.goal,
        metrics: acceptedDefinitions,
        tables,
        funnel: plan.orderedFunnel,
      });
    } catch (err) {
      evalWarnings.push(
        `AI computation was unavailable (${err instanceof Error ? err.message : String(err)}) — figures below use the deterministic fallback.`,
      );
    }
  }

  const metrics: DashboardAnalysis["metrics"] = [];
  for (const definition of acceptedDefinitions) {
    const computed = llmComputed?.metrics.find((m) => m.metricId === definition.id);
    if (computed) {
      metrics.push({ definition, result: toMetricResult(computed, definition, tables) });
      continue;
    }
    try {
      const result = evaluateMetric(definition, tables, confirmedJoin);
      metrics.push({ definition, result });
    } catch (err) {
      evalWarnings.push(
        `Could not compute "${definition.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let chart = selectChart(plan, tables, metrics);
  if (chart?.type === "funnel" && llmComputed?.funnelStages && llmComputed.funnelStages.length >= 2) {
    const points = llmComputed.funnelStages.map((s) => ({ label: s.label, value: s.value }));
    chart = {
      ...chart,
      points,
      summary: `${funnelSummary(points)} Stage totals were normalized cell-by-cell by AI review.`,
    };
  }
  const warnings: AnalysisWarning[] = buildWarnings({ profiles, tables, plan, results: metrics, joinAudit });
  evalWarnings.forEach((message, i) =>
    warnings.push({ id: `we${i + 1}`, scope: "project", severity: "warning", message, sourceId: null, fieldRefs: [] }),
  );

  const meanCoverage = metrics.length
    ? metrics.reduce((s, m) => s + m.result.coverage, 0) / metrics.length
    : 0;
  const flagged = warnings.filter((w) => w.severity !== "info").length;
  const coverageSentence =
    meanCoverage >= 0.95
      ? "using nearly all of the data"
      : `using ${Math.round(meanCoverage * 100)}% of the data (the rest was empty or unreadable)`;
  let assessment = `We computed ${metrics.length} key figure${metrics.length === 1 ? "" : "s"} from your files, ${coverageSentence}.${
    flagged === 0
      ? " No data-quality issues were found."
      : ` ${flagged} thing${flagged === 1 ? "" : "s"} need${flagged === 1 ? "s" : ""} a closer look — see “Needs review”.`
  }`;

  // LLM narrative pass — Claude-written assessment + insights, deterministic sentence as fallback.
  let insights: DashboardAnalysis["insights"] = null;
  if (input.narrate && metrics.length > 0) {
    try {
      const narrative = await input.narrate({
        projectName: input.context.projectName,
        goal: input.context.goal,
        understanding: plan.understanding,
        metrics,
        chart,
        warnings,
        plan,
      });
      assessment = narrative.assessment;
      insights = narrative.insights;
    } catch (err) {
      warnings.push({
        id: "wn1",
        scope: "project",
        severity: "info",
        message: `AI narrative was unavailable (${err instanceof Error ? err.message : String(err)}) — showing the standard summary instead.`,
        sourceId: null,
        fieldRefs: [],
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    understanding: plan.understanding,
    assessment,
    insights,
    profiles,
    plan,
    metrics,
    chart,
    warnings,
  };
}
