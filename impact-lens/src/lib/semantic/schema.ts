import { z } from "zod";

/** Reference to a concrete field in a parsed table. Claude may only reference these. */
export const fieldRefSchema = z.object({
  sourceId: z.string(),
  fieldId: z.string(),
});
export type FieldRef = z.infer<typeof fieldRefSchema>;

export const metricFilterSchema = z.object({
  ref: fieldRefSchema,
  op: z.enum(["equals", "not_empty"]),
  /** Required for "equals", ignored for "not_empty". */
  value: z.string().nullable(),
});
export type MetricFilter = z.infer<typeof metricFilterSchema>;

export const atomicExprSchema = z.object({
  op: z.enum(["count", "distinct_count", "sum", "average"]),
  /** Field the op reads. Null only for "count" (row count after filters). */
  ref: fieldRefSchema.nullable(),
  filters: z.array(metricFilterSchema),
});
export type AtomicExpr = z.infer<typeof atomicExprSchema>;

export const formulaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("atomic"), expr: atomicExprSchema }),
  z.object({
    kind: z.literal("ratio"),
    numerator: atomicExprSchema,
    denominator: atomicExprSchema,
  }),
]);
export type Formula = z.infer<typeof formulaSchema>;

export const metricDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  formula: formulaSchema,
  /** Optional single group-by field -> produces a series (chart input). */
  groupBy: fieldRefSchema.nullable(),
  unit: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()),
  caveats: z.array(z.string()),
});
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;

export const frameworkTagSchema = z.object({
  framework: z.enum(["five_dimensions", "sdg", "iris_plus", "esg", "triple_bottom_line"]),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceBasis: z.enum(["project_context", "field_evidence", "user_supplied"]),
  rationale: z.string(),
  caveat: z.string(),
  /** Official indicator/metric code. Only valid when supplied in user context. */
  referenceId: z.string().nullable(),
});
export type FrameworkTag = z.infer<typeof frameworkTagSchema>;

export const coverageStatusSchema = z.enum(["identified", "partial", "not_found"]);
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;

export const coverageEntrySchema = z.object({
  status: coverageStatusSchema,
  fieldRefs: z.array(fieldRefSchema),
  rationale: z.string(),
});
export type CoverageEntry = z.infer<typeof coverageEntrySchema>;

export const candidateJoinSchema = z.object({
  id: z.string(),
  left: fieldRefSchema,
  right: fieldRefSchema,
  rationale: z.string(),
});
export type CandidateJoin = z.infer<typeof candidateJoinSchema>;

/** Ordered same-table funnel (e.g. inform -> engage -> outcomes). Enables funnel chart + monotonicity warnings. */
export const orderedFunnelSchema = z.object({
  sourceId: z.string(),
  stages: z.array(z.object({ fieldId: z.string(), label: z.string() })).min(2),
  rationale: z.string(),
});
export type OrderedFunnel = z.infer<typeof orderedFunnelSchema>;

export const tablePurposeSchema = z.enum([
  "survey_responses",
  "financials",
  "activity_log",
  "reference",
  "aggregate_report",
  "other",
]);

export const semanticPlanSchema = z.object({
  understanding: z.string(),
  tables: z.array(
    z.object({
      sourceId: z.string(),
      purpose: tablePurposeSchema,
      rationale: z.string(),
    }),
  ),
  proposedMetrics: z.array(metricDefinitionSchema).max(4),
  candidateJoin: candidateJoinSchema.nullable(),
  orderedFunnel: orderedFunnelSchema.nullable(),
  theoryOfChange: z.object({
    activity: coverageEntrySchema,
    output: coverageEntrySchema,
    outcome: coverageEntrySchema,
    impact: coverageEntrySchema,
  }),
  fiveDimensions: z.object({
    what: coverageEntrySchema,
    who: coverageEntrySchema,
    howMuch: coverageEntrySchema,
    contribution: coverageEntrySchema,
    risk: coverageEntrySchema,
  }),
  frameworkTags: z.array(frameworkTagSchema),
  uncertainties: z.array(z.string()),
});
export type SemanticPlan = z.infer<typeof semanticPlanSchema>;
