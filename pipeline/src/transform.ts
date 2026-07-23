import { readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "./csv";
import type { FileMapping, Grade, HarmonizedRecord, ManifestEntry, OrgRegistryEntry, ValueType } from "./types";
import { buildLookup } from "./resolve";

export interface ParseFailure {
  source_file: string;
  source_row: number;
  metric: string;
  raw_value: string;
  reason: string;
}

/** Extract the first numeric token, handling European thousands (120.000), US commas (5,000), spaces (26 766 051). */
export function parseNumberish(raw: string): { value: number | null; prose: boolean } {
  const cleaned = raw.replace(/ /g, " ").trim();
  const match = cleaned.match(/-?\d[\d\s.,]*/);
  if (!match) return { value: null, prose: false };
  let token = match[0].replace(/\s+/g, "").replace(/[.,]$/, "");
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");
  if (hasDot && hasComma) {
    if (token.lastIndexOf(".") > token.lastIndexOf(",")) token = token.replace(/,/g, "");
    else token = token.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    token = /^-?\d{1,3}(,\d{3})+$/.test(token) ? token.replace(/,/g, "") : token.replace(",", ".");
  } else if (hasDot) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(token)) token = token.replace(/\./g, "");
  }
  const value = Number(token);
  // prose = the cell contains meaningful text beyond the number + currency markers (grade cap C later)
  const residue = cleaned
    .replace(match[0], "")
    .replace(/[R$₦%]|R\$|USD|ZAR|NGN|BRL|month?s?|meses|months/gi, "")
    .trim();
  return { value: Number.isFinite(value) ? value : null, prose: residue.length > 2 };
}

export function detectCurrency(raw: string): string | null {
  const s = raw.trim();
  if (/^R\$\s?\d/.test(s) || /BRL/i.test(s)) return "BRL";
  if (/^R\s?\d/.test(s) || /ZAR|Rand/i.test(s)) return "ZAR";
  if (/₦|NGN|naira/i.test(s)) return "NGN";
  if (/\$|USD/i.test(s)) return "USD";
  if (/€|EUR/i.test(s)) return "EUR";
  if (/KES|Ksh/i.test(s)) return "KES";
  return null;
}

const DEFAULT_GRADE: Record<ValueType, Grade> = {
  text: "A", // verbatim source text
  score: "B",
  months: "B",
  money: "B", // self-reported financials
  percent: "B",
  count: "B",
};

/** S3+S4 — apply mappings deterministically, normalize values, keep full provenance. */
export function transformFile(opts: {
  datasetDir: string;
  entry: ManifestEntry;
  mapping: FileMapping;
  orgs: OrgRegistryEntry[];
  toUsd: Record<string, number>;
}): { records: HarmonizedRecord[]; failures: ParseFailure[]; unresolvedRows: number[] } {
  const { datasetDir, entry, mapping, orgs, toUsd } = opts;
  const lookup = buildLookup(orgs);
  const cohortOf = new Map(orgs.map((o) => [o.org_id, o.cohorts]));
  const text = readFileSync(join(datasetDir, entry.file), "utf8");
  const { data } = parseFile(text, entry.delimiter);

  const records: HarmonizedRecord[] = [];
  const failures: ParseFailure[] = [];
  const unresolvedRows: number[] = [];
  const pick = (cells: string[], col: number | null) => {
    const v = col !== null ? (cells[col] ?? "").trim() : "";
    return v === "" ? null : v;
  };

  for (const { rowIndex, cells } of data) {
    const orgId = lookup.resolve(
      pick(cells, mapping.identity.org_col),
      pick(cells, mapping.identity.person_col),
      pick(cells, mapping.identity.email_col),
    );
    if (!orgId) {
      unresolvedRows.push(rowIndex);
      continue;
    }
    // per-org cohort when the file is cross-cohort
    const cohort =
      entry.cohort !== "mixed" ? entry.cohort : (cohortOf.get(orgId) ?? [])[0] ?? "unknown";

    for (const col of mapping.columns) {
      if (!col.metric || !col.type) continue;
      const raw = (cells[col.index] ?? "").trim();
      if (raw === "") continue;

      const base: HarmonizedRecord = {
        org_id: orgId,
        cohort,
        wave: entry.wave,
        date: col.date_override ?? entry.date,
        metric: col.metric,
        type: col.type,
        value: null,
        unit: col.type === "count" ? "people" : null,
        currency: null,
        value_usd: null,
        raw_value: raw,
        source_file: entry.file,
        source_row: rowIndex,
        source_column: headerOf(mapping, col.index),
        grade: DEFAULT_GRADE[col.type],
        grade_reason: null,
      };

      if (col.type === "text") {
        base.value = raw;
        records.push(base);
        continue;
      }

      const { value, prose } = parseNumberish(raw);
      if (value === null) {
        base.grade = "D";
        base.grade_reason = "Unparseable value — raw preserved";
        failures.push({ source_file: entry.file, source_row: rowIndex, metric: col.metric, raw_value: raw, reason: "no numeric token" });
        records.push(base);
        continue;
      }

      let v = value;
      if (col.type === "percent") {
        if (v > 0 && v <= 1 && !raw.includes("%")) v = v * 100; // 0.5 → 50
      }
      if (col.type === "money") {
        const currency = col.currency ?? detectCurrency(raw);
        base.currency = currency;
        base.value_usd = currency && toUsd[currency] !== undefined ? Math.round(v * toUsd[currency]) : null;
        if (!currency) base.grade_reason = "Currency undetectable — no USD conversion";
      }
      base.value = v;
      if (prose) {
        base.grade = base.grade < "C" ? "C" : base.grade; // A/B → C; keep D
        base.grade_reason = base.grade_reason ?? "Number extracted from prose answer";
      }
      records.push(base);
    }
  }
  return { records, failures, unresolvedRows };
}

function headerOf(mapping: FileMapping, index: number): string {
  // headers live in the profile; the mapping notes carry semantics. Store header lazily via global cache set by run.ts.
  return headerCache.get(mapping.file)?.[index] ?? `col:${index}`;
}

export const headerCache = new Map<string, string[]>();
