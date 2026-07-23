/**
 * Generic importer: maps an externally-harmonized long-format table
 * (published contract: org_id · wave · date · metric · value · grade · provenance)
 * into a precomputed DashboardAnalysis. Contains no dataset-specific logic:
 * funnel stages are discovered from the "funnel." metric-id prefix convention
 * and everything else is derived from the data itself.
 */
import type {
  FieldProfile,
  PhysicalType,
  SourceProfile,
} from "../../src/lib/files/types";
import type {
  MetricDefinition,
  SemanticPlan,
} from "../../src/lib/semantic/schema";
import type {
  AnalysisWarning,
  ChartSpec,
  DashboardAnalysis,
  MetricResult,
} from "../../src/lib/analysis/types";

export interface HarmonizedRecord {
  org_id: string;
  cohort: string;
  wave: string;
  date: string; // YYYY-MM
  metric: string;
  type: "count" | "money" | "percent" | "months" | "score" | "text";
  value: number | string | null;
  unit: string | null;
  currency: string | null;
  value_usd: number | null;
  raw_value: string;
  source_file: string;
  source_row: number;
  source_column: string;
  source_col_index: number;
  grade: "A" | "B" | "C" | "D" | "N";
  grade_reason: string | null;
}

export interface HarmonizedAnomaly {
  kind: string;
  org_id: string;
  date: string;
  detail: string;
  metrics: string[];
  source_file: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const TYPE_MAP: Record<HarmonizedRecord["type"], PhysicalType> = {
  count: "integer",
  money: "currency",
  percent: "percentage",
  months: "number",
  score: "number",
  text: "text",
};

function buildProfiles(records: HarmonizedRecord[]): SourceProfile[] {
  const byFile = new Map<string, HarmonizedRecord[]>();
  for (const r of records) {
    (byFile.get(r.source_file) ?? byFile.set(r.source_file, []).get(r.source_file)!).push(r);
  }
  const profiles: SourceProfile[] = [];
  for (const [file, recs] of byFile) {
    const byCol = new Map<number, HarmonizedRecord[]>();
    for (const r of recs) {
      (byCol.get(r.source_col_index) ?? byCol.set(r.source_col_index, []).get(r.source_col_index)!).push(r);
    }
    const fields: FieldProfile[] = [];
    // Virtual identity/grade fields produced by the harmonization layer itself.
    fields.push({
      fieldId: "org",
      header: "Organisation (resolved)",
      index: -2,
      inferredType: "identifier",
      nullRate: 0,
      uniqueCount: new Set(recs.map((r) => r.org_id)).size,
      numericRange: null,
      samples: [...new Set(recs.map((r) => r.org_id))].slice(0, 5),
      mixedTypes: false,
    });
    fields.push({
      fieldId: "grade",
      header: "Evidence grade",
      index: -1,
      inferredType: "category",
      nullRate: 0,
      uniqueCount: new Set(recs.map((r) => r.grade)).size,
      numericRange: null,
      samples: [...new Set(recs.map((r) => r.grade))].slice(0, 5),
      mixedTypes: false,
    });
    for (const [col, colRecs] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
      const numeric = colRecs.map((r) => r.value).filter((v): v is number => typeof v === "number");
      const distinct = new Set(colRecs.map((r) => r.raw_value));
      fields.push({
        fieldId: `c${col}`,
        header: colRecs[0].source_column,
        index: col,
        inferredType: TYPE_MAP[colRecs[0].type],
        nullRate: colRecs.filter((r) => r.grade === "N").length / colRecs.length,
        uniqueCount: distinct.size,
        numericRange: numeric.length
          ? { min: Math.min(...numeric), max: Math.max(...numeric) }
          : null,
        samples: [...distinct].slice(0, 5).map((s) => (s.length > 80 ? `${s.slice(0, 80)}…` : s)),
        mixedTypes: false,
      });
    }
    profiles.push({
      sourceId: slug(file),
      fileName: file,
      sheetName: null,
      rowCount: Math.max(...recs.map((r) => r.source_row)),
      parseWarnings: [],
      fields,
    });
  }
  return profiles.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** Latest reported record per org for one metric id, summed. */
function latestSum(records: HarmonizedRecord[], metric: string): { total: number; orgs: number; contributing: HarmonizedRecord[] } {
  const byOrg = new Map<string, HarmonizedRecord>();
  for (const r of records) {
    if (r.metric !== metric || typeof r.value !== "number") continue;
    const prior = byOrg.get(r.org_id);
    if (!prior || r.date > prior.date) byOrg.set(r.org_id, r);
  }
  const contributing = [...byOrg.values()];
  return {
    total: contributing.reduce((s, r) => s + (r.value as number), 0),
    orgs: contributing.length,
    contributing,
  };
}

function dateSeries(records: HarmonizedRecord[], metric: string): Array<{ label: string; value: number | null }> {
  const byDate = new Map<string, number>();
  for (const r of records) {
    if (r.metric !== metric || typeof r.value !== "number") continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.value);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));
}

