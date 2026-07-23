import { runClaudeStructured } from "@/lib/claude/run";
import type { ParsedTable, SourceProfile } from "@/lib/files/types";
import { semanticPlanSchema, type SemanticPlan } from "@/lib/semantic/schema";
import { pruneSemanticPlan } from "@/lib/semantic/validate";

export interface InterpretProjectInput {
  projectName: string;
  goal: string;
  attention: string | null;
  profiles: SourceProfile[];
  /** Raw parsed rows — when present, actual data (capped) is shown to Claude, not just column statistics. */
  tables?: ParsedTable[] | null;
}

/* ------------------------------------------------------------------ */
/* Hand-written JSON Schema mirroring semanticPlanSchema.             */
/* Structured-outputs rules: every property required,                 */
/* additionalProperties:false everywhere, nullable via type arrays /  */
/* anyOf-with-null. Zod-only constraints (min/max, array lengths) are */
/* enforced after parsing.                                            */
/* ------------------------------------------------------------------ */

const fieldRefJson = {
  type: "object",
  additionalProperties: false,
  required: ["sourceId", "fieldId"],
  properties: {
    sourceId: { type: "string", description: "Must be a sourceId from the provided profiles." },
    fieldId: { type: "string", description: "Must be a fieldId from that source's profile." },
  },
} as const;

const metricFilterJson = {
  type: "object",
  additionalProperties: false,
  required: ["ref", "op", "value"],
  properties: {
    ref: fieldRefJson,
    op: { type: "string", enum: ["equals", "not_empty"] },
    value: {
      type: ["string", "null"],
      description: "Required for op=equals, null for op=not_empty.",
    },
  },
} as const;

const atomicExprJson = {
  type: "object",
  additionalProperties: false,
  required: ["op", "ref", "filters"],
  properties: {
    op: { type: "string", enum: ["count", "distinct_count", "sum", "average"] },
    ref: {
      anyOf: [fieldRefJson, { type: "null" }],
      description: "Field the op reads. Null only for op=count (row count after filters).",
    },
    filters: { type: "array", items: metricFilterJson },
  },
} as const;

const formulaJson = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "expr"],
      properties: {
        kind: { const: "atomic" },
        expr: atomicExprJson,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "numerator", "denominator"],
      properties: {
        kind: { const: "ratio" },
        numerator: atomicExprJson,
        denominator: atomicExprJson,
      },
    },
  ],
} as const;

const metricDefinitionJson = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "description", "howCalculated", "formula", "groupBy", "unit", "confidence", "assumptions", "caveats"],
  properties: {
    id: { type: "string", description: "Stable slug id, e.g. 'm1_reach'." },
    name: { type: "string" },
    description: { type: "string" },
    howCalculated: {
      type: ["string", "null"],
      description:
        "1-2 plain sentences a non-analyst can read: which column(s) are combined and how, naming them in quotes. No formula jargon.",
    },
    formula: formulaJson,
    groupBy: {
      anyOf: [fieldRefJson, { type: "null" }],
      description: "Optional single group-by field producing a series; null otherwise.",
    },
    unit: { type: ["string", "null"] },
    confidence: { type: "number", description: "Confidence between 0 and 1." },
    assumptions: { type: "array", items: { type: "string" } },
    caveats: { type: "array", items: { type: "string" } },
  },
} as const;

const frameworkTagJson = {
  type: "object",
  additionalProperties: false,
  required: ["framework", "label", "confidence", "evidenceBasis", "rationale", "caveat", "referenceId"],
  properties: {
    framework: {
      type: "string",
      enum: ["five_dimensions", "sdg", "iris_plus", "esg", "triple_bottom_line"],
    },
    label: { type: "string" },
    confidence: { type: "number", description: "Confidence between 0 and 1." },
    evidenceBasis: { type: "string", enum: ["project_context", "field_evidence", "user_supplied"] },
    rationale: { type: "string" },
    caveat: { type: "string" },
    referenceId: {
      type: ["string", "null"],
      description:
        "Official indicator/metric code. MUST be null unless the user context literally supplied the code.",
    },
  },
} as const;

const coverageEntryJson = {
  type: "object",
  additionalProperties: false,
  required: ["status", "fieldRefs", "rationale"],
  properties: {
    status: { type: "string", enum: ["identified", "partial", "not_found"] },
    fieldRefs: { type: "array", items: fieldRefJson },
    rationale: { type: "string" },
  },
} as const;

