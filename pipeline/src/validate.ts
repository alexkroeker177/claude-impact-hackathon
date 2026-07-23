import { claudeJson } from "./claude";
import type { Anomaly, Grade, HarmonizedRecord } from "./types";

const FUNNEL_ORDER = ["funnel.inform", "funnel.engage", "funnel.outcomes", "funnel.impact", "funnel.societal"];

/** S5a — deterministic validation. Anomalies are dashboard content, not just QA. */
export function runValidations(records: HarmonizedRecord[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // funnel monotonicity per org × date: inform ≥ engage ≥ outcomes ≥ impact ≥ societal
  const funnelGroups = new Map<string, Map<string, HarmonizedRecord>>();
  for (const r of records) {
    if (!FUNNEL_ORDER.includes(r.metric) || typeof r.value !== "number") continue;
    const key = `${r.org_id}|${r.date}`;
    if (!funnelGroups.has(key)) funnelGroups.set(key, new Map());
    funnelGroups.get(key)!.set(r.metric, r);
  }
  for (const [key, group] of funnelGroups) {
    const [org_id, date] = key.split("|");
    const present = FUNNEL_ORDER.filter((m) => group.has(m));
    for (let i = 1; i < present.length; i++) {
      const upper = group.get(present[i - 1])!;
      const lower = group.get(present[i])!;
      if ((lower.value as number) > (upper.value as number)) {
        anomalies.push({
          kind: "funnel_monotonicity",
          org_id,
          date,
          detail: `${present[i]} (${lower.value}) exceeds ${present[i - 1]} (${upper.value}) — funnel must be non-increasing`,
          metrics: [present[i - 1], present[i]],
          source_file: lower.source_file,
        });
        for (const rec of [upper, lower]) {
          rec.grade = "D";
          rec.grade_reason = "Funnel monotonicity violation";
        }
      }
    }
  }

  // negative values where impossible
  for (const r of records) {
    if (typeof r.value === "number" && r.value < 0 && (r.type === "count" || r.type === "months" || r.type === "percent")) {
      anomalies.push({
        kind: "negative_value",
        org_id: r.org_id,
        date: r.date,
        detail: `${r.metric} = ${r.value} (raw "${r.raw_value}")`,
        metrics: [r.metric],
        source_file: r.source_file,
      });
      r.grade = "D";
      r.grade_reason = "Impossible negative value";
    }
  }

  // count outliers: >10× cohort median for the same metric
  const byMetricCohort = new Map<string, HarmonizedRecord[]>();
  for (const r of records) {
    if (r.type !== "count" || typeof r.value !== "number") continue;
    const key = `${r.metric}|${r.cohort}`;
    (byMetricCohort.get(key) ?? byMetricCohort.set(key, []).get(key)!).push(r);
  }
  for (const [key, group] of byMetricCohort) {
    if (group.length < 4) continue;
    const sorted = group.map((r) => r.value as number).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median <= 0) continue;
    for (const r of group) {
      if ((r.value as number) > median * 10) {
        anomalies.push({
          kind: "outlier",
          org_id: r.org_id,
          date: r.date,
          detail: `${r.metric} = ${r.value} is >10× cohort median (${median})`,
          metrics: [r.metric],
          source_file: r.source_file,
        });
      }
    }
  }

  // duplicate org × date × metric with conflicting values
  const seen = new Map<string, HarmonizedRecord>();
  for (const r of records) {
    if (typeof r.value !== "number") continue;
    const key = `${r.org_id}|${r.date}|${r.metric}`;
    const prior = seen.get(key);
    if (prior && prior.value !== r.value && prior.source_file !== r.source_file) {
      anomalies.push({
        kind: "duplicate_conflict",
        org_id: r.org_id,
        date: r.date,
        detail: `${r.metric}: ${prior.value} (${prior.source_file}) vs ${r.value} (${r.source_file})`,
        metrics: [r.metric],
        source_file: r.source_file,
      });
    }
    seen.set(key, r);
  }

  return anomalies;
}

const GRADES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grades"],
  properties: {
    grades: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "grade", "reason"],
        properties: {
          id: { type: "string" },
          grade: { type: "string", enum: ["A", "B", "C", "D"] },
          reason: { type: "string" },
        },
      },
    },
  },
};

/** S5b — Claude grades each reach/funnel number by reading the founder's own "how calculated" text. */
export async function gradeMethodologies(records: HarmonizedRecord[]): Promise<Map<string, { grade: Grade; reason: string }>> {
  // pair each gradeable count with its sibling methodology text (same org+date, metric = <base>.methodology)
  const methodologyTexts = new Map<string, string>();
  for (const r of records) {
    if (r.metric.endsWith(".methodology") && typeof r.value === "string") {
      methodologyTexts.set(`${r.org_id}|${r.date}|${r.metric.replace(/\.methodology$/, "")}`, r.value);
    }
  }
  const items: { id: string; metric: string; value: number; methodology: string }[] = [];
  for (const r of records) {
    if (r.type !== "count" || typeof r.value !== "number") continue;
    const methodology = methodologyTexts.get(`${r.org_id}|${r.date}|${r.metric}`);
    if (!methodology) continue;
    items.push({ id: `${r.org_id}|${r.date}|${r.metric}`, metric: r.metric, value: r.value, methodology });
  }
  if (items.length === 0) return new Map();

  const system = `You grade the evidential quality of self-reported impact numbers from social enterprises, using the founder's own description of how the number was produced. Grades:
A = measured — based on records, registrations, transaction counts, verified data
B = calculated — a stated, reasonable calculation from concrete inputs
C = estimated — extrapolation, multipliers, assumptions (e.g. "each child shares with 3-4 family members"), vague sourcing
D = contradicted — the methodology contradicts the number, is circular, or clearly implausible
Be strict: household multipliers, "we assume", and verbal feedback as evidence are C. Reason: one short sentence.`;

  const results = new Map<string, { grade: Grade; reason: string }>();
  const CHUNK = 25;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const { grades } = await claudeJson<{ grades: { id: string; grade: Grade; reason: string }[] }>({
      system,
      prompt: `Grade each item:\n${JSON.stringify(chunk, null, 1)}`,
      schema: GRADES_SCHEMA,
      maxTokens: 8000,
    });
    for (const g of grades) results.set(g.id, { grade: g.grade, reason: g.reason });
  }
  return results;
}

/** Apply Claude grades, but deterministic downgrades (monotonicity D, prose C) keep precedence. */
export function applyGrades(records: HarmonizedRecord[], grades: Map<string, { grade: Grade; reason: string }>) {
  for (const r of records) {
    const g = grades.get(`${r.org_id}|${r.date}|${r.metric}`);
    if (!g) continue;
    if (r.grade === "D") continue; // deterministic hard-fail wins
    if (r.grade_reason === null) {
      // plain default grade → Claude's judgment replaces it in either direction
      r.grade = g.grade;
      r.grade_reason = g.reason;
    } else {
      // deterministic cap (prose extraction etc.) → can only get worse, never better
      r.grade = g.grade > r.grade ? g.grade : r.grade;
      r.grade_reason = `${r.grade_reason}; ${g.reason}`;
    }
  }
}