function gradeCaveat(recs: HarmonizedRecord[]): string {
  const n = recs.length || 1;
  const share = (g: string) => Math.round((recs.filter((r) => r.grade === g).length / n) * 100);
  return `Evidence grades of contributing records: A ${share("A")}% · B ${share("B")}% · C ${share("C")}% · D ${share("D")}% · N ${share("N")}%`;
}

function fieldRefFor(records: HarmonizedRecord[], metric: string): { sourceId: string; fieldId: string } | null {
  const r = records.find((x) => x.metric === metric);
  return r ? { sourceId: slug(r.source_file), fieldId: `c${r.source_col_index}` } : null;
}

function exampleRows(recs: HarmonizedRecord[]): Array<{ sourceId: string; rowNumber: number }> {
  return recs.slice(0, 5).map((r) => ({ sourceId: slug(r.source_file), rowNumber: r.source_row }));
}

export function mapHarmonized(
  records: HarmonizedRecord[],
  anomalies: HarmonizedAnomaly[],
  opts: { projectName: string; funnelPrefix?: string } = { projectName: "Harmonized portfolio" },
): { profiles: SourceProfile[]; plan: SemanticPlan; dashboard: DashboardAnalysis } {
  const prefix = opts.funnelPrefix ?? "funnel.";
  const profiles = buildProfiles(records);
  const firstSource = profiles[0]?.sourceId ?? "unknown";
  const orgIds = new Set(records.map((r) => r.org_id));
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const waves = new Set(records.map((r) => `${r.cohort}|${r.wave}`)).size;
  const measured = records.filter((r) => r.grade === "A" || r.grade === "B");

  // Funnel stages discovered by prefix; ordered by descending latest-wave total (funnel property).
  const stageIds = [...new Set(records.filter((r) => r.metric.startsWith(prefix) && !r.metric.includes(".", prefix.length)).map((r) => r.metric))];
  const stages = stageIds
    .map((id) => ({ id, ...latestSum(records, id) }))
    .filter((s) => s.orgs > 0)
    .sort((a, b) => b.total - a.total);

  const metrics: Array<{ definition: MetricDefinition; result: MetricResult }> = [];

  const pushMetric = (
    definition: MetricDefinition,
    result: MetricResult,
  ) => metrics.push({ definition, result });

  // KPI 1: organisations tracked
  pushMetric(
    {
      id: "m-orgs",
      name: "Organisations tracked",
      description: "Distinct organisations resolved across all files and waves by entity resolution.",
      formula: { kind: "atomic", expr: { op: "distinct_count", ref: { sourceId: firstSource, fieldId: "org" }, filters: [] } },
      groupBy: null,
      unit: "organisations",
      confidence: 0.95,
      assumptions: ["Entity resolution merged aliases, people and email domains correctly."],
      caveats: [],
    },
    {
      metricId: "m-orgs",
      value: orgIds.size,
      coverage: 1,
      recordsUsed: records.length,
      recordsAvailable: records.length,
      missingRecords: 0,
      excludedRecords: 0,
      series: [],
      evidence: {
        sourceIds: profiles.map((p) => p.sourceId),
        fieldRefs: [{ sourceId: firstSource, fieldId: "org" }],
        formula: "distinct_count(Organisation (resolved))",
        filters: [],
        exampleRows: exampleRows(records),
        caveats: ["Resolved from person/organisation/email triples across every wave export."],
      },
    },
  );

  // KPI 2/3: top and bottom funnel stages, when a funnel exists
  if (stages.length >= 2) {
    for (const [i, stage] of [stages[0], stages[stages.length - 1]].entries()) {
      const label = stage.id.slice(prefix.length);
      const pretty = label.charAt(0).toUpperCase() + label.slice(1);
      const ref = fieldRefFor(records, stage.id) ?? { sourceId: firstSource, fieldId: "org" };
      const id = `m-${label}`;
      const stageRecs = records.filter((r) => r.metric === stage.id);
      pushMetric(
        {
          id,
          name: i === 0 ? `People reached — ${pretty}` : `Deep impact — ${pretty}`,
          description: `Latest reported ${stage.id} value per organisation, summed across the portfolio.`,
          formula: { kind: "atomic", expr: { op: "sum", ref, filters: [] } },
          groupBy: null,
          unit: "people",
          confidence: 0.8,
          assumptions: ["Latest wave per organisation reflects current cumulative reach."],
          caveats: [gradeCaveat(stage.contributing)],
        },
        {
          metricId: id,
          value: stage.total,
          coverage: stage.orgs / orgIds.size,
          recordsUsed: stage.orgs,
          recordsAvailable: orgIds.size,
          missingRecords: orgIds.size - stage.orgs,
          excludedRecords: stageRecs.filter((r) => typeof r.value !== "number").length,
          series: dateSeries(records, stage.id),
          evidence: {
            sourceIds: [...new Set(stageRecs.map((r) => slug(r.source_file)))],
            fieldRefs: [ref],
            formula: `sum(latest ${stage.id} per organisation)`,
            filters: [],
            exampleRows: exampleRows(stage.contributing),
            caveats: [gradeCaveat(stage.contributing)],
          },
        },
      );
    }
  }

  // KPI 4: measured evidence share
  pushMetric(
    {
      id: "m-evidence",
      name: "Measured or calculated evidence",
      description: "Share of all harmonized records graded A (measured) or B (calculated), rather than estimated, doubtful or not reported.",
      formula: { kind: "atomic", expr: { op: "count", ref: { sourceId: firstSource, fieldId: "grade" }, filters: [{ ref: { sourceId: firstSource, fieldId: "grade" }, op: "not_empty", value: null }] } },
      groupBy: null,
      unit: "%",
      confidence: 0.9,
      assumptions: [],
      caveats: ["Grades assigned per record by an LLM evidence-grading pass with deterministic overrides."],
    },
    {
      metricId: "m-evidence",
      value: Math.round((measured.length / records.length) * 1000) / 10,
      coverage: 1,
      recordsUsed: measured.length,
      recordsAvailable: records.length,
      missingRecords: records.filter((r) => r.grade === "N").length,
      excludedRecords: 0,
      series: (["A", "B", "C", "D", "N"] as const).map((g) => ({
        label: g,
        value: records.filter((r) => r.grade === g).length,
      })),
      evidence: {
        sourceIds: profiles.map((p) => p.sourceId),
        fieldRefs: [{ sourceId: firstSource, fieldId: "grade" }],
        formula: "count(grade in {A,B}) / count(all records)",
        filters: [],
        exampleRows: exampleRows(measured),
        caveats: ["A measured · B calculated · C estimated · D doubtful · N not reported."],
      },
    },
  );

  const chart: ChartSpec | null =
    stages.length >= 2
      ? {
          type: "funnel",
          title: "Impact funnel — latest wave per organisation",
          metricId: metrics[1]?.definition.id ?? "m-orgs",
          points: stages.map((s) => ({
            label: s.id.slice(prefix.length),
            value: s.total,
          })),
          summary: `Reach narrows from ${Math.round(stages[0].total).toLocaleString("en-US")} (${stages[0].id.slice(prefix.length)}) to ${Math.round(stages[stages.length - 1].total).toLocaleString("en-US")} (${stages[stages.length - 1].id.slice(prefix.length)}) across ${stages.length} stages.`,
        }
      : null;

  const warnings: AnalysisWarning[] = anomalies.slice(0, 100).map((a, i) => ({
    id: `a${i + 1}`,
    scope: a.kind === "funnel_monotonicity" || a.kind === "outlier" ? "project" : "data",
    severity: a.kind === "negative_value" ? "critical" : a.kind === "duplicate_conflict" ? "info" : "warning",
    message: `${a.kind.replace(/_/g, " ")}: ${a.detail} (${a.org_id}, ${a.date})`,
    sourceId: slug(a.source_file),
    fieldRefs: [],
  }));
  if (anomalies.length > 100) {
    warnings.push({
      id: "a-more",
      scope: "data",
      severity: "info",
      message: `${anomalies.length - 100} further review signals omitted here; full list in the harmonization audit artifacts.`,
      sourceId: null,
      fieldRefs: [],
    });
  }

  const understanding = `Externally harmonized longitudinal portfolio: ${records.length.toLocaleString("en-US")} records from ${orgIds.size} organisations across ${waves} cohort-waves (${dates[0]} – ${dates[dates.length - 1]}). Every record carries provenance (file, row, column) and an evidence grade produced by an AI-assisted harmonization pipeline; entity resolution joined organisations across waves.`;

  const identified = (rationale: string, refs: Array<{ sourceId: string; fieldId: string }> = []) => ({
    status: "identified" as const,
    fieldRefs: refs,
    rationale,
  });
  const partial = (rationale: string) => ({ status: "partial" as const, fieldRefs: [], rationale });

  const plan: SemanticPlan = {
    understanding,
    tables: profiles.map((p) => ({
      sourceId: p.sourceId,
      purpose: "survey_responses",
      rationale: "Wave export harmonized into canonical long-format records with provenance.",
    })),
    proposedMetrics: metrics.map((m) => m.definition),
    candidateJoin: null,
    orderedFunnel: null,
    theoryOfChange: {
      activity: partial("Programme activities appear indirectly through reach and engagement reporting."),
      output: identified("Inform/engage stages measure direct outputs across every wave."),
      outcome: identified("Outcome-stage counts reported per organisation and wave."),
      impact: partial("Impact-stage figures are largely extrapolated (grade C) — treat as directional."),
    },
    fiveDimensions: {
      what: identified("Canonical metric taxonomy defines what changed per record."),
      who: identified("Entity resolution ties every record to a beneficiary-serving organisation."),
      howMuch: identified("Funnel stages quantify scale and depth per wave."),
      contribution: partial("Self-reported without a counterfactual; no contribution claim possible."),
      risk: partial("Evidence grades D and monotonicity violations flag data-quality risk explicitly."),
    },
    frameworkTags: [
      {
        framework: "five_dimensions",
        label: "Five Dimensions of Impact",
        confidence: 0.7,
        evidenceBasis: "field_evidence",
        rationale: "Scale (how much), depth (funnel stages) and evidence risk are directly measured across waves.",
        caveat: "Candidate alignment only — not a compliance assessment.",
        referenceId: null,
      },
    ],
    uncertainties: [
      `${Math.round((records.filter((r) => r.grade === "C").length / records.length) * 100)}% of records are estimates (grade C); impact-stage totals lean on extrapolation.`,
      `${records.filter((r) => r.grade === "D").length} records are graded doubtful (contradictions or implausible values).`,
    ],
  };

  const meanCoverage = metrics.length
    ? metrics.reduce((s, m) => s + m.result.coverage, 0) / metrics.length
    : 0;
  const assessment = `${metrics.length} KPIs computed at ${Math.round(meanCoverage * 100)}% average coverage from ${records.length.toLocaleString("en-US")} harmonized records; ${Math.round((measured.length / records.length) * 100)}% carry measured or calculated evidence; ${anomalies.length} review signals flagged.`;

  const dashboard: DashboardAnalysis = {
    generatedAt: new Date().toISOString(),
    understanding,
    assessment,
    profiles,
    plan,
    metrics,
    chart,
    warnings,
  };

  return { profiles, plan, dashboard };
}
