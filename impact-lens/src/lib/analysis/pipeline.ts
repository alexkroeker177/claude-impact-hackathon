import { parseTabularFile, type FileInput, type ParsedTable } from "@/lib/files/parse";
import { profileTable, type SourceProfile } from "@/lib/files/profile";
import { interpretProject } from "@/lib/semantic/interpret";
import type { FieldRef, MetricDefinition, SemanticPlan } from "@/lib/semantic/schema";
import { validateSemanticPlan } from "@/lib/semantic/validate";
import { evaluateMetric, type MetricResult } from "@/lib/metrics/evaluate";
import type { DashboardAnalysis, DashboardMetric, Confidence } from "@/types/dashboard";

import { selectPrimaryChart, type ChartCandidate } from "./charts";
import { auditExactJoin, type JoinAudit } from "./joins";
import { collectWarnings, type AnalysisWarning } from "./warnings";

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ROWS = 25_000;

export type RunAnalysisInput = {
  projectId?: string;
  projectName: string;
  goal: string;
  attention?: string;
  files: FileInput[];
  interpret?: typeof interpretProject;
  acceptedMetricIds?: string[];
  confirmedJoinId?: string;
  userSuppliedReferenceIds?: string[];
  now?: Date;
};

export type AnalysisArtifacts = {
  dashboard: DashboardAnalysis;
  tables: ParsedTable[];
  profiles: SourceProfile[];
  semanticPlan: SemanticPlan;
  metricDefinitions: MetricDefinition[];
  metricResults: MetricResult[];
  joinAudit?: JoinAudit;
  warnings: AnalysisWarning[];
};

