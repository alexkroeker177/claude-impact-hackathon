/**
 * Seed-time LLM enrichment: sends one organisation's actual longitudinal
 * figures to Claude and gets back real per-dimension analysis (IMP Five
 * Dimensions) plus a headline insight — replacing the deterministic template
 * answers. Results are cached by digest hash so reseeds cost nothing.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { runClaudeStructured } from "../../src/lib/claude/run";
import type { SemanticPlan } from "../../src/lib/semantic/schema";
import type { DashboardAnalysis } from "../../src/lib/analysis/types";
import type { HarmonizedAnomaly, HarmonizedRecord } from "./harmonized";

const entrySchema = z.object({
  status: z.enum(["identified", "partial", "not_found"]),
  answer: z.string().min(1),
});

export const enrichmentSchema = z.object({
  headline: z.string().min(1),
  what: entrySchema,
  who: entrySchema,
  howMuch: entrySchema,
  contribution: entrySchema,
  risk: entrySchema,
});
export type OrgEnrichment = z.infer<typeof enrichmentSchema>;

const entryJson = {
  type: "object",
  additionalProperties: false,
  required: ["status", "answer"],
  properties: {
    status: { type: "string", enum: ["identified", "partial", "not_found"] },
    answer: { type: "string" },
  },
};

export const ENRICHMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "what", "who", "howMuch", "contribution", "risk"],
  properties: {
    headline: { type: "string" },
    what: entryJson,
    who: entryJson,
    howMuch: entryJson,
    contribution: entryJson,
    risk: entryJson,
  },
};

/** Compact per-org digest: every metric's values over time with evidence grades, plus flagged anomalies. */
export function buildOrgDigest(
  name: string,
  records: HarmonizedRecord[],
  anomalies: HarmonizedAnomaly[],
): string {
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const byMetric = new Map<string, HarmonizedRecord[]>();
  for (const r of records) {
    (byMetric.get(r.metric) ?? byMetric.set(r.metric, []).get(r.metric)!).push(r);
  }
  const lines: string[] = [];
  for (const [metric, recs] of [...byMetric.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const points = recs
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => {
        const v = typeof r.value === "number" ? r.value.toLocaleString("en-US") : String(r.value ?? r.raw_value);
        return `${r.date}=${v}${r.unit ? ` ${r.unit}` : ""} (grade ${r.grade})`;
      });
    lines.push(`${metric}: ${points.join(", ")}`);
  }
  const gradeCounts = ["A", "B", "C", "D", "N"]
    .map((g) => `${g}:${records.filter((r) => r.grade === g).length}`)
    .join(" ");

  return [
    `Organisation: ${name}`,
    `Reporting period: ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} report dates, ${records.length} figures)`,
    `Evidence grades (A measured, B calculated, C estimated, D doubtful, N not reported): ${gradeCounts}`,
    ``,
    `Figures over time:`,
    ...lines.slice(0, 60),
    ...(lines.length > 60 ? [`(${lines.length - 60} more metrics omitted)`] : []),
    ``,
    anomalies.length > 0
      ? `Automated checks flagged:\n${anomalies.map((a) => `- ${a.kind}: ${a.detail} (${a.date})`).join("\n")}`
      : `Automated checks flagged nothing.`,
  ].join("\n");
}

export function digestHash(digest: string): string {
  return createHash("sha1").update(digest).digest("hex");
}

const SYSTEM = `You are an impact analyst writing for a busy programme manager with no statistics background. You are given one social enterprise's self-reported impact figures over time, with evidence grades and automated data-quality flags.

Answer the IMP Five Dimensions of Impact questions about THIS organisation:
- what: What changed? (the actual outcome the organisation is driving, read from what its metrics measure)
- who: Who was affected? (the people/communities behind the numbers, as far as the data shows)
- howMuch: How big was the change? (real magnitudes AND the trend over time — growth, decline, stagnation between report dates)
- contribution: Would it have happened anyway? (what the data can and cannot say about causation)
- risk: How solid is the evidence? (grades, contradictions, flags — and what that means for trusting the numbers)

Rules:
- Every answer must be grounded in the supplied figures. Quote real numbers and dates. Never invent data.
- Extract insight, not metadata: trends, jumps, drops, suspicious patterns, funnel conversion — the things a manager would act on.
- 1–3 plain sentences per answer. No jargon, no percentages without saying what they mean.
- status: "identified" when the data genuinely answers the question, "partial" when only partly, "not_found" when it can't.
- headline: the single most valuable insight about this organisation in one sentence (lead with the number).`;

export async function enrichOrg(digest: string): Promise<OrgEnrichment> {
  return runClaudeStructured({
    system: SYSTEM,
    prompt: digest,
    jsonSchema: ENRICHMENT_JSON_SCHEMA,
    validate: (raw) => enrichmentSchema.parse(raw),
    maxTokens: 2000,
    model: process.env.CLAUDE_ENRICH_MODEL || "claude-sonnet-5",
  });
}

/** Overwrites the plan's template dimension answers with the LLM analysis and prepends the headline insight. */
export function applyEnrichment(plan: SemanticPlan, dashboard: DashboardAnalysis, enrichment: OrgEnrichment): void {
  const keys = ["what", "who", "howMuch", "contribution", "risk"] as const;
  for (const key of keys) {
    plan.fiveDimensions[key] = {
      status: enrichment[key].status,
      fieldRefs: plan.fiveDimensions[key].fieldRefs,
      rationale: enrichment[key].answer,
    };
  }
  dashboard.assessment = `${enrichment.headline} ${dashboard.assessment}`;
}
