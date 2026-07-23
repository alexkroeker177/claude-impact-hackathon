export type AnalysisWarning = {
  id: string;
  severity: "low" | "medium" | "high";
  scope: "data" | "project";
  title: string;
  detail: string;
  recommendation: string;
};

type ProfileLike = {
  sourceId: string;
  parseWarnings?: string[];
  warnings?: string[];
  fields?: Array<{
    fieldId?: string;
    id?: string;
    header?: string;
    nullRate?: number;
    missingRate?: number;
    mixedTypes?: boolean;
    invalidCount?: number;
    inferredType?: string;
    type?: string;
    uniqueness?: number;
    uniqueCount?: number;
    duplicateCount?: number;
  }>;
};

type ResultLike = {
  metricId: string;
  coverage: number;
};

export function collectWarnings(input: {
  profiles: ProfileLike[];
  metricResults: ResultLike[];
  rejectedJoinReasons?: string[];
  funnel?: { labels: string[]; values: Array<number | null>; explicitlyOrderedSameTable: boolean };
}): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];

  for (const profile of input.profiles) {
    for (const warning of profile.parseWarnings ?? profile.warnings ?? []) {
      warnings.push(dataWarning("parse", profile.sourceId, "Source parsing warning", warning, "Review the original source around the reported row or cell."));
    }
    for (const field of profile.fields ?? []) {
      const id = field.fieldId ?? field.id ?? field.header ?? "unknown-field";
      const label = field.header ?? id;
      const missing = field.nullRate ?? field.missingRate ?? 0;
      if (missing >= 0.5) {
        warnings.push(dataWarning("missing", `${profile.sourceId}-${id}`, `High missingness in ${label}`, `${Math.round(missing * 100)}% of values are missing.`, "Confirm whether blanks mean not measured, not applicable, or genuinely zero."));
      }
      if (field.mixedTypes) {
        warnings.push(dataWarning("mixed", `${profile.sourceId}-${id}`, `Mixed physical types in ${label}`, "The field contains incompatible physical value types.", "Standardise source formatting before relying on aggregation."));
      }
      if ((field.invalidCount ?? 0) > 0 && ["number", "integer", "currency", "percentage", "date"].includes(field.inferredType ?? field.type ?? "")) {
        warnings.push(dataWarning("invalid", `${profile.sourceId}-${id}`, `Invalid values in ${label}`, `${field.invalidCount} values could not be parsed as the inferred type.`, "Inspect and correct invalid source values or exclude them explicitly."));
      }
      if ((field.duplicateCount ?? 0) > 0 && (field.inferredType ?? field.type) === "identifier") {
        warnings.push(dataWarning("duplicate-id", `${profile.sourceId}-${id}`, `Duplicate candidate identifiers in ${label}`, `${field.duplicateCount} non-missing values repeat an existing identifier.`, "Confirm the identifier grain or remove duplicates before joining records."));
      }
    }
  }

  for (const result of input.metricResults) {
    if (result.coverage < 0.5) {
      warnings.push(dataWarning("coverage", result.metricId, "Low KPI coverage", `${Math.round(result.coverage * 100)}% of available records contribute to this KPI.`, "Treat the KPI as directional and improve coverage before comparison."));
    }
  }

  for (const [index, reason] of (input.rejectedJoinReasons ?? []).entries()) {
    warnings.push(dataWarning("join", String(index), "Cross-file join rejected", reason, "Keep tables independent or confirm a clean exact identifier."));
  }

  if (input.funnel?.explicitlyOrderedSameTable) {
    for (let index = 1; index < input.funnel.values.length; index += 1) {
      const previous = input.funnel.values[index - 1];
      const current = input.funnel.values[index];
      if (previous !== null && current !== null && current > previous) {
        warnings.push(dataWarning("funnel", String(index), "Impact funnel increases between stages", `${input.funnel.labels[index]} (${current.toLocaleString("en-US")}) is greater than ${input.funnel.labels[index - 1]} (${previous.toLocaleString("en-US")}).`, "Review stage definitions and calculation methods; do not automatically correct the values."));
      }
    }
  }

  return uniqueWarnings(warnings);
}

function dataWarning(kind: string, key: string, title: string, detail: string, recommendation: string): AnalysisWarning {
  return { id: `${kind}-${key}`, severity: kind === "missing" || kind === "parse" ? "high" : "medium", scope: "data", title, detail, recommendation };
}

function uniqueWarnings(warnings: AnalysisWarning[]): AnalysisWarning[] {
  return [...new Map(warnings.map((warning) => [warning.id, warning])).values()];
}