export async function runAnalysis(input: RunAnalysisInput): Promise<AnalysisArtifacts> {
  enforceByteLimit(input.files);
  const tables: ParsedTable[] = [];
  const parseFailures: AnalysisWarning[] = [];

  for (const file of input.files) {
    try {
      tables.push(...parseTabularFile(file));
    } catch (error) {
      parseFailures.push({
        id: `parse-${file.name}`,
        severity: "high",
        scope: "data",
        title: `Could not parse ${file.name}`,
        detail: error instanceof Error ? error.message : "Unknown parse failure.",
        recommendation: "Open the source file, confirm it is a valid CSV/XLSX document, and retry.",
      });
    }
  }

  if (!tables.length) throw new Error("No supported table could be parsed from the uploaded files.");
  const rowCount = tables.reduce((total, table) => total + table.rows.length, 0);
  if (rowCount > MAX_TOTAL_ROWS) throw new Error(`Parsed row limit exceeded: ${rowCount} rows; maximum ${MAX_TOTAL_ROWS}.`);

  const profiles = tables.map(profileTable);
  const userContext = {
    projectName: input.projectName,
    goal: input.goal,
    attention: input.attention,
    userSuppliedReferenceIds: input.userSuppliedReferenceIds,
  };
  const semanticPlan = validateSemanticPlan(
    await (input.interpret ?? interpretProject)({ ...userContext, profiles }),
    profiles,
    userContext,
  );

  const joinAudit = semanticPlan.candidateJoin
    ? auditExactJoin(
        {
          id: semanticPlan.candidateJoin.joinId,
          left: semanticPlan.candidateJoin.left,
          right: semanticPlan.candidateJoin.right,
          relationship: semanticPlan.candidateJoin.relationship,
          leftInferredType: fieldProfile(profiles, semanticPlan.candidateJoin.left)?.inferredType,
          rightInferredType: fieldProfile(profiles, semanticPlan.candidateJoin.right)?.inferredType,
        },
        tables,
      )
    : undefined;
  const confirmedJoin =
    joinAudit?.eligible && input.confirmedJoinId === joinAudit.candidateId
      ? { id: joinAudit.candidateId }
      : undefined;

  const accepted = new Set(input.acceptedMetricIds ?? semanticPlan.proposedMetrics.map((metric) => metric.metricId));
  const metricDefinitions = semanticPlan.proposedMetrics.filter((metric) => accepted.has(metric.metricId));
  const metricResults: MetricResult[] = [];
  const evaluationWarnings: AnalysisWarning[] = [];
  for (const definition of metricDefinitions) {
    try {
      metricResults.push(evaluateMetric(definition, tables, confirmedJoin));
    } catch (error) {
      evaluationWarnings.push({
        id: `metric-${definition.metricId}`,
        severity: "high",
        scope: "data",
        title: `${definition.label} could not be calculated`,
        detail: error instanceof Error ? error.message : "Unknown metric evaluation failure.",
        recommendation: "Review the proposed fields and formula before accepting this KPI.",
      });
    }
  }

  const chartCandidates = metricDefinitions.flatMap((definition): ChartCandidate[] => {
    const result = metricResults.find((candidate) => candidate.metricId === definition.metricId);
    if (!result?.series.length || !definition.groupBy) return [];
    const groupType = fieldProfile(profiles, definition.groupBy)?.inferredType;
    const groupRole = semanticPlan.tableInterpretations
      .flatMap((table) => table.fieldRoles)
      .find((assignment) => sameField(assignment.field, definition.groupBy!))?.role;
    const funnelLanguage = /funnel|ordered stage|impact stage/i.test(`${definition.label} ${definition.description}`);
    const orderedStageSeries = groupRole === "stage" ? explicitlyOrderedStages(result.series) : undefined;
    return [{
      metricId: definition.metricId,
      label: definition.label,
      series: orderedStageSeries ?? result.series,
      groupingKind: groupType === "date" ? "time" : orderedStageSeries ? "ordered_stage" : "category",
      explicitlyOrderedSameTableFunnel: Boolean(orderedStageSeries && funnelLanguage),
    }];
  });
  const primaryChart = selectPrimaryChart(chartCandidates);
  const funnel = primaryChart?.type === "funnel"
    ? {
        labels: primaryChart.series.map((point) => point.label),
        values: primaryChart.series.map((point) => point.value),
        explicitlyOrderedSameTable: true,
      }
    : undefined;
  const rejectedJoinReasons = semanticPlan.candidateJoin && !confirmedJoin
    ? joinAudit?.reasons.length
      ? joinAudit.reasons
      : ["The proposed exact join has not been confirmed by the user."]
    : [];
  const warnings = [
    ...parseFailures,
    ...evaluationWarnings,
    ...collectWarnings({ profiles, metricResults, rejectedJoinReasons, funnel }),
  ];

  const now = input.now ?? new Date();
  const dashboardMetrics = metricDefinitions.flatMap((definition): DashboardMetric[] => {
    const result = metricResults.find((candidate) => candidate.metricId === definition.metricId);
    return result ? [toDashboardMetric(definition, result, tables)] : [];
  });
  const averageCoverage = dashboardMetrics.length
    ? dashboardMetrics.reduce((sum, metric) => sum + metric.coverage, 0) / dashboardMetrics.length
    : 0;

  const dashboard: DashboardAnalysis = {
    project: {
      id: input.projectId ?? "pending",
      name: input.projectName,
      goal: input.goal,
      updatedAt: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(now),
      sourceCount: input.files.length,
      dataWindow: deriveDataWindow(profiles),
      status: "ready",
    },
    assessment: {
      summary: semanticPlan.summary,
      confidence: aggregateConfidence(metricDefinitions, averageCoverage),
      coverage: averageCoverage,
    },
    metrics: dashboardMetrics,
    chart: primaryChart,
    fiveDimensions: [
      dimension("What", semanticPlan.fiveDimensionsCoverage.what),
      dimension("Who", semanticPlan.fiveDimensionsCoverage.who),
      dimension("How much", semanticPlan.fiveDimensionsCoverage.howMuch),
      dimension("Contribution", semanticPlan.fiveDimensionsCoverage.contribution),
      dimension("Risk", semanticPlan.fiveDimensionsCoverage.risk),
    ],
    frameworkTags: semanticPlan.frameworkTags.map((tag) => ({
      framework: tag.framework,
      label: tag.label,
      confidence: tag.confidence,
      rationale: tag.rationale,
      caveat: tag.caveat,
    })),
    warnings: warnings.map(({ id, scope, severity, title, detail, recommendation }) => ({ id, scope, severity, title, detail, recommendation })),
    outlook: {
      status: "insufficient_evidence",
      summary: "The available uploaded data does not support a defensible success probability or numeric prognosis.",
      missingRequirements: outlookRequirements(semanticPlan, dashboardMetrics),
    },
  };

  return { dashboard, tables, profiles, semanticPlan, metricDefinitions, metricResults, joinAudit, warnings };
}

