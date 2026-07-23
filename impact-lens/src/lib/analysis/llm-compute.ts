import { z } from "zod";

import { runClaudeStructured } from "@/lib/claude/run";
import type { ParsedTable } from "@/lib/files/types";
import type { FieldRef, MetricDefinition, SemanticPlan } from "@/lib/semantic/schema";
import type { MetricResult } from "@/lib/analysis/types";

/* ------------------------------------------------------------------ */
/* Output contract                                                     */
/* ------------------------------------------------------------------ */

const computedRowSchema = z.object({
  sourceId: z.string(),
  rowNumber: z.number(),
  normalizedValue: z.number(),
});

const excludedRowSchema = z.object({
  sourceId: z.string(),
  rowNumber: z.number(),
  reason: z.string(),
});

const computedMetricSchema = z.object({
  metricId: z.string(),
  value: z.number().nullable(),
  explanation: z.string(),
  usedRows: z.array(computedRowSchema),
  excludedRows: z.array(excludedRowSchema),
  series: z.array(z.object({ label: z.string(), value: z.number().nullable() })),
  caveats: z.array(z.string()),
});

const computeResultSchema = z.object({
  metrics: z.array(computedMetricSchema),
  funnelStages: z
    .array(z.object({ fieldId: z.string(), label: z.string(), value: z.number().nullable() }))
    .nullable(),
});

export type LlmComputeResult = z.infer<typeof computeResultSchema>;
export type LlmComputedMetric = z.infer<typeof computedMetricSchema>;

const COMPUTE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["metrics", "funnelStages"],
  properties: {
    metrics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metricId", "value", "explanation", "usedRows", "excludedRows", "series", "caveats"],
        properties: {
          metricId: { type: "string" },
          value: { type: ["number", "null"] },
          explanation: {
            type: "string",
            description:
              "1-2 plain-language sentences a non-analyst can read: what was added up / averaged, what was cleaned, what the unit means.",
          },
          usedRows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceId", "rowNumber", "normalizedValue"],
              properties: {
                sourceId: { type: "string" },
                rowNumber: { type: "number" },
                normalizedValue: { type: "number" },
              },
            },
          },
          excludedRows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceId", "rowNumber", "reason"],
              properties: {
                sourceId: { type: "string" },
                rowNumber: { type: "number" },
                reason: { type: "string" },
              },
            },
          },
          series: {
            type: "array",
            description: "Only when the metric has a groupBy: one point per group. Empty array otherwise.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "value"],
              properties: { label: { type: "string" }, value: { type: ["number", "null"] } },
            },
          },
          caveats: { type: "array", items: { type: "string" } },
        },
      },
    },
    funnelStages: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["fieldId", "label", "value"],
            properties: {
              fieldId: { type: "string" },
              label: { type: "string" },
              value: { type: ["number", "null"] },
            },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const COMPUTE_SYSTEM_PROMPT = `You are a meticulous impact-measurement analyst computing KPIs from a messy, human-filled spreadsheet. You receive KPI definitions (with a formula over concrete columns) and the RAW cell values of every relevant row. Your job: normalize each cell, apply the formula exactly, and show your work per row.

NORMALIZATION RULES — apply to every cell before any math:
- Strip currency tokens: "R26 766 051" -> 26766051, "$5,000" -> 5000, "USD 1200" -> 1200.
- Resolve thousand separators in ALL conventions: "1,234" -> 1234, "1.234.567" -> 1234567, "1 200" -> 1200, "120.000" -> 120000 (European) — use column context (other values' magnitudes) to disambiguate a lone "1.234".
- Percentages: "50%" -> 50 when the metric's unit is %, otherwise convert sensibly and say so in the explanation.
- Numbers embedded in text: "800 agents" -> 800, "approx. 1,500 people" -> 1500 — ONLY when exactly one unambiguous number is present.
- "N/A", "-", "none", "unknown", empty, or pure prose with no number -> EXCLUDE the row with a short reason. Never substitute 0 for missing.
- An explicit "0" is a real value — include it.
- NEVER invent, estimate, or interpolate a value that is not in the cell.

COMPUTATION RULES:
- Apply the formula exactly as defined (count / distinct_count / sum / average, optionally a ratio of two such expressions, with the given filters).
- For sum/average, the aggregate MUST equal the aggregate of your usedRows' normalizedValue entries. Double-check the arithmetic before answering.
- Every source row is accounted for exactly once per metric: either in usedRows (with its normalized value) or in excludedRows (with a reason). Row numbers come from the provided data — never renumber.
- If a metric has a groupBy field, also return one series point per group value (normalized the same way); otherwise series is [].
- If funnel stage fields are provided, return the normalized TOTAL per stage across all rows in funnelStages (same normalization; null when a stage has no usable values).

HONESTY RULES:
- Do NOT smooth, cap, or "correct" implausible values (e.g. a later funnel stage larger than an earlier one). Compute what the data says and flag the concern in caveats.
- caveats: list every judgement call you made (e.g. '"800 agents" read as 800') and every suspicious pattern you noticed.
- If a metric is not computable at all, set value to null and explain why in the explanation.
- explanation is for a non-technical programme manager: plain words, name the column in quotes, no formula jargon.`;