export function buildPlanJsonSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "understanding",
      "tables",
      "proposedMetrics",
      "candidateJoin",
      "orderedFunnel",
      "theoryOfChange",
      "fiveDimensions",
      "frameworkTags",
      "uncertainties",
    ],
    properties: {
      understanding: {
        type: "string",
        description: "Plain-language summary of what this project's data represents.",
      },
      tables: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceId", "purpose", "rationale"],
          properties: {
            sourceId: { type: "string" },
            purpose: {
              type: "string",
              enum: ["survey_responses", "financials", "activity_log", "reference", "aggregate_report", "other"],
            },
            rationale: { type: "string" },
          },
        },
      },
      proposedMetrics: {
        type: "array",
        items: metricDefinitionJson,
        description: "At most 4 KPIs.",
      },
      candidateJoin: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "left", "right", "rationale"],
            properties: {
              id: { type: "string" },
              left: fieldRefJson,
              right: fieldRefJson,
              rationale: { type: "string" },
            },
          },
          { type: "null" },
        ],
      },
      orderedFunnel: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["sourceId", "stages", "rationale"],
            properties: {
              sourceId: { type: "string" },
              stages: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["fieldId", "label"],
                  properties: {
                    fieldId: { type: "string" },
                    label: { type: "string" },
                  },
                },
                description: "At least 2 ordered stages, reach -> outcome.",
              },
              rationale: { type: "string" },
            },
          },
          { type: "null" },
        ],
      },
      theoryOfChange: {
        type: "object",
        additionalProperties: false,
        required: ["activity", "output", "outcome", "impact"],
        properties: {
          activity: coverageEntryJson,
          output: coverageEntryJson,
          outcome: coverageEntryJson,
          impact: coverageEntryJson,
        },
      },
      fiveDimensions: {
        type: "object",
        additionalProperties: false,
        required: ["what", "who", "howMuch", "contribution", "risk"],
        properties: {
          what: coverageEntryJson,
          who: coverageEntryJson,
          howMuch: coverageEntryJson,
          contribution: coverageEntryJson,
          risk: coverageEntryJson,
        },
      },
      frameworkTags: { type: "array", items: frameworkTagJson },
      uncertainties: { type: "array", items: { type: "string" } },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Normalization for Zod-only constraints the wire schema can't carry. */
/* ------------------------------------------------------------------ */

function clamp01(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return Math.min(1, Math.max(0, value));
}

function normalizeWirePlan(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const plan = { ...(raw as Record<string, unknown>) };

  if (Array.isArray(plan.proposedMetrics)) {
    plan.proposedMetrics = plan.proposedMetrics.slice(0, 4).map((metric) => {
      if (!metric || typeof metric !== "object") return metric;
      return { ...(metric as Record<string, unknown>), confidence: clamp01((metric as Record<string, unknown>).confidence) };
    });
  }
  if (Array.isArray(plan.frameworkTags)) {
    plan.frameworkTags = plan.frameworkTags.map((tag) => {
      if (!tag || typeof tag !== "object") return tag;
      return { ...(tag as Record<string, unknown>), confidence: clamp01((tag as Record<string, unknown>).confidence) };
    });
  }
  const funnel = plan.orderedFunnel as { stages?: unknown } | null | undefined;
  if (funnel && (!Array.isArray(funnel.stages) || funnel.stages.length < 2)) {
    plan.orderedFunnel = null;
  }
  return plan;
}

/* ------------------------------------------------------------------ */
/* Prompt assembly                                                     */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are a senior impact-measurement analyst. You interpret messy real-world impact data (surveys, spreadsheets, activity logs) for social enterprises and turn it into a rigorous, honest semantic plan.