function enforceByteLimit(files: FileInput[]): void {
  const bytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (bytes > MAX_TOTAL_BYTES) throw new Error(`Combined upload limit exceeded: ${bytes} bytes; maximum ${MAX_TOTAL_BYTES}.`);
}

function sameField(left: FieldRef, right: FieldRef): boolean {
  return left.sourceId === right.sourceId && left.fieldId === right.fieldId;
}

function fieldProfile(profiles: SourceProfile[], field: FieldRef) {
  return profiles.find((profile) => profile.sourceId === field.sourceId)?.fields.find((candidate) => candidate.fieldId === field.fieldId);
}

function toDashboardMetric(definition: MetricDefinition, result: MetricResult, tables: ParsedTable[]): DashboardMetric {
  const unit = definition.unit ?? "";
  const sourceLabels = result.evidence.sourceIds.map((sourceId) => {
    const table = tables.find((candidate) => candidate.sourceId === sourceId);
    return table ? `${table.filename}${table.sheetName ? ` · ${table.sheetName}` : ""}` : sourceId;
  });
  return {
    id: result.metricId,
    label: definition.label,
    value: result.value,
    displayValue: formatValue(result.value, unit),
    unit,
    coverage: result.coverage,
    recordsUsed: result.recordsUsed,
    recordsAvailable: result.recordsAvailable,
    missingRecords: result.missingRecords,
    excludedRecords: result.excludedRecords,
    confidence: confidenceFromScore(definition.confidence),
    context: definition.description,
    evidence: {
      sources: sourceLabels,
      fields: result.evidence.fieldRefs.map((field) => `${field.sourceId}.${field.fieldId}`),
      formula: result.evidence.formula,
      filters: result.evidence.filters.map((filter) => `${filter.field.fieldId} ${filter.operator}${filter.value ? ` ${filter.value}` : ""}`),
      exampleRows: result.evidence.exampleRows,
      assumptions: ["Field meaning and aggregation grain follow the reviewed semantic plan."],
      caveats: result.evidence.caveats,
    },
  };
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return "Not available";
  const maximumFractionDigits = /percent|%|ratio|rate/i.test(unit) ? 1 : Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function confidenceFromScore(score: number): Confidence {
  return score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low";
}

function aggregateConfidence(definitions: MetricDefinition[], coverage: number): Confidence {
  if (!definitions.length) return "low";
  const modelConfidence = definitions.reduce((sum, definition) => sum + definition.confidence, 0) / definitions.length;
  return confidenceFromScore(modelConfidence * coverage);
}

function dimension(
  name: DashboardAnalysis["fiveDimensions"][number]["dimension"],
  coverage: SemanticPlan["fiveDimensionsCoverage"][keyof SemanticPlan["fiveDimensionsCoverage"]],
): DashboardAnalysis["fiveDimensions"][number] {
  return { dimension: name, status: coverage.status, evidence: coverage.rationale };
}

function deriveDataWindow(profiles: SourceProfile[]): string {
  const dates = profiles.flatMap((profile) => profile.fields.filter((field) => field.inferredType === "date").flatMap((field) => [field.min, field.max]))
    .filter((value): value is string => typeof value === "string");
  if (!dates.length) return "Available uploads";
  dates.sort((left, right) => Date.parse(left) - Date.parse(right));
  return `${dates[0]} to ${dates.at(-1)}`;
}

function outlookRequirements(plan: SemanticPlan, metrics: DashboardMetric[]): string[] {
  const missing = ["At least three comparable measurement periods", "Confirmed target values"];
  if (plan.theoryOfChangeCoverage.outcome.status !== "identified") missing.push("A consistently measured outcome indicator");
  if (metrics.some((metric) => metric.coverage < 0.8)) missing.push("At least 80% coverage for core outcomes");
  return missing;
}

/** Accept funnel ordering only when every source label carries an explicit unique numeric prefix. */
function explicitlyOrderedStages(series: Array<{ label: string; value: number | null }>) {
  const staged = series.map((point) => {
    const match = point.label.trim().match(/^(\d+)(?:[.):-]|\s)/);
    return match ? { point, order: Number(match[1]) } : null;
  });
  if (staged.some((entry) => entry === null)) return undefined;
  const valid = staged.filter((entry): entry is { point: { label: string; value: number | null }; order: number } => entry !== null);
  if (new Set(valid.map((entry) => entry.order)).size !== valid.length) return undefined;
  return valid.sort((left, right) => left.order - right.order).map((entry) => entry.point);
}
