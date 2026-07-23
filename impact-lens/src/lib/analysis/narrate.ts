import { z } from "zod";

import { runClaudeStructured } from "@/lib/claude/run";
import type { SemanticPlan } from "@/lib/semantic/schema";
import type { AnalysisWarning, ChartSpec, DashboardAnalysis } from "@/lib/analysis/types";

const narrativeSchema = z.object({
  assessment: z.string().min(1),
  insights: z
    .array(
      z.object({
        tone: z.enum(["good", "watch", "problem"]),
        text: z.string().min(1),
      }),
    )
    .max(5),
});

export type Narrative = z.infer<typeof narrativeSchema>;

const NARRATIVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assessment", "insights"],
  properties: {
    assessment: {
      type: "string",
      description:
        "2-3 sentences answering: what does this data actually say about the programme? Honest, plain language, cites the concrete computed figures.",
    },
    insights: {
      type: "array",
      description: "3-4 takeaways, most important first.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "text"],
        properties: {
          tone: { type: "string", enum: ["good", "watch", "problem"] },
          text: {
            type: "string",
            description: "One or two sentences. Concrete, decision-relevant, cites a number from the packet.",
          },
        },
      },
    },
  },
} as const;

const NARRATE_SYSTEM_PROMPT = `You write the headline reading of an impact dashboard for a programme manager at a social enterprise or NGO. They are smart but not a data analyst, and they will make real decisions based on what you write.

GROUNDING RULES (hard):
- Use ONLY the numbers, warnings and dimension answers in the packet. Never invent, extrapolate or forecast a figure.
- Every quantitative claim must trace to a packet value. Round for readability ("about 42,000") but never change magnitude.
- If the data is thin or contradictory, SAY SO plainly — an honest "this doesn't show impact yet" is more valuable than optimism.

STYLE RULES:
- Plain, direct language. No analyst jargon: say "figures we could actually read" not "coverage"; say "the numbers don't add up" not "monotonicity violation".
- Answer the manager's real questions: Is this working? How many people did we actually help? What should I check or do next?
- Each insight should change what the reader does: verify a figure, celebrate a result, collect missing data, question a claim.
- Lead with the most decision-relevant point. Mix of tones when honest: use "good" only for genuinely solid results, "problem" for anything that must be fixed before the numbers can be trusted.
- The funnel story (reach at the top vs. lasting impact at the bottom, and the drop between stages) is usually the most valuable insight when a funnel chart exists.
- Mention people, not rows: "9 enterprises reported", "about 26,000 people took part".

ASSESSMENT: 2-3 sentences. First sentence = the single most important thing this data says. Then the biggest caveat, if any.`;

function warningDigest(warnings: AnalysisWarning[]): Array<{ severity: string; message: string }> {
  return warnings
    .filter((w) => w.severity !== "info")
    .slice(0, 12)
    .map((w) => ({ severity: w.severity, message: w.message }));
}

function buildNarratePacket(args: {
  projectName: string;
  goal: string;
  understanding: string;
  metrics: DashboardAnalysis["metrics"];
  chart: ChartSpec | null;
  warnings: AnalysisWarning[];
  plan: SemanticPlan;
}): string {
  return JSON.stringify({
    project: { name: args.projectName, goal: args.goal },
    whatTheDataIs: args.understanding,
    computedFigures: args.metrics.map(({ definition, result }) => ({
      name: definition.name,
      value: result.value,
      unit: definition.unit,
      howComputed: result.evidence.formula,
      recordsUsed: result.recordsUsed,
      recordsAvailable: result.recordsAvailable,
      caveats: result.evidence.caveats.slice(0, 6),
    })),
    chart: args.chart
      ? { type: args.chart.type, title: args.chart.title, points: args.chart.points }
      : null,
    dataQualityFlags: warningDigest(args.warnings),
    fiveDimensions: Object.fromEntries(
      Object.entries(args.plan.fiveDimensions).map(([k, v]) => [k, { status: v.status, answer: v.rationale }]),
    ),
    uncertainties: args.plan.uncertainties.slice(0, 8),
  });
}

export async function narrateDashboard(args: {
  projectName: string;
  goal: string;
  understanding: string;
  metrics: DashboardAnalysis["metrics"];
  chart: ChartSpec | null;
  warnings: AnalysisWarning[];
  plan: SemanticPlan;
}): Promise<Narrative> {
  return runClaudeStructured({
    system: NARRATE_SYSTEM_PROMPT,
    prompt: `Write the assessment and insights for this dashboard. Return only the JSON object.

${buildNarratePacket(args)}`,
    jsonSchema: NARRATIVE_JSON_SCHEMA,
    validate: (raw) => narrativeSchema.parse(raw),
    model: "claude-opus-4-8",
    maxTokens: 4000,
  });
}
