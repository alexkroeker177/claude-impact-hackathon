import { runClaudeStructured } from "../claude/run";
import {
  type FrameworkTag,
  type SemanticPlan,
  type SemanticSourceProfile,
  type SemanticUserContext,
  semanticPlanSchema,
} from "./schema";
import { isAllowedFrameworkTag, validateMetricDefinition, validateSemanticPlan } from "./validate";

export type InterpretProjectInput = SemanticUserContext & {
  profiles: SemanticSourceProfile[];
};

type ModelVisibleField = {
  fieldId: string;
  header?: string;
  inferredType?: string;
  nullRate?: number;
  uniqueCount?: number;
  min?: number | string;
  max?: number | string;
};

type ModelVisibleProfile = {
  sourceId: string;
  label?: string;
  sheetName?: string;
  rowCount?: number;
  parseWarnings?: string[];
  fields: ModelVisibleField[];
};

function asString(value: unknown, maximum = 300): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asAggregateRange(
  value: unknown,
  inferredType: string | undefined,
): number | string | undefined {
  if (["integer", "number", "percentage", "currency"].includes(inferredType ?? "")) {
    return asFiniteNumber(value);
  }
  return inferredType === "date" ? asString(value) : undefined;
}

/**
 * Creates the only model-visible packet. It contains structural metadata only:
 * no row arrays, raw cell values, samples, upload locations, or parser internals.
 */
export function compactRedactedProfiles(profiles: SemanticSourceProfile[]): ModelVisibleProfile[] {
  return profiles.map((profile) => {
    const record = profile as Record<string, unknown>;
    const warnings = record.parseWarnings ?? record.warnings;
    const fields = profile.fields.map((field) => {
      const fieldRecord = field as Record<string, unknown>;
      const inferredType = asString(fieldRecord.inferredType) ?? asString(fieldRecord.type);
      return {
        fieldId: field.fieldId,
        header: asString(fieldRecord.header),
        inferredType,
        nullRate: asFiniteNumber(fieldRecord.nullRate),
        uniqueCount: asFiniteNumber(fieldRecord.uniqueCount),
        min: asAggregateRange(fieldRecord.min, inferredType),
        max: asAggregateRange(fieldRecord.max, inferredType),
      };
    });
    return {
      sourceId: profile.sourceId,
      label: asString(record.filename) ?? asString(record.name),
      sheetName: asString(record.sheetName),
      rowCount: asFiniteNumber(record.rowCount),
      parseWarnings: Array.isArray(warnings)
        ? warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 10)
        : undefined,
      fields: selectModelFields(fields).map((field, index) => index < 3 ? field : {
        fieldId: field.fieldId,
        header: field.header,
        inferredType: field.inferredType,
      }),
    };
  });
}

function selectModelFields(fields: ModelVisibleField[]): ModelVisibleField[] {
  const firstContextFields = fields.slice(0, 4);
  const structuralFields = fields.filter((field) => ["date", "identifier", "category"].includes(field.inferredType ?? ""));
  const rankedFields = [...fields].sort((left, right) => fieldUtility(right) - fieldUtility(left));
  const selected = new Map<string, ModelVisibleField>();
  for (const field of [...firstContextFields, ...structuralFields, ...rankedFields]) {
    if (!selected.has(field.fieldId)) selected.set(field.fieldId, field);
    if (selected.size === 20) break;
  }
  return [...selected.values()];
}

function fieldUtility(field: ModelVisibleField): number {
  const typeWeight = ["integer", "number", "percentage"].includes(field.inferredType ?? "")
    ? 4
    : ["date", "category", "identifier", "currency"].includes(field.inferredType ?? "")
      ? 2
      : 1;
  return typeWeight + (1 - (field.nullRate ?? 1));
}

const semanticPrompt = [
  "Read analysis-input.json and return the requested semantic plan.",
  "Use only its source IDs and field IDs; never invent fields, joins, values, formulas, or standards identifiers.",
  "Propose no more than four calculable KPIs. Each KPI must use one table only and a supported atomic formula or one-level ratio.",
  "Describe uncertainty and missing evidence explicitly. Framework tags are candidate alignment only, never compliance.",
  "Be concise: keep the summary under four sentences, each rationale under two sentences, and uncertainties to at most eight short items.",
  "Do not supply official SDG indicator IDs or IRIS+ metric codes unless they appear exactly in userSuppliedReferenceIds.",
  "Return only JSON that matches the provided JSON Schema.",
].join(" ");

