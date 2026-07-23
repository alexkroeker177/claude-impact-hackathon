import type { ParsedTable, SourceProfile } from "@/lib/files/types";
import type { MetricDefinition, SemanticPlan } from "@/lib/semantic/schema";
import type { AnalysisWarning, MetricResult } from "@/lib/analysis/types";
import { sumParseableField } from "@/lib/metrics/evaluate";

export interface BuildWarningsInput {
  profiles: SourceProfile[];
  tables: ParsedTable[];
  plan: SemanticPlan;
  results: Array<{ definition: MetricDefinition; result: MetricResult }>;
  joinAudit?: { eligible: boolean; reasons: string[] } | null;
}

export function buildWarnings(input: BuildWarningsInput): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];
  let n = 0;
  const push = (w: Omit<AnalysisWarning, "id">) => {
    n += 1;
    warnings.push({ id: `w${n}`, ...w });
  };

  for (const profile of input.profiles) {
    for (const warning of profile.parseWarnings) {
      push({
        scope: "data",
        severity: profile.fields.length === 0 ? "critical" : "warning",
        message: `${profile.fileName}: ${warning}`,
        sourceId: profile.sourceId,
        fieldRefs: [],
      });
    }
    for (const field of profile.fields) {
      if (field.nullRate >= 0.5) {
        push({
          scope: "data",
          severity: "warning",
          message: `${Math.round(field.nullRate * 100)}% of "${field.header}" values are missing in ${profile.fileName}.`,
          sourceId: profile.sourceId,
          fieldRefs: [{ sourceId: profile.sourceId, fieldId: field.fieldId }],
        });
      }
      if (field.mixedTypes) {
        push({
          scope: "data",
          severity: "warning",
          message: `"${field.header}" in ${profile.fileName} mixes incompatible value types.`,
          sourceId: profile.sourceId,
          fieldRefs: [{ sourceId: profile.sourceId, fieldId: field.fieldId }],
        });
      }
    }
  }

  for (const { definition, result } of input.results) {
    if (result.coverage < 0.6) {
      push({
        scope: "project",
        severity: "warning",
        message: `"${definition.name}" was only computed from ${Math.round(result.coverage * 100)}% of available records.`,
        sourceId: result.evidence.sourceIds[0] ?? null,
        fieldRefs: result.evidence.fieldRefs,
      });
    }
  }

  if (input.joinAudit && !input.joinAudit.eligible) {
    push({
      scope: "project",
      severity: "info",
      message: `A proposed cross-file join was not confirmed: ${input.joinAudit.reasons.join("; ") || "eligibility criteria not met"}.`,
      sourceId: null,
      fieldRefs: [],
    });
  }

  const funnel = input.plan.orderedFunnel;
  if (funnel && funnel.stages.length >= 2) {
    const table = input.tables.find((t) => t.sourceId === funnel.sourceId);
    if (table) {
      const stages = funnel.stages.map((s) => ({ ...s, total: sumParseableField(table, s.fieldId) }));
      for (let i = 1; i < stages.length; i++) {
        const prev = stages[i - 1];
        const curr = stages[i];
        if (prev.total !== null && curr.total !== null && curr.total > prev.total) {
          push({
            scope: "project",
            severity: "warning",
            message: `"${curr.label}" (${Math.round(curr.total).toLocaleString("en-US")}) exceeds "${prev.label}" (${Math.round(prev.total).toLocaleString("en-US")}) — a review signal, not an automatic correction.`,
            sourceId: table.sourceId,
            fieldRefs: [
              { sourceId: table.sourceId, fieldId: curr.fieldId },
              { sourceId: table.sourceId, fieldId: prev.fieldId },
            ],
          });
        }
      }
    }
  }

  return warnings;
}
