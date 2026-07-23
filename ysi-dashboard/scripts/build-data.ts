import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

type CsvRow = Record<string, string>;
type Level = "inform" | "engage" | "outcomes" | "impact" | "societal";

const levels: Level[] = ["inform", "engage", "outcomes", "impact", "societal"];
const appRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.resolve(appRoot, "..", "Aurelia_Propel_IMM Dataset");
const output = path.join(appRoot, "public", "data", "dashboard.json");

function cohortOf(file: string) {
  if (/^AP1and2/i.test(file)) return "AP1 + AP2";
  const match = file.match(/^AP([1-4])/i);
  return match ? `AP${match[1]}` : "Cross-cohort";
}

function waveOf(file: string) {
  if (/baseline/i.test(file)) return "Baseline";
  if (/midline/i.test(file)) return "Midline";
  if (/endline/i.test(file)) return "Endline";
  if (/IMM_Assessment/i.test(file)) return "IMM snapshot";
  if (/Org_Performance/i.test(file)) return "Org performance";
  if (/Short_Beneficiary/i.test(file)) return "Beneficiary pulse";
  return "Follow-up";
}

function languageOf(file: string) {
  return /BRA|SA_BR/i.test(file) ? "English + Portuguese" : "English";
}

function delimiterOf(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  return (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
}

function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(ltd|limited|llc|inc|group|company|co|enterprise|enterprises|organisation|organization)\b/g, "")
    .replace(/[^a-z0-9]/g, "").trim();
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[%$€£₦R]/g, "").replace(/\s/g, "");
  if (!cleaned || /^(nil|n\/a|na|none|not applicable|-|—)$/i.test(cleaned)) return null;
  let value = cleaned;
  if (value.includes(",") && value.includes(".")) value = value.replace(/,/g, "");
  else if (value.includes(",")) value = value.replace(/,/g, "");
  else if ((value.match(/\./g) ?? []).length > 1) value = value.replace(/\./g, "");
  else if (/^-?\d+\.\d{3}$/.test(value)) value = value.replace(".", "");
  value = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function orgColumn(headers: string[]) {
  const priorities = [/^organisation name$/i, /^organization name$/i, /^organisation$/i, /^organization$/i, /^company name$/i, /^social enterprise$/i, /^nome da empresa$/i, /^name$/i];
  for (const regex of priorities) {
    const found = headers.find((header) => regex.test(header.trim()));
    if (found) return found;
  }
  return null;
}

function levelOfHeader(header: string): Level | null {
  const h = header.trim().toLowerCase();
  if (/^(1\.?\s*)?inform(ed)?:\s*how many|^informed october/.test(h)) return "inform";
  if (/^2\.?\s*engage:/.test(h)) return "engage";
  if (/^3\.?\s*outcomes:/.test(h)) return "outcomes";
  if (/^4\.?\s*impact:/.test(h)) return "impact";
  if (/^5\.?\s*societal impact:/.test(h)) return "societal";
  return null;
}

function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: b.length + 1 }, (_, y) => Array(a.length + 1).fill(0));
  for (let x = 0; x <= a.length; x++) matrix[0][x] = x;
  for (let y = 0; y <= b.length; y++) matrix[y][0] = y;
  for (let y = 1; y <= b.length; y++) for (let x = 1; x <= a.length; x++) {
    matrix[y][x] = a[x - 1] === b[y - 1] ? matrix[y - 1][x - 1] : 1 + Math.min(matrix[y - 1][x], matrix[y][x - 1], matrix[y - 1][x - 1]);
  }
  return matrix[b.length][a.length];
}

const files = fs.readdirSync(dataRoot).filter((file) => file.toLowerCase().endsWith(".csv")).sort();
const profiles: Array<Record<string, unknown>> = [];
const funnelRecords: Array<Record<string, unknown>> = [];
const orgObservations: Array<{ name: string; normalized: string; file: string; cohort: string; wave: string }> = [];
let totalRows = 0;