function filterInvalidMetrics(plan: SemanticPlan, profiles: SemanticSourceProfile[]): SemanticPlan {
  const proposedMetrics = plan.proposedMetrics.filter((metric) => {
    try {
      validateMetricDefinition(metric, profiles);
      return true;
    } catch {
      return false;
    }
  });
  return { ...plan, proposedMetrics };
}

function filterDisallowedFrameworkTags(
  plan: SemanticPlan,
  context: SemanticUserContext,
): SemanticPlan {
  const frameworkTags: FrameworkTag[] = plan.frameworkTags.filter((tag) =>
    isAllowedFrameworkTag(tag, context),
  );
  return { ...plan, frameworkTags };
}

function sanitizeOptionalReferences(plan: SemanticPlan, profiles: SemanticSourceProfile[]): SemanticPlan {
  const available = (reference: { sourceId: string; fieldId: string }) => profiles.some((profile) =>
    profile.sourceId === reference.sourceId && profile.fields.some((field) => field.fieldId === reference.fieldId));
  const sanitizeCoverage = <T extends { status: "identified" | "partial" | "not_found"; fields: Array<{ sourceId: string; fieldId: string }>; rationale: string }>(coverage: T): T => {
    const fields = coverage.fields.filter(available);
    return {
      ...coverage,
      fields,
      status: fields.length ? coverage.status : "not_found",
      rationale: fields.length === coverage.fields.length ? coverage.rationale : `${coverage.rationale} Unavailable model references were omitted.`,
    };
  };
  const candidateJoin = plan.candidateJoin && available(plan.candidateJoin.left) && available(plan.candidateJoin.right)
    ? plan.candidateJoin
    : undefined;
  return {
    ...plan,
    tableInterpretations: plan.tableInterpretations
      .filter((table) => profiles.some((profile) => profile.sourceId === table.sourceId))
      .map((table) => ({ ...table, fieldRoles: table.fieldRoles.filter((role) => available(role.field)) })),
    ...(candidateJoin ? { candidateJoin } : { candidateJoin: undefined }),
    theoryOfChangeCoverage: {
      activity: sanitizeCoverage(plan.theoryOfChangeCoverage.activity),
      output: sanitizeCoverage(plan.theoryOfChangeCoverage.output),
      outcome: sanitizeCoverage(plan.theoryOfChangeCoverage.outcome),
      impact: sanitizeCoverage(plan.theoryOfChangeCoverage.impact),
    },
    fiveDimensionsCoverage: {
      what: sanitizeCoverage(plan.fiveDimensionsCoverage.what),
      who: sanitizeCoverage(plan.fiveDimensionsCoverage.who),
      howMuch: sanitizeCoverage(plan.fiveDimensionsCoverage.howMuch),
      contribution: sanitizeCoverage(plan.fiveDimensionsCoverage.contribution),
      risk: sanitizeCoverage(plan.fiveDimensionsCoverage.risk),
    },
  };
}

/** Runs one bounded Claude Code semantic pass and returns a policy-validated plan. */
export async function interpretProject(input: InterpretProjectInput): Promise<SemanticPlan> {
  const userContext: SemanticUserContext = {
    projectName: input.projectName,
    goal: input.goal,
    attention: input.attention,
    userSuppliedReferenceIds: input.userSuppliedReferenceIds,
  };
  const plan = await runClaudeStructured({
    prompt: semanticPrompt,
    schema: semanticPlanSchema,
    analysisInput: {
      projectName: input.projectName,
      goal: input.goal,
      attention: input.attention,
      userSuppliedReferenceIds: input.userSuppliedReferenceIds ?? [],
      profiles: compactRedactedProfiles(input.profiles),
    },
  });

  // Invalid proposed metrics and optional framework tags do not invalidate an
  // otherwise usable interpretation. Structural plan errors still fail below.
  const filtered = sanitizeOptionalReferences(
    filterDisallowedFrameworkTags(filterInvalidMetrics(plan, input.profiles), userContext),
    input.profiles,
  );
  return validateSemanticPlan(filtered, input.profiles, userContext);
}