const MAX_ROWS_PER_TABLE = 500;
const MAX_CELL_CHARS = 160;

function refsOfMetric(metric: MetricDefinition): FieldRef[] {
  const refs: FieldRef[] = [];
  const collect = (expr: { ref: FieldRef | null; filters: Array<{ ref: FieldRef }> }) => {
    if (expr.ref) refs.push(expr.ref);
    for (const f of expr.filters) refs.push(f.ref);
  };
  if (metric.formula.kind === "atomic") collect(metric.formula.expr);
  else {
    collect(metric.formula.numerator);
    collect(metric.formula.denominator);
  }
  if (metric.groupBy) refs.push(metric.groupBy);
  return refs;
}

function buildComputePacket(args: {
  goal: string;
  metrics: MetricDefinition[];
  tables: ParsedTable[];
  funnel: SemanticPlan["orderedFunnel"];
}): string {
  // Only ship the columns any metric (or the funnel) actually reads.
  const wanted = new Map<string, Set<string>>();
  const want = (sourceId: string, fieldId: string) => {
    if (!wanted.has(sourceId)) wanted.set(sourceId, new Set());
    wanted.get(sourceId)!.add(fieldId);
  };
  for (const metric of args.metrics) for (const ref of refsOfMetric(metric)) want(ref.sourceId, ref.fieldId);
  if (args.funnel) for (const stage of args.funnel.stages) want(args.funnel.sourceId, stage.fieldId);

  const data = args.tables
    .filter((t) => wanted.has(t.sourceId))
    .map((table) => {
      const fieldIds = [...(wanted.get(table.sourceId) ?? [])];
      const fields = table.fields
        .filter((f) => fieldIds.includes(f.id))
        .map((f) => ({ fieldId: f.id, header: f.header }));
      const rows = table.rows.slice(0, MAX_ROWS_PER_TABLE).map((row) => ({
        rowNumber: row.rowNumber,
        values: Object.fromEntries(
          fieldIds.map((fid) => [fid, String(row.values[fid] ?? "").slice(0, MAX_CELL_CHARS)]),
        ),
      }));
      return { sourceId: table.sourceId, fileName: table.fileName, totalRows: table.rows.length, fields, rows };
    });

  return JSON.stringify({
    projectGoal: args.goal,
    metricsToCompute: args.metrics.map((m) => ({
      metricId: m.id,
      name: m.name,
      unit: m.unit,
      formula: m.formula,
      groupBy: m.groupBy,
    })),
    funnelStages: args.funnel
      ? { sourceId: args.funnel.sourceId, stages: args.funnel.stages }
      : null,
    data,
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function computeMetricsWithClaude(args: {
  goal: string;
  metrics: MetricDefinition[];
  tables: ParsedTable[];
  funnel: SemanticPlan["orderedFunnel"];
}): Promise<LlmComputeResult> {
  return runClaudeStructured({
    system: COMPUTE_SYSTEM_PROMPT,
    prompt: `Compute the following KPIs from the raw data below. Return only the JSON object.

${buildComputePacket(args)}`,
    jsonSchema: COMPUTE_JSON_SCHEMA,
    validate: (raw) => computeResultSchema.parse(raw),
    model: "claude-opus-4-8",
    maxTokens: 32000,
  });
}

/** Map one LLM-computed metric onto the dashboard's MetricResult shape (receipts intact). */
export function toMetricResult(
  computed: LlmComputedMetric,
  definition: MetricDefinition,
  tables: ParsedTable[],
): MetricResult {
  const refs = refsOfMetric(definition);
  const sourceIds = [...new Set(refs.map((r) => r.sourceId))];
  const recordsAvailable = tables
    .filter((t) => sourceIds.includes(t.sourceId))
    .reduce((sum, t) => sum + t.rows.length, 0);
  const recordsUsed = computed.usedRows.length;
  const excludedRecords = computed.excludedRows.length;
  const filters =
    definition.formula.kind === "atomic"
      ? definition.formula.expr.filters
      : [...definition.formula.numerator.filters, ...definition.formula.denominator.filters];

  return {
    metricId: definition.id,
    value: computed.value,
    coverage: recordsAvailable > 0 ? Math.min(1, recordsUsed / recordsAvailable) : 0,
    recordsUsed,
    recordsAvailable,
    missingRecords: Math.max(0, recordsAvailable - recordsUsed - excludedRecords),
    excludedRecords,
    series: computed.series,
    evidence: {
      sourceIds,
      fieldRefs: refs,
      formula: computed.explanation,
      filters,
      exampleRows: computed.usedRows.slice(0, 5).map((r) => ({ sourceId: r.sourceId, rowNumber: r.rowNumber })),
      caveats: [
        ...computed.caveats,
        ...computed.excludedRows.slice(0, 6).map((r) => `Row ${r.rowNumber} not counted: ${r.reason}`),
      ],
    },
  };
}
