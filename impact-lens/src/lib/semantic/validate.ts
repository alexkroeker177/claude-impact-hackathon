import {
  type AtomicExpression,
  type FieldRef,
  type FrameworkTag,
  type MetricDefinition,
  type SemanticPlan,
  type SemanticSourceProfile,
  type SemanticUserContext,
  semanticPlanSchema,
} from "./schema";

function unavailableField(reference: FieldRef): Error {
  return new Error(
    `Semantic plan references unavailable field ${reference.fieldId} in source ${reference.sourceId}.`,
  );
}

function assertFieldAvailable(reference: FieldRef, profiles: SemanticSourceProfile[]): void {
  const profile = profiles.find((candidate) => candidate.sourceId === reference.sourceId);
  if (!profile || !profile.fields.some((field) => field.fieldId === reference.fieldId)) {
    throw unavailableField(reference);
  }
}

function formulaFields(metric: MetricDefinition): FieldRef[] {
  const atomicFields = (expression: AtomicExpression): FieldRef[] => [expression.field];
  const { formula } = metric;
  if (formula.kind === "atomic") {
    return atomicFields(formula);
  }
  return [...atomicFields(formula.numerator), ...atomicFields(formula.denominator)];
}

function assertMetricUsesOneSource(metric: MetricDefinition): void {
  const references = [
    ...formulaFields(metric),
    ...metric.filters.map((filter) => filter.field),
    ...(metric.groupBy ? [metric.groupBy] : []),
  ];
  const sourceIds = new Set(references.map((reference) => reference.sourceId));
  if (sourceIds.size > 1) {
    throw new Error(
      `Metric ${metric.metricId} references multiple tables. Cross-table metrics require a confirmed exact join.`,
    );
  }
}

function fieldProfile(reference: FieldRef, profiles: SemanticSourceProfile[]): Record<string, unknown> | undefined {
  return profiles.find((profile) => profile.sourceId === reference.sourceId)?.fields
    .find((field) => field.fieldId === reference.fieldId) as Record<string, unknown> | undefined;
}

function metricTypesAreCompatible(metric: MetricDefinition, profiles: SemanticSourceProfile[]): boolean {
  const numericTypes = new Set(["integer", "number"]);
  const expressions = metric.formula.kind === "atomic"
    ? [metric.formula]
    : [metric.formula.numerator, metric.formula.denominator];
  for (const expression of expressions) {
    if (expression.operation !== "sum" && expression.operation !== "average") continue;
    const profile = fieldProfile(expression.field, profiles);
    const inferredType = typeof profile?.inferredType === "string" ? profile.inferredType : undefined;
    if (inferredType && !numericTypes.has(inferredType)) return false;
  }
  if (metric.groupBy) {
    const profile = fieldProfile(metric.groupBy, profiles);
    const inferredType = typeof profile?.inferredType === "string" ? profile.inferredType : undefined;
    if (inferredType && !new Set(["identifier", "category", "text", "date"]).has(inferredType)) return false;
  }
  return true;
}