for (const file of files) {
  const text = fs.readFileSync(path.join(dataRoot, file), "utf8").replace(/^\uFEFF/, "");
  const delimiter = delimiterOf(text);
  const result = Papa.parse<CsvRow>(text, { header: true, delimiter, skipEmptyLines: "greedy" });
  const rows = result.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
  const headers = (result.meta.fields ?? []).map((header) => header.replace(/^\uFEFF/, "").trim());
  const cells = rows.length * headers.length;
  const emptyCells = rows.reduce((sum, row) => sum + headers.filter((header) => !String(row[header] ?? "").trim()).length, 0);
  const profile = {
    file, cohort: cohortOf(file), wave: waveOf(file), language: languageOf(file), delimiter,
    rows: rows.length, columns: headers.length, sparsity: cells ? emptyCells / cells : 0,
    parseErrors: result.errors.length,
  };
  profiles.push(profile);
  totalRows += rows.length;

  const orgKey = orgColumn(headers);
  const levelHeaders = new Map<Level, string[]>();
  for (const level of levels) levelHeaders.set(level, []);
  for (const header of headers) {
    const level = levelOfHeader(header);
    if (level) levelHeaders.get(level)!.push(header);
  }

  rows.forEach((row, rowIndex) => {
    const name = orgKey ? String(row[orgKey] ?? "").trim() : "";
    if (name && normalizeName(name).length >= 3) orgObservations.push({ name, normalized: normalizeName(name), file, cohort: cohortOf(file), wave: waveOf(file) });
    if (![...levelHeaders.values()].some((items) => items.length)) return;
    const values = Object.fromEntries(levels.map((level) => {
      const candidates = levelHeaders.get(level) ?? [];
      const parsed = candidates.map((header) => parseNumber(row[header])).filter((value): value is number => value !== null);
      return [level, parsed.length ? parsed[parsed.length - 1] : null];
    })) as Record<Level, number | null>;
    const present = levels.filter((level) => values[level] !== null);
    if (!present.length) return;
    let violation = false;
    for (let index = 1; index < levels.length; index++) {
      const previous = values[levels[index - 1]], current = values[levels[index]];
      if (previous !== null && current !== null && current > previous) violation = true;
    }
    funnelRecords.push({ id: `${file}:${rowIndex + 2}`, organisation: name || `Row ${rowIndex + 2}`, file, cohort: cohortOf(file), wave: waveOf(file), values, violation });
  });
}

const grouped = new Map<string, typeof orgObservations>();
for (const item of orgObservations) grouped.set(item.normalized, [...(grouped.get(item.normalized) ?? []), item]);
const exactMatches = [...grouped.values()].filter((items) => new Set(items.map((item) => item.file)).size > 1).map((items) => ({
  organisation: items[0].name,
  confidence: "Exact normalized",
  score: 1,
  files: [...new Set(items.map((item) => item.file))],
  cohorts: [...new Set(items.map((item) => item.cohort))],
  waves: [...new Set(items.map((item) => item.wave))],
}));

const uniqueGroups = [...grouped.entries()];
const fuzzyMatches: Array<Record<string, unknown>> = [];
for (let i = 0; i < uniqueGroups.length; i++) for (let j = i + 1; j < uniqueGroups.length; j++) {
  const [a, aItems] = uniqueGroups[i], [b, bItems] = uniqueGroups[j];
  if (a.length < 5 || b.length < 5) continue;
  const score = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  if (score >= 0.78 && new Set([...aItems, ...bItems].map((item) => item.file)).size > 1) {
    fuzzyMatches.push({ organisation: `${aItems[0].name} ↔ ${bItems[0].name}`, confidence: "Fuzzy candidate", score, files: [...new Set([...aItems, ...bItems].map((item) => item.file))], cohorts: [...new Set([...aItems, ...bItems].map((item) => item.cohort))], waves: [...new Set([...aItems, ...bItems].map((item) => item.wave))] });
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  hero: { files: files.length, responses: totalRows, cohorts: 4, years: "2022–2026", funnelRecords: funnelRecords.length, joinCandidates: exactMatches.length + fuzzyMatches.length },
  profiles,
  funnelRecords,
  joinCandidates: [...exactMatches, ...fuzzyMatches].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 40),
  methodology: {
    source: "19 local Aurelia Propel IMM CSV exports",
    note: "Derived locally. Raw contact details and free-text responses are excluded from this artifact.",
    funnel: "For files with multiple columns per funnel stage, the latest non-empty numeric value in source-column order is used.",
    joins: "Exact matches remove punctuation and common company suffixes; fuzzy matches use normalized edit similarity ≥ 78%. Candidates require human confirmation.",
  },
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(payload, null, 2));
console.log(`Built ${output}: ${files.length} files, ${totalRows} responses, ${funnelRecords.length} funnel records.`);
