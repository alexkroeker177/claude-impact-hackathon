import * as z from "zod";

export const confidenceSchema = z.enum(["low", "medium", "high"]);
export const projectStatusSchema = z.enum(["ready", "processing", "failed"]);

const evidenceExampleRowSchema = z.union([
  z.object({ sourceId: z.string(), rowNumber: z.number().int().positive() }).strict(),
  z.number().int().positive().transform((rowNumber) => ({ sourceId: "Legacy fixture", rowNumber })),
]);

const metricEvidenceSchema = z.object({
  sources: z.array(z.string()),
  fields: z.array(z.string()),
  formula: z.string(),
  filters: z.array(z.string()),
  exampleRows: z.array(evidenceExampleRowSchema).max(5),
  assumptions: z.array(z.string()).default([]),
  caveats: z.array(z.string()),
}).strict();

const dashboardMetricSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  displayValue: z.string(),
  unit: z.string(),
  coverage: z.number().min(0).max(1),
  recordsUsed: z.number().int().nonnegative(),
  recordsAvailable: z.number().int().nonnegative(),
  missingRecords: z.number().int().nonnegative(),
  excludedRecords: z.number().int().nonnegative(),
  confidence: confidenceSchema,
  context: z.string(),
  evidence: metricEvidenceSchema,
}).strict();

const chartSchema = z.object({
  type: z.enum(["bar", "line", "funnel"]),
  title: z.string(),
  description: z.string(),
  series: z.array(z.object({ label: z.string(), value: z.number().nullable() }).strict()),
  metricId: z.string().optional(),
}).strict();

const fiveDimensionSchema = z.object({
  dimension: z.enum(["What", "Who", "How much", "Contribution", "Risk"]),
  status: z.enum(["identified", "partial", "not_found"]),
  evidence: z.string(),
}).strict();

const frameworkTagSchema = z.object({
  framework: z.enum(["five_dimensions", "sdg", "iris_plus", "esg", "triple_bottom_line"]),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  caveat: z.string(),
}).strict();

const dashboardWarningSchema = z.object({
  id: z.string(),
  scope: z.enum(["data", "project"]).default("data"),
  severity: z.enum(["low", "medium", "high"]),
  title: z.string(),
  detail: z.string(),
  recommendation: z.string(),
}).strict();

export const dashboardAnalysisSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    goal: z.string(),
    updatedAt: z.string(),
    sourceCount: z.number().int().nonnegative(),
    dataWindow: z.string(),
    status: projectStatusSchema,
    synthetic: z.boolean().optional(),
  }).strict(),
  assessment: z.object({
    summary: z.string(),
    confidence: confidenceSchema,
    coverage: z.number().min(0).max(1),
  }).strict(),
  metrics: z.array(dashboardMetricSchema),
  chart: chartSchema.optional(),
  fiveDimensions: z.array(fiveDimensionSchema),
  frameworkTags: z.array(frameworkTagSchema),
  warnings: z.array(dashboardWarningSchema),
  outlook: z.object({
    status: z.literal("insufficient_evidence"),
    summary: z.string(),
    missingRequirements: z.array(z.string()),
  }).strict(),
}).strict();

export type Confidence = z.infer<typeof confidenceSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type MetricEvidence = z.infer<typeof metricEvidenceSchema>;
export type DashboardMetric = z.infer<typeof dashboardMetricSchema>;
export type DashboardAnalysis = z.infer<typeof dashboardAnalysisSchema>;

export function isDashboardAnalysis(value: unknown): value is DashboardAnalysis {
  return dashboardAnalysisSchema.safeParse(value).success;
}