function userSuppliedReferenceIds(context: SemanticUserContext): Set<string> {
  return new Set(
    (context.userSuppliedReferenceIds ?? []).map((referenceId) => referenceId.trim().toUpperCase()),
  );
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isReferenceInUserContext(referenceId: string, context: SemanticUserContext): boolean {
  if (userSuppliedReferenceIds(context).has(referenceId.trim().toUpperCase())) {
    return true;
  }
  const token = new RegExp(`(?:^|[^A-Z0-9])${escapedRegex(referenceId)}(?:$|[^A-Z0-9])`, "i");
  return [context.projectName, context.goal, context.attention ?? ""].some((text) => token.test(text));
}

function isOfficialSdgIndicatorId(referenceId: string): boolean {
  // e.g. 1.1.1, 3.8.2, 13.1.1. This deliberately does not treat "SDG 3" as an indicator ID.
  return /(?:^|\bSDG\s*)\d{1,2}\.\d{1,2}(?:\.\d{1,2})+[A-Z]?(?:$|\b)/i.test(
    referenceId.trim(),
  );
}

function isIrisPlusMetricCode(referenceId: string): boolean {
  // Common IRIS+ metric-code shape, e.g. PI4060 or OI1479.
  return /^[A-Z]{2,8}-?\d{3,8}$/i.test(referenceId.trim());
}

function assertFrameworkTagIsAllowed(tag: FrameworkTag, context: SemanticUserContext): void {
  if (!tag.referenceId) {
    return;
  }

  const referenceId = tag.referenceId.trim();
  const requiresUserSuppliedContext =
    (tag.framework === "sdg" && isOfficialSdgIndicatorId(referenceId)) ||
    (tag.framework === "iris_plus" && isIrisPlusMetricCode(referenceId));

  if (
    requiresUserSuppliedContext &&
    !isReferenceInUserContext(referenceId, context)
  ) {
    throw new Error(
      `Framework reference ${referenceId} must be present in user-supplied context; the model cannot invent standards IDs.`,
    );
  }
}

export function validateMetricDefinition(
  metric: MetricDefinition,
  profiles: SemanticSourceProfile[],
): MetricDefinition {
  for (const reference of [
    ...formulaFields(metric),
    ...metric.filters.map((filter) => filter.field),
    ...(metric.groupBy ? [metric.groupBy] : []),
  ]) {
    assertFieldAvailable(reference, profiles);
  }
  assertMetricUsesOneSource(metric);
  return metric;
}

/** Validates all model output against known parser identifiers and policy limits. */
export function validateSemanticPlan(
  plan: unknown,
  profiles: SemanticSourceProfile[],
  userContext: SemanticUserContext,
): SemanticPlan {
  const parsed = semanticPlanSchema.parse(plan);

  for (const interpretation of parsed.tableInterpretations) {
    if (!profiles.some((profile) => profile.sourceId === interpretation.sourceId)) {
      throw new Error(`Semantic plan references unavailable source ${interpretation.sourceId}.`);
    }
    for (const assignment of interpretation.fieldRoles) {
      assertFieldAvailable(assignment.field, profiles);
      if (assignment.field.sourceId !== interpretation.sourceId) {
        throw new Error("A table interpretation may only assign roles from its own source.");
      }
    }
  }

  if (parsed.candidateJoin) {
    assertFieldAvailable(parsed.candidateJoin.left, profiles);
    assertFieldAvailable(parsed.candidateJoin.right, profiles);
    if (parsed.candidateJoin.left.sourceId === parsed.candidateJoin.right.sourceId) {
      throw new Error("A candidate join must reference two distinct sources.");
    }
  }

  for (const metric of parsed.proposedMetrics) {
    validateMetricDefinition(metric, profiles);
  }
  const compatibleMetrics = parsed.proposedMetrics.filter((metric) => metricTypesAreCompatible(metric, profiles));

  const coverageGroups = [
    parsed.theoryOfChangeCoverage.activity,
    parsed.theoryOfChangeCoverage.output,
    parsed.theoryOfChangeCoverage.outcome,
    parsed.theoryOfChangeCoverage.impact,
    parsed.fiveDimensionsCoverage.what,
    parsed.fiveDimensionsCoverage.who,
    parsed.fiveDimensionsCoverage.howMuch,
    parsed.fiveDimensionsCoverage.contribution,
    parsed.fiveDimensionsCoverage.risk,
  ];
  for (const coverage of coverageGroups) {
    for (const reference of coverage.fields) {
      assertFieldAvailable(reference, profiles);
    }
  }

  for (const tag of parsed.frameworkTags) {
    assertFrameworkTagIsAllowed(tag, userContext);
  }

  return { ...parsed, proposedMetrics: compatibleMetrics };
}

export function isAllowedFrameworkTag(
  tag: FrameworkTag,
  context: SemanticUserContext,
): boolean {
  try {
    assertFrameworkTagIsAllowed(tag, context);
    return true;
  } catch {
    return false;
  }
}
