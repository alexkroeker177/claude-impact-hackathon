/**
 * Seeds a demo project without going through the upload wizard.
 *
 *   bun scripts/seed-project.ts --fallback                      synthetic data, precomputed plan, zero Claude calls
 *   bun scripts/seed-project.ts --harmonized [<dir>]             one project PER ORGANISATION (default) from pipeline/data/harmonized.json
 *   bun scripts/seed-project.ts --harmonized --org=<org_id>      just one organisation, by org_id
 *   bun scripts/seed-project.ts --harmonized --portfolio         the old single combined-portfolio project
 *   bun scripts/seed-project.ts <directory>                      generic seed: profiles real files, calls Claude once
 *
 * The generic path contains no dataset-specific logic — it is exercised against
 * the Aurelia Propel export directory for the demo, but works on any folder of
 * CSV/XLSX files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTabularFile } from "../src/lib/files/parse";
import { profileTable } from "../src/lib/files/profile";
import type { FileInput } from "../src/lib/files/types";
import { interpretProject } from "../src/lib/semantic/interpret";
import { runAnalysis } from "../src/lib/analysis/pipeline";
import { semanticPlanSchema } from "../src/lib/semantic/schema";
import {
  addSource,
  createProject,
  savePlanMetrics,
  saveMetricResults,
  saveDashboard,
  saveRun,
  setProjectStatus,
  updateRunPlan,
} from "../src/lib/db/projects";
import {
  mapHarmonized,
  mapHarmonizedByOrg,
  type HarmonizedAnomaly,
  type HarmonizedRecord,
  type OrgRegistryEntry,
} from "./lib/harmonized";
import { applyEnrichment, buildOrgDigest, digestHash, enrichOrg, type OrgEnrichment } from "./lib/enrich";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

function log(message: string): void {
  console.log(`[seed] ${message}`);
}

/** Minimal .env.local loader — tsx scripts don't get Next's env handling. Never logs values. */
function loadEnvLocal(): void {
  const envPath = path.join(ROOT, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

const ENRICH_CACHE_PATH = path.join(ROOT, "..", ".enrichment-cache.json");

type EnrichCache = Record<string, { hash: string; enrichment: OrgEnrichment }>;

function loadEnrichCache(): EnrichCache {
  try {
    return JSON.parse(fs.readFileSync(ENRICH_CACHE_PATH, "utf-8")) as EnrichCache;
  } catch {
    return {};
  }
}

function saveEnrichCache(cache: EnrichCache): void {
  fs.writeFileSync(ENRICH_CACHE_PATH, JSON.stringify(cache, null, 2));
}

/** Run tasks with bounded concurrency; individual failures don't stop the pool. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function seedFallback(): Promise<void> {
  const csvPath = path.join(ROOT, "..", "fixtures", "synthetic-impact.csv");
  const planPath = path.join(ROOT, "..", "fixtures", "synthetic-plan.json");
  const bytes = fs.readFileSync(csvPath);
  const rawPlan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  const plan = semanticPlanSchema.parse(rawPlan);

  const table = parseTabularFile({ name: "synthetic-impact.csv", bytes: new Uint8Array(bytes) })[0];
  const profile = profileTable(table);

  const dashboard = await runAnalysis({
    context: {
      projectName: "Youth employment pilot (synthetic demo)",
      goal: "Move participants from unemployment into stable income within a year.",
      attention: null,
    },
    files: [],
    interpret: async () => plan,
    precomputed: { tables: [table], profiles: [profile] },
  });

  const project = createProject({
    name: "Youth employment pilot (synthetic demo)",
    goal: "Move participants from unemployment into stable income within a year.",
    attention: null,
    synthetic: true,
  });
  addSource({
    projectId: project.id,
    fileName: "synthetic-impact.csv",
    storedPath: csvPath,
    profile,
  });
  const run = saveRun(project.id);
  updateRunPlan(run.id, plan);
  savePlanMetrics(project.id, run.id, plan);
  saveMetricResults(run.id, dashboard.metrics.map((m) => m.result));
  saveDashboard(project.id, run.id, dashboard);
  setProjectStatus(project.id, "ready");

  log(`Fallback project ready: ${project.id} (${project.name})`);
}

function loadHarmonizedInputs(dirArg?: string): {
  records: HarmonizedRecord[];
  anomalies: HarmonizedAnomaly[];
  orgs: OrgRegistryEntry[];
  harmonizedPath: string;
} {
  const dataDir = dirArg ? path.resolve(dirArg) : path.join(ROOT, "..", "..", "data");
  const anomaliesPath = path.join(ROOT, "..", "..", "build", "anomalies.json");
  const orgsPath = path.join(dataDir, "orgs.json");
  const harmonizedPath = path.join(dataDir, "harmonized.json");

  if (!fs.existsSync(harmonizedPath)) {
    throw new Error(
      `No harmonized.json at ${harmonizedPath} — run "bun pipeline/run.ts" from the repo root first.`,
    );
  }

  const records = JSON.parse(fs.readFileSync(harmonizedPath, "utf-8")) as HarmonizedRecord[];
  const anomalies = fs.existsSync(anomaliesPath)
    ? (JSON.parse(fs.readFileSync(anomaliesPath, "utf-8")) as HarmonizedAnomaly[])
    : [];
  const orgs = fs.existsSync(orgsPath)
    ? ((JSON.parse(fs.readFileSync(orgsPath, "utf-8")) as { orgs: OrgRegistryEntry[] }).orgs ?? [])
    : [];

  return { records, anomalies, orgs, harmonizedPath };
}

async function persistDashboard(input: {
  name: string;
  goal: string;
  attention: string | null;
  profiles: import("../src/lib/files/types").SourceProfile[];
  plan: import("../src/lib/semantic/schema").SemanticPlan;
  dashboard: import("../src/lib/analysis/types").DashboardAnalysis;
  storedPath: string;
}): Promise<string> {
  const project = createProject({ name: input.name, goal: input.goal, attention: input.attention, synthetic: false });
  for (const profile of input.profiles) {
    addSource({ projectId: project.id, fileName: profile.fileName, storedPath: input.storedPath, profile });
  }
  const run = saveRun(project.id);
  updateRunPlan(run.id, input.plan);
  savePlanMetrics(project.id, run.id, input.plan);
  saveMetricResults(run.id, input.dashboard.metrics.map((m) => m.result));
  saveDashboard(project.id, run.id, input.dashboard);
  setProjectStatus(project.id, "ready");
  return project.id;
}

/** Canonical 5-level funnel order used by this dataset's harmonization pipeline (seed-time context only). */
const FUNNEL_STAGE_ORDER = ["inform", "engage", "outcomes", "impact", "societal"];

/** Default: one independent ImpactLens project per organisation. */
async function seedHarmonizedByOrg(
  dirArg: string | undefined,
  onlyOrgId: string | undefined,
  noLlm: boolean,
): Promise<void> {
  const { records, anomalies, orgs, harmonizedPath } = loadHarmonizedInputs(dirArg);
  const projects = mapHarmonizedByOrg(records, anomalies, orgs, { stageOrder: FUNNEL_STAGE_ORDER });
  const selected = onlyOrgId ? projects.filter((p) => p.orgId === onlyOrgId) : projects;
  if (selected.length === 0) {
    throw new Error(onlyOrgId ? `No records found for org_id "${onlyOrgId}"` : "No organisations found in harmonized.json");
  }

  // LLM analysis pass: real per-dimension answers from each org's actual figures.
  const useLlm = !noLlm && !!process.env.ANTHROPIC_API_KEY;
  if (!useLlm) {
    log(
      noLlm
        ? "Skipping LLM analysis (--no-llm): dimension answers stay deterministic."
        : "No ANTHROPIC_API_KEY found: dimension answers stay deterministic. Add it to .env.local for real per-org analysis.",
    );
  } else {
    const cache = loadEnrichCache();
    let done = 0;
    let fromCache = 0;
    let failed = 0;
    await pool(selected, 6, async (p) => {
      const orgRecords = records.filter((r) => r.org_id === p.orgId);
      const orgAnomalies = anomalies.filter((a) => a.org_id === p.orgId);
      const digest = buildOrgDigest(p.projectName, orgRecords, orgAnomalies);
      const hash = digestHash(digest);
      try {
        let enrichment = cache[p.orgId]?.hash === hash ? cache[p.orgId].enrichment : null;
        if (enrichment) {
          fromCache += 1;
        } else {
          enrichment = await enrichOrg(digest);
          cache[p.orgId] = { hash, enrichment };
          saveEnrichCache(cache);
        }
        applyEnrichment(p.plan, p.dashboard, enrichment);
      } catch (err) {
        failed += 1;
        log(`LLM analysis failed for ${p.projectName} (kept deterministic answers): ${err instanceof Error ? err.message : err}`);
      }
      done += 1;
      if (done % 10 === 0 || done === selected.length) {
        log(`LLM analysis: ${done}/${selected.length} organisations (${fromCache} cached, ${failed} failed)`);
      }
    });
  }

  for (const p of selected) {
    const cohortLabel = p.cohorts.length ? ` (${p.cohorts.join(", ")})` : "";
    const id = await persistDashboard({
      name: `${p.projectName}${cohortLabel}`,
      goal: `Track ${p.projectName}'s reach, depth and evidence quality across its own waves.`,
      attention: "Funnel monotonicity and evidence-grade coverage for this organisation specifically.",
      profiles: p.profiles,
      plan: p.plan,
      dashboard: p.dashboard,
      storedPath: harmonizedPath,
    });
    log(`Org project ready: ${id} (${p.projectName}, ${p.dashboard.metrics.length} KPIs)`);
  }
  log(`Seeded ${selected.length} organisation project${selected.length === 1 ? "" : "s"} from ${records.length} records.`);
}

/** Legacy: one project combining every organisation into a single portfolio dashboard. */
async function seedHarmonizedPortfolio(dirArg?: string): Promise<void> {
  const { records, anomalies, harmonizedPath } = loadHarmonizedInputs(dirArg);
  const { profiles, plan, dashboard } = mapHarmonized(records, anomalies, {
    projectName: "Aurelia Propel — full portfolio (deep harmonization)",
    stageOrder: FUNNEL_STAGE_ORDER,
  });
  const id = await persistDashboard({
    name: "Aurelia Propel — full portfolio (deep harmonization)",
    goal: "Track reach, depth and evidence quality across the whole 3.5-year portfolio.",
    attention: "Funnel monotonicity and evidence-grade coverage across cohorts and waves.",
    profiles,
    plan,
    dashboard,
    storedPath: harmonizedPath,
  });
  log(`Harmonized portfolio project ready: ${id} (${records.length} records, ${profiles.length} sources)`);
}

const SUPPORTED_EXT = new Set([".csv", ".xlsx"]);

async function seedDirectory(dir: string): Promise<void> {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  const entries = fs
    .readdirSync(resolved)
    .filter((name) => SUPPORTED_EXT.has(path.extname(name).toLowerCase()));
  if (entries.length === 0) {
    throw new Error(`No .csv/.xlsx files found in ${resolved}`);
  }

  const files: FileInput[] = entries.map((name) => ({
    name,
    bytes: new Uint8Array(fs.readFileSync(path.join(resolved, name))),
  }));

  const projectName = "Aurelia Propel — unseen directory seed";
  const goal = "Understand programme reach, outcomes and impact from raw survey exports.";

  const dashboard = await runAnalysis({
    context: { projectName, goal, attention: null },
    files,
    interpret: interpretProject,
  });

  const project = createProject({ name: projectName, goal, attention: null, synthetic: false });
  for (let i = 0; i < files.length; i++) {
    const profile = dashboard.profiles[i];
    if (profile) {
      addSource({ projectId: project.id, fileName: files[i].name, storedPath: path.join(resolved, entries[i]), profile });
    }
  }
  const run = saveRun(project.id);
  updateRunPlan(run.id, dashboard.plan);
  savePlanMetrics(project.id, run.id, dashboard.plan);
  saveMetricResults(run.id, dashboard.metrics.map((m) => m.result));
  saveDashboard(project.id, run.id, dashboard);
  setProjectStatus(project.id, "ready");

  log(`Directory seed ready: ${project.id} (${files.length} files)`);
  log(`Understanding: ${dashboard.understanding}`);

  const themeHints = ["funnel", "financ", "capabilit", "feedback", "satisf"];
  const detected = themeHints.filter((hint) =>
    dashboard.plan.proposedMetrics.some((m) => m.id.includes(hint) || m.name.toLowerCase().includes(hint)) ||
    dashboard.understanding.toLowerCase().includes(hint),
  );
  log(`Themes referenced in the plan: ${detected.join(", ") || "(none matched — inspect manually)"}`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = process.argv.slice(2);
  if (args.includes("--fallback")) {
    await seedFallback();
    return;
  }
  if (args.includes("--harmonized")) {
    const dirArg = args.find((a) => !a.startsWith("--"));
    const orgArg = args.find((a) => a.startsWith("--org="))?.slice("--org=".length);
    if (args.includes("--portfolio")) {
      await seedHarmonizedPortfolio(dirArg);
    } else {
      await seedHarmonizedByOrg(dirArg, orgArg, args.includes("--no-llm"));
    }
    return;
  }
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    throw new Error(
      "Usage: bun scripts/seed-project.ts --fallback | --harmonized [dir] [--org=<id>] [--portfolio] | <directory-of-csv-xlsx>",
    );
  }
  await seedDirectory(dir);
}

main().catch((err) => {
  console.error("[seed] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
