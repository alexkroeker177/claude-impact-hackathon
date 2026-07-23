import { readFileSync } from "fs";
import { join } from "path";
import { claudeJson } from "./claude";
import { parseFile } from "./csv";
import type { FileMapping, ManifestEntry, OrgRegistryEntry } from "./types";

interface IdentityTuple {
  file: string;
  cohort: string;
  row: number;
  person: string | null;
  org: string | null;
  email: string | null;
}

const REGISTRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["orgs", "unresolved"],
  properties: {
    orgs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["org_id", "canonical_name", "aliases", "people", "email_domains", "cohorts", "country"],
        properties: {
          org_id: { type: "string" },
          canonical_name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          people: { type: "array", items: { type: "string" } },
          email_domains: { type: "array", items: { type: "string" } },
          cohorts: { type: "array", items: { type: "string" } },
          country: { type: ["string", "null"] },
        },
      },
    },
    unresolved: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "row", "name", "reason"],
        properties: {
          file: { type: "string" },
          row: { type: "integer" },
          name: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

export function collectIdentityTuples(
  datasetDir: string,
  entries: ManifestEntry[],
  mappings: Map<string, FileMapping>,
): IdentityTuple[] {
  const tuples: IdentityTuple[] = [];
  for (const entry of entries) {
    const mapping = mappings.get(entry.file);
    if (!mapping) continue;
    const text = readFileSync(join(datasetDir, entry.file), "utf8");
    const { data } = parseFile(text, entry.delimiter);
    const { org_col, person_col, email_col } = mapping.identity;
    for (const { rowIndex, cells } of data) {
      const pick = (col: number | null) => {
        const v = col !== null ? (cells[col] ?? "").trim() : "";
        return v === "" ? null : v;
      };
      const tuple: IdentityTuple = {
        file: entry.file,
        cohort: entry.cohort,
        row: rowIndex,
        person: pick(person_col),
        org: pick(org_col),
        email: pick(email_col),
      };
      if (tuple.person || tuple.org || tuple.email) tuples.push(tuple);
    }
  }
  return tuples;
}

/** S2 — one Claude pass over all identity tuples → canonical org registry. */
export async function resolveEntities(tuples: IdentityTuple[]) {
  const system = `You perform entity resolution for a pseudonymised accelerator dataset. Collapse organisation-name variants, person names, and email domains into one canonical organisation each. Email domains are DETERMINISTICALLY derived from org names (e.g. adaeze.igwe@brightpathsolutions.org ↔ "BrightPath Solutions") — use them as a strong anchor. Person↔org links learned from files that contain both columns resolve rows where only a person name appears. Person names can drift slightly (e.g. "Ijeoma Okoro" vs "Ijeoma Okoro Nunes" — same person). Sometimes an org name was typed into the person column — treat it as an org alias. Be conservative: if two names cannot be confidently linked, keep them separate and list uncertain rows in unresolved.`;

  const prompt = `## Identity tuples (file · cohort · row · person · org · email)
${JSON.stringify(tuples, null, 1)}

## Instructions
- Produce one entry per real organisation. org_id = kebab-case of the canonical name.
- aliases: every distinct org-name spelling observed (including the canonical one).
- people: every person name observed for that org (merge drifted variants of the same person into the fullest form).
- email_domains: domains observed for that org's contacts.
- cohorts: every cohort ("AP1".."AP4") the org appears in; for tuples from cohort "mixed" infer the cohort from where else the org appears (omit if unknowable).
- country: only if inferable from the data; else null.
- unresolved: rows whose org you could NOT confidently assign (with a short reason). Never silently drop a row.`;

  return claudeJson<{ orgs: OrgRegistryEntry[]; unresolved: { file: string; row: number; name: string; reason: string }[] }>({
    system,
    prompt,
    schema: REGISTRY_SCHEMA,
    maxTokens: 32000,
  });
}

/** Deterministic lookup used at extract time — fuzziness ended with S2. */
export function buildLookup(orgs: OrgRegistryEntry[]) {
  const byAlias = new Map<string, string>();
  const byPerson = new Map<string, string>();
  const byDomain = new Map<string, string>();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const org of orgs) {
    byAlias.set(norm(org.canonical_name), org.org_id);
    for (const a of org.aliases) byAlias.set(norm(a), org.org_id);
    for (const p of org.people) byPerson.set(norm(p), org.org_id);
    for (const d of org.email_domains) byDomain.set(d.toLowerCase(), org.org_id);
  }
  return {
    resolve(org: string | null, person: string | null, email: string | null): string | null {
      if (org) {
        const hit = byAlias.get(norm(org));
        if (hit) return hit;
      }
      if (email) {
        const domain = email.split("@")[1]?.toLowerCase();
        if (domain) {
          const hit = byDomain.get(domain);
          if (hit) return hit;
        }
      }
      if (person) {
        const hit = byPerson.get(norm(person));
        if (hit) return hit;
        // person columns sometimes hold an org name (observed in AP2_March_2024)
        const orgHit = byAlias.get(norm(person));
        if (orgHit) return orgHit;
      }
      return null;
    },
  };
}