Hard rules:
- You may ONLY reference sourceId/fieldId pairs that appear in the provided data profiles. Never invent sources or fields.
- Propose AT MOST 4 KPIs. Each formula must be computable with the constrained formula language: a single atomic op (count, distinct_count, sum, average) with optional equals/not_empty filters, or one ratio of two such atomics. Nothing else.
- "count" is the only op allowed a null ref (row count after filters); the other ops must read a concrete field.
- Identify each table's purpose (survey_responses, financials, activity_log, reference, aggregate_report, other).
- Assess Theory-of-Change coverage (activity, output, outcome, impact) and IMP Five Dimensions coverage (what, who, howMuch, contribution, risk). For each, report status identified/partial/not_found with supporting fieldRefs and a rationale. Write each Five Dimensions rationale as a direct, plain-language ANSWER to the dimension's question (What changed? Who was affected? How big was the change? Would it have happened anyway? How solid is the evidence?) based on what the fields show — one or two sentences a non-analyst can read, naming concrete columns or groups rather than describing coverage abstractly. Use not_found with empty fieldRefs when the data simply does not cover a stage — do not stretch.
- Framework tags (SDG, IRIS+, ESG, five dimensions, triple bottom line) are CANDIDATE interpretations only — never compliance claims. Phrase rationale and caveat accordingly. referenceId MUST be null unless the user context literally supplied an official indicator code; you must never propose official codes yourself.
- If a single table contains an ordered same-table funnel (stages like reach -> engage -> outcome), set orderedFunnel with the stage fields in order; otherwise null.
- If two tables share a plausible join key (e.g. beneficiary id across waves), set candidateJoin; otherwise null.
- Be explicit about uncertainties: list every material assumption, data-quality concern, and ambiguity in the uncertainties array.
- Prefer honest, conservative confidence values over optimistic ones.

Working with the data:
- When rawRows are provided for a source, READ THEM. Base every choice (which column a metric reads, funnel stage order, join keys, dimension answers) on the actual values, not just headers. Surveys often carry near-duplicate columns for the same question ("as of October 2024" vs. current) — pick the one whose raw values are more complete and more recent, and say so in assumptions.
- Choose KPIs that answer the user's stated goal first; the best 3-4 beat an exhaustive list. Prefer people-counting and outcome metrics over administrative ones.
- For every metric, write howCalculated: 1-2 plain sentences naming the column(s) in quotes and what is done with them ("Adds up the answers to 'How many people...' across all 9 enterprises"). A programme manager must understand it without seeing the formula.
- Expect messy cells (currency tokens, "800 agents", "N/A", European number formats). Do not exclude a column just because it is messy — a later computation step normalizes cell-by-cell. Note the messiness in caveats instead.
- The understanding field should read like a colleague's briefing: what this data is, who filled it in, when, and what it can and cannot tell you.`;

function buildPacket(input: InterpretProjectInput): string {
  return JSON.stringify(
    {
      project: {
        name: input.projectName,
        goal: input.goal,
        attention: input.attention,
      },
      sources: input.profiles.map((profile) => ({
        sourceId: profile.sourceId,
        fileName: profile.fileName,
        sheetName: profile.sheetName,
        rowCount: profile.rowCount,
        parseWarnings: profile.parseWarnings,
        fields: profile.fields.map((field) => ({
          fieldId: field.fieldId,
          header: field.header,
          inferredType: field.inferredType,
          nullRate: Number(field.nullRate.toFixed(3)),
          uniqueCount: field.uniqueCount,
          numericRange: field.numericRange,
          samples: field.samples,
          mixedTypes: field.mixedTypes,
        })),
        rawRows: rawRowsFor(profile.sourceId, input.tables ?? null),
      })),
    },
    null,
    1,
  );
}

const MAX_RAW_ROWS = 40;
const MAX_RAW_CELL_CHARS = 160;

/** Real row data (capped) keyed by fieldId, so Claude reasons over actual values, not just column stats. */
function rawRowsFor(
  sourceId: string,
  tables: ParsedTable[] | null,
): { totalRows: number; shown: number; rows: Array<{ rowNumber: number; values: Record<string, string> }> } | null {
  const table = tables?.find((t) => t.sourceId === sourceId);
  if (!table) return null;
  const rows = table.rows.slice(0, MAX_RAW_ROWS).map((row) => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(
      table.fields.map((f) => [f.id, String(row.values[f.id] ?? "").slice(0, MAX_RAW_CELL_CHARS)]),
    ),
  }));
  return { totalRows: table.rows.length, shown: rows.length, rows };
}

export async function interpretProject(input: InterpretProjectInput): Promise<SemanticPlan> {
  const prompt = `Interpret the following impact-data project and produce the semantic plan.\n\n${buildPacket(input)}`;

  const parsed = await runClaudeStructured<SemanticPlan>({
    system: SYSTEM_PROMPT,
    prompt,
    jsonSchema: buildPlanJsonSchema(),
    validate: (raw) => semanticPlanSchema.parse(normalizeWirePlan(raw)),
  });

  const userContext = { text: `${input.goal}\n${input.attention ?? ""}` };
  const { plan } = pruneSemanticPlan(parsed, input.profiles, userContext);
  return plan;
}
