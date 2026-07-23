import { z } from "zod";

/** A stable reference to a field emitted by the deterministic parser. */
export const fieldRefSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    fieldId: z.string().trim().min(1),
  })
  .strict();

export type FieldRef = z.infer<typeof fieldRefSchema>;

export const tablePurposeSchema = z.enum([
  "participants",
  "activities",
  "outcomes",
  "operations",
  "reference",
  "unknown",
]);

export type TablePurpose = z.infer<typeof tablePurposeSchema>;

export const fieldRoleSchema = z.enum([
  "identifier",
  "time",
  "group",
  "measure",
  "stage",
  "status",
  "demographic",
  "text",
  "unknown",
]);

export type FieldRole = z.infer<typeof fieldRoleSchema>;

export const candidateJoinSchema = z
  .object({
    joinId: z.string().trim().min(1),
    left: fieldRefSchema,
    right: fieldRefSchema,
    relationship: z.enum(["one_to_one", "one_to_many"]),
    rationale: z.string().trim().min(1),
  })
  .strict();

export type CandidateJoin = z.infer<typeof candidateJoinSchema>;

export const metricFilterSchema = z
  .object({
    field: fieldRefSchema,
    operator: z.enum(["equals", "not_empty"]),
    value: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((filter, context) => {
    if (filter.operator === "equals" && !filter.value) {
      context.addIssue({
        code: "custom",
        message: "An equals filter requires a value.",
        path: ["value"],
      });
    }
    if (filter.operator === "not_empty" && filter.value !== undefined) {
      context.addIssue({
        code: "custom",
        message: "A not_empty filter cannot include a value.",
        path: ["value"],
      });
    }
  });

export type MetricFilter = z.infer<typeof metricFilterSchema>;

export const atomicExpressionSchema = z
  .object({
    kind: z.literal("atomic"),
    operation: z.enum(["count", "distinct_count", "sum", "average"]),
    field: fieldRefSchema,
  })
  .strict();

export type AtomicExpression = z.infer<typeof atomicExpressionSchema>;

export const ratioExpressionSchema = z
  .object({
    kind: z.literal("ratio"),
    numerator: atomicExpressionSchema,
    denominator: atomicExpressionSchema,
  })
  .strict();

export type RatioExpression = z.infer<typeof ratioExpressionSchema>;

export const metricFormulaSchema = z.discriminatedUnion("kind", [
  atomicExpressionSchema,
  ratioExpressionSchema,
]);

export type MetricFormula = z.infer<typeof metricFormulaSchema>;

export const metricDefinitionSchema = z
  .object({
    metricId: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    formula: metricFormulaSchema,
    filters: z.array(metricFilterSchema).max(8).default([]),
    groupBy: fieldRefSchema.optional(),
    unit: z.string().trim().max(80).optional(),
    rationale: z.string().trim().min(1).max(800),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;

export const coverageStatusSchema = z.enum(["identified", "partial", "not_found"]);
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;

export const coverageItemSchema = z
  .object({
    status: coverageStatusSchema,
    fields: z.array(fieldRefSchema).max(8),
    rationale: z.string().trim().min(1).max(800),
  })
  .strict();

export type CoverageItem = z.infer<typeof coverageItemSchema>;

export const theoryOfChangeCoverageSchema = z
  .object({
    activity: coverageItemSchema,
    output: coverageItemSchema,
    outcome: coverageItemSchema,
    impact: coverageItemSchema,
  })
  .strict();

export type TheoryOfChangeCoverage = z.infer<typeof theoryOfChangeCoverageSchema>;

export const fiveDimensionsCoverageSchema = z
  .object({
    what: coverageItemSchema,
    who: coverageItemSchema,
    howMuch: coverageItemSchema,
    contribution: coverageItemSchema,
    risk: coverageItemSchema,
  })
  .strict();

export type FiveDimensionsCoverage = z.infer<typeof fiveDimensionsCoverageSchema>;

export const frameworkTagSchema = z
  .object({
    framework: z.enum([
      "five_dimensions",
      "sdg",
      "iris_plus",
      "esg",
      "triple_bottom_line",
    ]),
    label: z.string().trim().min(1).max(160),
    confidence: z.number().min(0).max(1),
    evidenceBasis: z.enum(["project_context", "field_evidence", "user_supplied"]),
    rationale: z.string().trim().min(1).max(800),
    caveat: z.string().trim().min(1).max(800),
    referenceId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type FrameworkTag = z.infer<typeof frameworkTagSchema>;

export const tableInterpretationSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    purpose: tablePurposeSchema,
    fieldRoles: z
      .array(
        z
          .object({
            field: fieldRefSchema,
            role: fieldRoleSchema,
            rationale: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type TableInterpretation = z.infer<typeof tableInterpretationSchema>;

export const semanticPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(2_000),
    tableInterpretations: z.array(tableInterpretationSchema).max(100),
    candidateJoin: candidateJoinSchema.optional(),
    proposedMetrics: z.array(metricDefinitionSchema).max(4),
    theoryOfChangeCoverage: theoryOfChangeCoverageSchema,
    fiveDimensionsCoverage: fiveDimensionsCoverageSchema,
    frameworkTags: z.array(frameworkTagSchema).max(12),
    uncertainties: z.array(z.string().trim().min(1).max(800)).max(20),
  })
  .strict();

export type SemanticPlan = z.infer<typeof semanticPlanSchema>;

/**
 * The semantic layer deliberately depends only on this structural subset of
 * the ingestion profile. It never receives parsed rows or raw upload paths.
 */
export type SemanticSourceProfile = {
  sourceId: string;
  fields: Array<{
    fieldId: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export type SemanticUserContext = {
  projectName: string;
  goal: string;
  attention?: string;
  /** Exact standards identifiers the user explicitly supplied. */
  userSuppliedReferenceIds?: string[];
};
