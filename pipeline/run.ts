// Impact-data compiler: messy CSVs → mappings (Claude, cached) → canonical long table with provenance + grades.
// Usage: bun pipeline/run.ts [--stage profile|map|resolve|transform|all] [--force] [--include-deferred]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import type { Anomaly, FileMapping, FileProfile, HarmonizedRecord, ManifestEntry, OrgRegistryEntry } from "./src/types";
import { profileFile } from "./src/profile";
import { generateMapping } from "./src/map";
import { collectIdentityTuples, resolveEntities } from "./src/resolve";
import { headerCache, transformFile, type ParseFailure } from "./src/transform";
import { applyGrades, gradeAll, runValidations } from "./src/validate";
import { applyNormalizations, llmNormalize } from "./src/normalizeLlm";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // repo root — spaces in the path make URL.pathname unusable
const PIPELINE = join(ROOT, "pipeline");
const BUILD = join(ROOT, "build");
const DATA = join(ROOT, "data");
const MAPPINGS = join(PIPELINE, "mappings");
const REGISTRY = join(PIPELINE, "registry");

const args = new Set(process.argv.slice(2));
const stageArg = process.argv[process.argv.indexOf("--stage") + 1];
const stage = process.argv.includes("--stage") ? stageArg : "all";
const force = args.has("--force");
const includeDeferred = args.has("--include-deferred");

const manifest = JSON.parse(readFileSync(join(PIPELINE, "schema/manifest.json"), "utf8")) as {
  datasetDir: string;
  files: ManifestEntry[];
};
const taxonomy = JSON.parse(readFileSync(join(PIPELINE, "schema/metrics.json"), "utf8"));
const rates = JSON.parse(readFileSync(join(PIPELINE, "schema/rates.json"), "utf8")) as { toUsd: Record<string, number> };
const datasetDir = join(ROOT, manifest.datasetDir);
const entries = manifest.files.filter((f) => includeDeferred || !f.deferred);

for (const dir of [BUILD, DATA, MAPPINGS, REGISTRY]) mkdirSync(dir, { recursive: true });
const writeJson = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2));

// ---- S0: profile ----
console.log(`S0 profile: ${entries.length} files`);
const profiles = new Map<string, FileProfile>();
for (const entry of entries) {
  const profile = profileFile(datasetDir, entry);
  profiles.set(entry.file, profile);
  headerCache.set(entry.file, profile.columns.map((c) => c.header));
}
writeJson(join(BUILD, "profile.json"), [...profiles.values()]);
console.log(`  rows total: ${[...profiles.values()].reduce((a, p) => a + p.dataRows, 0)}`);
if (stage === "profile") process.exit(0);

// ---- S1: mappings (Claude, one call per file, cached as reviewable artifacts, parallelized) ----
const mappings = new Map<string, FileMapping>();
const pending: ManifestEntry[] = [];
for (const entry of entries) {
  const path = join(MAPPINGS, entry.file.replace(/\.csv$/, ".json"));
  if (!force && existsSync(path)) mappings.set(entry.file, JSON.parse(readFileSync(path, "utf8")));
  else pending.push(entry);
}
const CONCURRENCY = 6; // stay under rate limits; SDK retries 429s
for (let i = 0; i < pending.length; i += CONCURRENCY) {
  const batch = pending.slice(i, i + CONCURRENCY);
  console.log(`S1 map (Claude, parallel): ${batch.map((e) => e.file).join(", ")}`);
  const results = await Promise.all(
    batch.map(async (entry) => ({ entry, mapping: await generateMapping(entry, profiles.get(entry.file)!, taxonomy) })),
  );
  for (const { entry, mapping } of results) {
    writeJson(join(MAPPINGS, entry.file.replace(/\.csv$/, ".json")), mapping);
    mappings.set(entry.file, mapping);
  }
}
console.log(`S1 mappings ready: ${mappings.size}`);
if (stage === "map") process.exit(0);

