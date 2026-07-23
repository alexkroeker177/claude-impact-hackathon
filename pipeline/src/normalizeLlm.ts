import { claudeJson } from "./claude";
import type { HarmonizedRecord } from "./types";

export const recordKey = (r: HarmonizedRecord) => `${r.source_file}|${r.source_row}|${r.source_col_index}`;

/** Cells the deterministic parser can't be trusted on — these get semantic LLM normalization. */
export function isAmbiguous(r: HarmonizedRecord): boolean {
  if (r.type === "text") return false;
  if (r.value === null) return true; // parse failures: N/A, TBC, prose-only
  const numberTokens = r.raw_value.match(/\d[\d\s.,]*/g) ?? [];
  if (numberTokens.length > 1) return true; // "58% men and 42% women", "(3) ... 4 pillars"
  if (r.grade_reason?.includes("prose")) return true; // Likert "(3) Our purpose is central..."
  if (r.type === "money" && !r.currency) return true;
  if (r.type === "percent" && typeof r.value === "number" && (r.value > 100 || r.value < 0)) return true;
  return false;
}

const NORMALIZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "value", "currency", "status", "note"],
        properties: {
          id: { type: "string" },
          value: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          status: { type: "string", enum: ["reported", "not_reported", "unclear"] },
          note: { type: "string" },
        },
      },
    },
  },
};

interface NormalizedCell {
  id: string;
  value: number | null;
  currency: string | null;
  status: "reported" | "not_reported" | "unclear";
  note: string;
}

/** S4b — Claude reads each ambiguous cell WITH its survey question and extracts the semantically correct value. */
export async function llmNormalize(records: HarmonizedRecord[]): Promise<Map<string, NormalizedCell>> {
  const ambiguous = records.filter(isAmbiguous);
  const results = new Map<string, NormalizedCell>();
  if (ambiguous.length === 0) return results;

  const system = `You extract the correct numeric answer from messy survey cells for impact measurement. You are given the survey QUESTION, the target METRIC (with its type), and the RAW cell text. Rules:
- Return the value that answers THE QUESTION. Example: question asks share of WOMEN, cell says "58% men and 42% women" → value 42.
- Likert-style answers like "(3) Our purpose is central to..." → the scale number (3), status reported.
- percent: return the percentage as a number 0-100. If the cell holds an absolute count instead of a percentage, status "unclear" and explain.
- money: value in the stated currency; set currency (ISO 4217) from cell or question context ("in USD" → USD, R → ZAR, ₦ → NGN, R$ → BRL); null if truly unknowable.
- "N/A", "TBC", "unknown", "not sure", refusals → status not_reported, value null.
- If the cell contains multiple candidate readings and the question doesn't disambiguate → status unclear, value null, explain in note.
- note: one short sentence on what you did.`;

  const CHUNK = 40;
  const batches: (typeof ambiguous)[] = [];
  for (let i = 0; i < ambiguous.length; i += CHUNK) batches.push(ambiguous.slice(i, i + CHUNK));

  const CONCURRENCY = 6;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    console.log(`S4b llm-normalize: batches ${i + 1}-${i + group.length}/${batches.length}`);
    const settled = await Promise.all(
      group.map((batch) =>
        claudeJson<{ items: NormalizedCell[] }>({
          system,
          prompt: `Normalize each cell:\n${JSON.stringify(
            batch.map((r) => ({
              id: recordKey(r),
              metric: r.metric,
              type: r.type,
              question: r.source_column.slice(0, 180),
              raw: r.raw_value.slice(0, 300),
            })),
            null,
            1,
          )}`,
          schema: NORMALIZE_SCHEMA,
          maxTokens: 16000,
        }),
      ),
    );
    for (const { items } of settled) for (const item of items) results.set(item.id, item);
  }
  return results;
}

/** Apply LLM normalizations back onto the records. */
export function applyNormalizations(
  records: HarmonizedRecord[],
  normalized: Map<string, NormalizedCell>,
  toUsd: Record<string, number>,
) {
  let fixed = 0;
  for (const r of records) {
    const n = normalized.get(recordKey(r));
    if (!n) continue;
    fixed++;
    if (n.status === "not_reported") {
      r.value = null;
      r.grade = "N";
      r.grade_reason = n.note;
      continue;
    }
    if (n.status === "unclear") {
      r.value = n.value;
      r.grade = "D";
      r.grade_reason = n.note;
      continue;
    }
    r.value = n.value;
    if (r.type === "money") {
      r.currency = n.currency ?? r.currency;
      r.value_usd = r.currency && toUsd[r.currency] !== undefined && typeof r.value === "number" ? Math.round(r.value * toUsd[r.currency]) : null;
    }
    // clear the deterministic prose-cap; the grading pass judges evidence quality next
    r.grade = "B";
    r.grade_reason = n.note;
  }
  return fixed;
}
