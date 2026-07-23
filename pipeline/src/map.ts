import { claudeJson } from "./claude";
import type { FileMapping, FileProfile, ManifestEntry } from "./types";

const VALUE_TYPES = ["count", "money", "percent", "months", "score", "text"];

const MAPPING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["identity", "columns"],
  properties: {
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["org_col", "person_col", "email_col"],
      properties: {
        org_col: { type: ["integer", "null"] },
        person_col: { type: ["integer", "null"] },
        email_col: { type: ["integer", "null"] },
      },
    },
    columns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "metric", "type", "currency", "date_override", "notes"],
        properties: {
          index: { type: "integer" },
          metric: { type: ["string", "null"] },
          type: { anyOf: [{ type: "string", enum: VALUE_TYPES }, { type: "null" }] },
          currency: { type: ["string", "null"] },
          date_override: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
      },
    },
  },
};

/** S1 — Claude maps one file's columns onto the canonical taxonomy. Output is a reviewable, cached artifact. */
export async function generateMapping(
  entry: ManifestEntry,
  profile: FileProfile,
  taxonomy: unknown,
): Promise<FileMapping> {
  const system = `You map messy survey-export CSV columns onto a canonical impact-metric taxonomy for the Aurelia Propel accelerator (social enterprises, cohorts AP1-AP4, waves baseline/midline/endline). You are precise and conservative: map a column only when it clearly corresponds to a canonical metric; otherwise set metric to null. Portuguese headers map directly to the same English canonical metrics.`;

  const prompt = `## Canonical taxonomy
${JSON.stringify(taxonomy, null, 1)}

## File context
file: ${entry.file}
cohort: ${entry.cohort} · wave: ${entry.wave} · nominal date: ${entry.date} · language: ${entry.lang}

## Columns (index · header · fill-rate · sample values)
${JSON.stringify(profile.columns, null, 1)}

## Instructions
- identity: which column indexes hold the ORGANISATION name, the contact PERSON name, and the EMAIL. A column literally named "Name"/"Nome" usually holds a PERSON; the org is usually in a column named Organisation/Organization/Company Name/Nome da empresa/Social Enterprise/Organisation Name. Check the sample values, not just the header. If a file has only one name-ish column, decide from samples whether it holds orgs or persons.
- For every column output one entry. metric = canonical id or null (skip). Free-text elaborations that match a text.* / *.methodology / *.marginalised metric should be mapped — they feed report generation and evidence grading.
- The funnel questions often appear twice per level with different as-of dates in the question text (e.g. "as of October 2024" vs current wave). Set date_override (YYYY-MM) whenever the question text pins an as-of date different from the nominal date. Otherwise date_override = null.
- type must match the taxonomy's type for that metric. currency: ISO code only when the header pins it (e.g. "in USD" → "USD", "in Rand"/ZAR context → "ZAR"); else null.
- Likert/self-rating columns with textual scale answers like "3 - Consistent revenue..." map to score metrics only if a canonical score metric fits; otherwise null.
- Do NOT map the identity columns themselves to metrics (except ctx.country / ctx.legal_status / ctx.stage columns, which are regular mapped columns).`;

  const result = await claudeJson<Omit<FileMapping, "file">>({
    system,
    prompt,
    schema: MAPPING_SCHEMA,
    maxTokens: 16000,
  });
  return { file: entry.file, ...result };
}