// ---- S2: entity resolution (Claude, one call, cached) ----
const registryPath = join(REGISTRY, "orgs.json");
let registry: { orgs: OrgRegistryEntry[]; unresolved: unknown[] };
if (!force && existsSync(registryPath)) {
  registry = JSON.parse(readFileSync(registryPath, "utf8"));
} else {
  console.log("S2 resolve: entity resolution (Claude)");
  const tuples = collectIdentityTuples(datasetDir, entries, mappings);
  registry = await resolveEntities(tuples);
  writeJson(registryPath, registry);
}
console.log(`S2 registry: ${registry.orgs.length} orgs, ${registry.unresolved.length} unresolved rows`);
if (stage === "resolve") process.exit(0);

// ---- S3+S4: extract + normalize ----
const records: HarmonizedRecord[] = [];
const failures: ParseFailure[] = [];
const unresolved: { file: string; rows: number[] }[] = [];
for (const entry of entries) {
  const result = transformFile({ datasetDir, entry, mapping: mappings.get(entry.file)!, orgs: registry.orgs, toUsd: rates.toUsd });
  records.push(...result.records);
  failures.push(...result.failures);
  if (result.unresolvedRows.length) unresolved.push({ file: entry.file, rows: result.unresolvedRows });
}
console.log(`S3/S4 transform: ${records.length} records, ${failures.length} parse failures, ${unresolved.length} files with unresolved rows`);
if (stage === "transform") {
  writeJson(join(BUILD, "records-ungraded.json"), records);
  writeJson(join(BUILD, "parse-failures.json"), { failures, unresolved });
  process.exit(0);
}

// ---- S4b: LLM semantic normalization of ambiguous cells (cached) ----
const normPath = join(BUILD, "llm-normalize.json");
let normalized: Awaited<ReturnType<typeof llmNormalize>>;
if (!force && existsSync(normPath)) {
  normalized = new Map(Object.entries(JSON.parse(readFileSync(normPath, "utf8"))));
} else {
  normalized = await llmNormalize(records);
  writeJson(normPath, Object.fromEntries(normalized));
}
const fixedCount = applyNormalizations(records, normalized, rates.toUsd);
console.log(`S4b llm-normalize: ${fixedCount} ambiguous cells semantically normalized`);

// ---- S5: validate (on corrected values) + grade every numeric record ----
const anomalies: Anomaly[] = runValidations(records);
for (const r of records) {
  if (r.value === null && r.grade === "D") {
    anomalies.push({ kind: "parse_failure", org_id: r.org_id, date: r.date, detail: `${r.metric}: "${r.raw_value.slice(0, 60)}" (${r.grade_reason})`, metrics: [r.metric], source_file: r.source_file });
  }
}
const gradesPath = join(BUILD, "grades.json");
let grades: Map<string, { grade: HarmonizedRecord["grade"]; reason: string }>;
if (!force && existsSync(gradesPath)) {
  grades = new Map(Object.entries(JSON.parse(readFileSync(gradesPath, "utf8"))));
} else {
  grades = await gradeAll(records);
  writeJson(gradesPath, Object.fromEntries(grades));
}
applyGrades(records, grades);
console.log(`S5 validate: ${anomalies.length} anomalies, ${grades.size} LLM evidence grades`);

// ---- S6: emit ----
writeJson(join(DATA, "harmonized.json"), records);
writeJson(join(DATA, "orgs.json"), registry);
writeJson(join(BUILD, "anomalies.json"), anomalies);
writeJson(join(BUILD, "parse-failures.json"), { failures, unresolved });

// coverage matrix — the KPI recommender's input
const coverage: Record<string, { total: number; byCohortWave: Record<string, number>; grades: Record<string, number> }> = {};
for (const r of records) {
  const m = (coverage[r.metric] ??= { total: 0, byCohortWave: {}, grades: {} });
  m.total++;
  const key = `${r.cohort}|${r.wave}`;
  m.byCohortWave[key] = (m.byCohortWave[key] ?? 0) + 1;
  m.grades[r.grade] = (m.grades[r.grade] ?? 0) + 1;
}
writeJson(join(BUILD, "coverage.json"), {
  orgs: registry.orgs.length,
  records: records.length,
  metrics: coverage,
});

const gradeDist: Record<string, number> = {};
for (const r of records) gradeDist[r.grade] = (gradeDist[r.grade] ?? 0) + 1;
console.log(`S6 emit: data/harmonized.json (${records.length} records) · grades ${JSON.stringify(gradeDist)} · data/orgs.json · build/{anomalies,coverage,parse-failures}.json`);
