/**
 * Seeds a demo project without going through the upload wizard.
 *
 *   bun scripts/seed-project.ts --fallback              synthetic data, precomputed plan, zero Claude calls
 *   bun scripts/seed-project.ts --harmonized [<dir>]     imports pipeline/data/harmonized.json (default: ../data)
 *   bun scripts/seed-project.ts <directory>              generic seed: profiles real files, calls Claude once
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
import { mapHarmonized, type HarmonizedAnomaly, type HarmonizedRecord } from "./lib/harmonized";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

function log(message: string): void {
  console.log(`[seed] ${message}`);
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

async function seedHarmonized(dirArg?: string): Promise<void> {
  const dataDir = dirArg
    ? path.resolve(dirArg)
    : path.join(ROOT, "..", "..", "data");
  const anomaliesPath = path.join(ROOT, "..", "..", "build", "anomalies.json");
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

  const { profiles, plan, dashboard } = mapHarmonized(records, anomalies, {
    projectName: "Aurelia Propel — full portfolio (deep harmonization)",
  });

  const project = createProject({
    name: "Aurelia Propel — full portfolio (deep harmonization)",
    goal: "Track reach, depth and evidence quality across the whole 3.5-year portfolio.",
    attention: "Funnel monotonicity and evidence-grade coverage across cohorts and waves.",
    synthetic: false,
  });
  for (const profile of profiles) {
    addSource({ projectId: project.id, fileName: profile.fileName, storedPath: harmonizedPath, profile });
  }
  const run = saveRun(project.id);
  updateRunPlan(run.id, plan);
  savePlanMetrics(project.id, run.id, plan);
  saveMetricResults(run.id, dashboard.metrics.map((m) => m.result));
  saveDashboard(project.id, run.id, dashboard);
  setProjectStatus(project.id, "ready");

  log(`Harmonized portfolio project ready: ${project.id} (${records.length} records, ${profiles.length} sources)`);
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
  const args = process.argv.slice(2);
  if (args.includes("--fallback")) {
    await seedFallback();
    return;
  }
  if (args.includes("--harmonized")) {
    const dirArg = args.find((a) => !a.startsWith("--"));
    await seedHarmonized(dirArg);
    return;
  }
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    throw new Error(
      "Usage: bun scripts/seed-project.ts --fallback | --harmonized [dir] | <directory-of-csv-xlsx>",
    );
  }
  await seedDirectory(dir);
}

main().catch((err) => {
  console.error("[seed] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
