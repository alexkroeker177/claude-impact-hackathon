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

export interface OrgRegistryEntry {
  org_id: string;
  canonical_name: string;
  aliases: string[];
  people: string[];
  email_domains: string[];
  cohorts: string[];
  country: string | null;
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
  opts: {
    projectName: string;
    funnelPrefix?: string;
    scope?: "portfolio" | "org";
    /** Canonical funnel-stage order (metric ids minus prefix). Stages not listed sort last by size. */
    stageOrder?: string[];
  } = { projectName: "Harmonized portfolio" },
): { profiles: SourceProfile[]; plan: SemanticPlan; dashboard: DashboardAnalysis } {
  const prefix = opts.funnelPrefix ?? "funnel.";
  const scope = opts.scope ?? "portfolio";
  const profiles = buildProfiles(records);
  const firstSource = profiles[0]?.sourceId ?? "unknown";
  const orgIds = new Set(records.map((r) => r.org_id));
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const waves = new Set(records.map((r) => `${r.cohort}|${r.wave}`)).size;
  const measured = records.filter((r) => r.grade === "A" || r.grade === "B");
  const measuredPct = Math.round((measured.length / records.length) * 100);
  const scopeWord = scope === "org" ? "this organisation" : "the portfolio";
  const perWord = scope === "org" ? "per wave" : "per organisation";

  // Funnel stages discovered by prefix. Ordered canonically when a stage order is
  // supplied (so the chart reads top-of-funnel -> deepest), else by descending total.
  const stageIds = [...new Set(records.filter((r) => r.metric.startsWith(prefix) && !r.metric.includes(".", prefix.length)).map((r) => r.metric))];
  const orderIndex = (id: string): number => {
    const idx = (opts.stageOrder ?? []).indexOf(id.slice(prefix.length));
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const stages = stageIds
    .map((id) => ({ id, ...latestSum(records, id) }))
    .filter((s) => s.orgs > 0)
    .sort((a, b) => orderIndex(a.id) - orderIndex(b.id) || b.total - a.total);

  const metrics: Array<{ definition: MetricDefinition; result: MetricResult }> = [];

  const pushMetric = (
    definition: MetricDefinition,
    result: MetricResult,
  ) => metrics.push({ definition, result });

  // KPI 1: organisations tracked — only meaningful at portfolio scope
  if (scope === "portfolio") {
    pushMetric(
      {
        id: "m-orgs",
        name: "Organisations tracked",
        description: "How many different organisations appear in this data, after matching up name variations across files.",
        howCalculated:
          "Every record was matched to an organisation using names, contact people and email domains, then the distinct organisations were counted.",
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
  }

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
          name: i === 0 ? "People reached" : "Deepest impact",
          description:
            i === 0
              ? `How many people ${scopeWord} reached at the widest point of its work (the “${pretty}” stage), per the most recent report.`
              : `How many people reached the deepest stage of change reported (“${pretty}”) — the strongest impact ${scopeWord} claims.`,
          howCalculated: `Takes the most recent “${pretty}” figure reported ${perWord}${
            scope === "portfolio" ? " and adds them up across organisations" : ""
          }. The number is used exactly as reported — nothing is modelled or extrapolated.`,
          formula: { kind: "atomic", expr: { op: "sum", ref, filters: [] } },
          groupBy: null,
          unit: "people",
          confidence: 0.8,
          assumptions: [`Latest wave ${perWord} reflects current cumulative reach.`],
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
            formula: `sum(latest ${stage.id} ${perWord})`,
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
      name: "Data reliability",
      description:
        "How much of this data you can actually trust: the share of figures that were properly measured or calculated, rather than estimated or guessed.",
      howCalculated: `Every figure was graded for how it was obtained: A = measured, B = calculated from measurements, C = estimated, D = doubtful, N = not reported. This is the share graded A or B (${measured.length.toLocaleString(
        "en-US",
      )} of ${records.length.toLocaleString("en-US")} figures).`,
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

  const prettyStage = (id: string) => {
    const label = id.slice(prefix.length);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const funnelBroken = stages.some((s, i) => i > 0 && s.total > stages[i - 1].total);
  const chart: ChartSpec | null =
    stages.length >= 2
      ? {
          type: "funnel",
          title: "From first contact to lasting change",
          metricId: metrics[1]?.definition.id ?? "m-orgs",
          points: stages.map((s) => ({
            label: prettyStage(s.id),
            value: s.total,
          })),
          summary: funnelBroken
            ? `Something is off: a later stage reports more people than an earlier one — usually a reporting error, not real growth. See “Needs review”.`
            : `${Math.round(stages[0].total).toLocaleString("en-US")} people were reached at the “${prettyStage(stages[0].id)}” stage; ${Math.round(stages[stages.length - 1].total).toLocaleString("en-US")} made it to “${prettyStage(stages[stages.length - 1].id)}”, the deepest stage of change.`,
        }
      : null;

  // Anomalies from the harmonization audit, rewritten as plain-language review items.
  const humanize = (a: HarmonizedAnomaly): { severity: AnalysisWarning["severity"]; message: string } => {
    const where = `${a.source_file}, ${a.date}`;
    switch (a.kind) {
      case "funnel_monotonicity":
        return {
          severity: "warning",
          message: `Numbers don't add up: ${a.detail}. A later stage should never exceed an earlier one — likely a reporting or unit mix-up. Check ${where}.`,
        };
      case "outlier":
        return {
          severity: "warning",
          message: `Unusually large value: ${a.detail}. Worth double-checking against the source (${where}).`,
        };
      case "negative_value":
        return {
          severity: "critical",
          message: `Impossible figure: ${a.detail}. Counts can't be negative — this needs correcting (${where}).`,
        };
      case "duplicate_conflict":
        return {
          severity: "info",
          message: `Two files disagree: ${a.detail}. The better-documented value was kept (${where}).`,
        };
      case "parse_failure":
        return {
          severity: "warning",
          message: `A value couldn't be read: ${a.detail} (${where}).`,
        };
      default:
        return { severity: "warning", message: `${a.kind.replace(/_/g, " ")}: ${a.detail} (${where}).` };
    }
  };
  const warnings: AnalysisWarning[] = anomalies.slice(0, 100).map((a, i) => {
    const { severity, message } = humanize(a);
    return {
      id: `a${i + 1}`,
      scope: a.kind === "funnel_monotonicity" || a.kind === "outlier" ? "project" : "data",
      severity,
      message: scope === "org" ? message : `${message.slice(0, -1)} — ${a.org_id}.`,
      sourceId: slug(a.source_file),
      fieldRefs: [],
    };
  });
  if (anomalies.length > 100) {
    warnings.push({
      id: "a-more",
      scope: "data",
      severity: "info",
      message: `${anomalies.length - 100} more review items not shown here — the full list is in the harmonization audit.`,
      sourceId: null,
      fieldRefs: [],
    });
  }

  const understanding =
    scope === "org"
      ? `Externally harmonized longitudinal record for ${opts.projectName}: ${records.length.toLocaleString("en-US")} data points across ${waves} wave(s) (${dates[0]} – ${dates[dates.length - 1]}). Every record carries provenance (file, row, column) and an evidence grade produced by an AI-assisted harmonization pipeline; entity resolution joined this organisation's records across waves.`
      : `Externally harmonized longitudinal portfolio: ${records.length.toLocaleString("en-US")} records from ${orgIds.size} organisations across ${waves} cohort-waves (${dates[0]} – ${dates[dates.length - 1]}). Every record carries provenance (file, row, column) and an evidence grade produced by an AI-assisted harmonization pipeline; entity resolution joined organisations across waves.`;

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
      what: identified(
        stages.length >= 2
          ? `People progressing through a ${stages.length}-stage journey, from “${prettyStage(stages[0].id)}” (first contact) to “${prettyStage(stages[stages.length - 1].id)}” (deepest change), alongside team and finance figures.`
          : "Reported programme figures (reach, team, finances) — but no staged journey from contact to change was reported.",
      ),
      who: identified(
        scope === "org"
          ? `All ${records.length.toLocaleString("en-US")} figures belong to ${opts.projectName}, matched across name variations in ${profiles.length} file${profiles.length === 1 ? "" : "s"}.`
          : `${orgIds.size} beneficiary-serving organisations, matched across name variations, contact people and email domains in every file.`,
      ),
      howMuch:
        stages.length >= 2
          ? identified(
              funnelBroken
                ? `The latest report claims ${Math.round(stages[0].total).toLocaleString("en-US")} people at the widest stage — but the stage numbers contradict each other, so treat the scale as unverified.`
                : `${Math.round(stages[0].total).toLocaleString("en-US")} people at the widest stage and ${Math.round(stages[stages.length - 1].total).toLocaleString("en-US")} at the deepest, per the latest report.`,
            )
          : partial("Not enough funnel stages were reported to quantify scale and depth."),
      contribution: partial(
        "Unknown. Everything is self-reported with no comparison group, so the data can't show whether these changes would have happened anyway.",
      ),
      risk: partial(
        `${measuredPct}% of figures were properly measured or calculated${
          anomalies.length > 0
            ? `, and ${anomalies.length} figure${anomalies.length === 1 ? " is" : "s are"} flagged for review — check those before relying on the totals`
            : ", and nothing was flagged for review"
        }.`,
      ),
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

  const reachSentence =
    stages.length >= 2
      ? funnelBroken
        ? " Its funnel numbers contradict each other — a later stage reports more people than an earlier one, which points to a reporting error."
        : ` It reached ${Math.round(stages[0].total).toLocaleString("en-US")} people at its widest and ${Math.round(stages[stages.length - 1].total).toLocaleString("en-US")} at its deepest stage of change.`
      : "";
  const issueSentence =
    anomalies.length === 0
      ? " No data-quality issues were found."
      : ` ${anomalies.length} figure${anomalies.length === 1 ? "" : "s"} need${anomalies.length === 1 ? "s" : ""} a closer look — see “Needs review”.`;
  const assessment =
    scope === "org"
      ? `This organisation reported ${records.length.toLocaleString("en-US")} figures across ${waves} reporting wave${waves === 1 ? "" : "s"} (${dates[0]} – ${dates[dates.length - 1]}).${reachSentence} ${measuredPct}% of its figures were properly measured or calculated rather than estimated.${issueSentence}`
      : `${orgIds.size} organisations reported ${records.length.toLocaleString("en-US")} figures between ${dates[0]} and ${dates[dates.length - 1]}.${reachSentence} ${measuredPct}% of all figures were properly measured or calculated rather than estimated.${issueSentence}`;

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

export interface OrgProject {
  orgId: string;
  projectName: string;
  cohorts: string[];
  profiles: SourceProfile[];
  plan: SemanticPlan;
  dashboard: DashboardAnalysis;
}

/**
 * Splits a harmonized long table into one independent project per organisation
 * — each with its own profiles/plan/dashboard, scoped to just that org's rows
 * (and the anomalies that reference it). No dataset-specific logic: grouping
 * is by the generic org_id field the published contract already carries.
 */
export function mapHarmonizedByOrg(
  records: HarmonizedRecord[],
  anomalies: HarmonizedAnomaly[],
  registry: OrgRegistryEntry[] = [],
  opts: { funnelPrefix?: string; stageOrder?: string[] } = {},
): OrgProject[] {
  const nameById = new Map(registry.map((o) => [o.org_id, o.canonical_name]));
  const cohortsById = new Map(registry.map((o) => [o.org_id, o.cohorts]));

  const byOrg = new Map<string, HarmonizedRecord[]>();
  for (const r of records) {
    (byOrg.get(r.org_id) ?? byOrg.set(r.org_id, []).get(r.org_id)!).push(r);
  }

  const projects: OrgProject[] = [];
  for (const [orgId, orgRecords] of byOrg) {
    const projectName = nameById.get(orgId) ?? orgId;
    const orgAnomalies = anomalies.filter((a) => a.org_id === orgId);
    const { profiles, plan, dashboard } = mapHarmonized(orgRecords, orgAnomalies, {
      projectName,
      funnelPrefix: opts.funnelPrefix,
      stageOrder: opts.stageOrder,
      scope: "org",
    });
    projects.push({
      orgId,
      projectName,
      cohorts: cohortsById.get(orgId) ?? [...new Set(orgRecords.map((r) => r.cohort))],
      profiles,
      plan,
      dashboard,
    });
  }
  return projects.sort((a, b) => a.projectName.localeCompare(b.projectName));
}
