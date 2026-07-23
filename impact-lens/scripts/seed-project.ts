import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";

import {
  addSource,
  createProject,
  getProject,
  saveDashboard,
  saveInterpretation,
} from "../src/lib/db/projects";
import { parseTabularFile, type ParsedTable } from "../src/lib/files/parse";
import { profileTable, type SourceProfile } from "../src/lib/files/profile";
import { interpretProject } from "../src/lib/semantic/interpret";
import { runAnalysis } from "../src/lib/analysis/pipeline";
import { dashboardAnalysisSchema } from "../src/types/dashboard";

const MAX_COMBINED_BYTES = 10 * 1024 * 1024;
const MAX_PARSED_ROWS = 25_000;
const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx"]);
const SYNTHETIC_PROJECT_ID = "demo";

type SeedFile = {
  name: string;
  bytes: Uint8Array;
  tables: ParsedTable[];
  parseError?: string;
};

class SeedError extends Error {}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--fallback") {
    await seedFallback();
    return;
  }

  if (args.length !== 1 || args[0] === "--fallback") {
    throw new SeedError("Usage: tsx scripts/seed-project.ts --fallback | <absolute-directory>");
  }

  await seedDirectory(args[0]);
}

async function seedDirectory(inputDirectory: string) {
  const directory = resolveAbsoluteDirectory(inputDirectory);
  const paths = await enumerateSupportedFiles(directory);
  if (paths.length === 0) {
    throw new SeedError("The directory contains no CSV or XLSX files.");
  }

  const files = await readAndParseFiles(directory, paths);
  const totalBytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (totalBytes > MAX_COMBINED_BYTES) {
    throw new SeedError("Combined CSV/XLSX files must be 10 MB or smaller.");
  }

  const parsedRows = files.reduce(
    (total, file) => total + file.tables.reduce((tableTotal, table) => tableTotal + table.rows.length, 0),
    0,
  );
  if (parsedRows > MAX_PARSED_ROWS) {
    throw new SeedError("Parsed rows across all files must not exceed 25,000.");
  }

  const parsedTableCount = files.reduce((total, file) => total + file.tables.length, 0);
  if (parsedTableCount === 0) {
    throw new SeedError("None of the supported files could be parsed.");
  }

  const project = createProject({
    name: `Directory seed: ${basename(directory) || "impact data"}`,
    goal: "Identify evidence-backed impact KPIs from the supplied programme data.",
    attention: `Seeded from ${files.length} CSV/XLSX file${files.length === 1 ? "" : "s"}.`,
  });
  const uploadDirectory = resolve(process.cwd(), ".data", "uploads", project.id);
  await mkdir(uploadDirectory, { recursive: true });

  const profiles: SourceProfile[] = [];
  for (const file of files) {
    const storagePath = storagePathFor(uploadDirectory, extname(file.name));
    await writeFile(storagePath, file.bytes);

    if (file.parseError) {
      addSource({
        projectId: project.id,
        displayName: file.name,
        storagePath,
        mediaType: mediaTypeFor(file.name),
        byteSize: file.bytes.byteLength,
        profile: null,
        parseWarnings: [file.parseError],
      });
      continue;
    }

    for (const table of file.tables) {
      const profile = profileTable(table);
      profiles.push(profile);
      addSource({
        projectId: project.id,
        displayName: table.sheetName ? `${file.name} · ${table.sheetName}` : file.name,
        storagePath,
        mediaType: mediaTypeFor(file.name),
        byteSize: file.bytes.byteLength,
        profile,
        parseWarnings: table.warnings,
      });
    }
  }

  const semanticPlan = await interpretProject({
    projectName: project.name,
    goal: project.goal,
    attention: project.attention,
    profiles,
  });
  saveInterpretation(project.id, semanticPlan);

  const acceptedMetricIds = semanticPlan.proposedMetrics.map((metric) => metric.metricId);
  const analysis = await runAnalysis({
    projectId: project.id,
    projectName: project.name,
    goal: project.goal,
    attention: project.attention,
    files: files.map(({ name, bytes }) => ({ name, bytes })),
    // Interpretation has already been persisted so the deterministic generation
    // pass uses the exact reviewed plan and does not invoke Claude a second time.
    interpret: async () => semanticPlan,
    acceptedMetricIds,
  });
  const dashboard = withPersistedProject(analysis.dashboard, project, files.length);
  saveDashboard(project.id, dashboard, acceptedMetricIds, undefined, analysis.metricDefinitions, analysis.metricResults);

  console.log(`Seeded ${files.length} file(s), ${parsedTableCount} table(s), and ${acceptedMetricIds.length} KPI(s): ${project.id}`);
}

async function seedFallback() {
  const fixturePath = resolve(process.cwd(), "fixtures", "synthetic-dashboard.json");
  const dashboard = parseDashboard(await readFile(fixturePath, "utf8"));
  const fixtureProject = asRecord(dashboard.project);
  const projectName = stringValue(fixtureProject.name) ?? "Synthetic impact demo";
  const goal = stringValue(fixtureProject.goal) ?? "Show a precomputed impact dashboard.";

  const project = getProject(SYNTHETIC_PROJECT_ID) ?? createProject({
    id: SYNTHETIC_PROJECT_ID,
    name: projectName,
    goal,
    attention: "Committed synthetic fallback; no Claude analysis was run.",
  });
  const acceptedMetricIds = arrayValue(dashboard.metrics)
    .map((metric) => stringValue(asRecord(metric).id))
    .filter((id): id is string => id !== undefined);

  const persistedDashboard = {
    ...dashboard,
    project: {
      ...fixtureProject,
      id: project.id,
      name: project.name,
      goal: project.goal,
      status: "ready",
      synthetic: true,
    },
  };
  saveDashboard(project.id, persistedDashboard, acceptedMetricIds);
  console.log(`Installed synthetic fallback dashboard: ${project.id}`);
}

function resolveAbsoluteDirectory(input: string) {
  const supplied = input.trim();
  if (!supplied) throw new SeedError("A directory path is required.");

  const isWindowsAbsolute = win32.isAbsolute(supplied);
  const isPosixAbsolute = posix.isAbsolute(supplied);
  if (!isAbsolute(supplied) && !isWindowsAbsolute && !isPosixAbsolute) {
    throw new SeedError("The dataset directory must be an absolute Windows or POSIX path.");
  }
  if (isWindowsAbsolute && process.platform !== "win32") {
    throw new SeedError("A Windows directory path can only be read on Windows. Use a mounted POSIX path on this machine.");
  }

  return resolve(supplied);
}

async function enumerateSupportedFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown filesystem error";
    throw new SeedError(`Cannot read dataset directory: ${detail}`);
  }

  const paths: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = join(directory, entry.name);
    // Avoid following symlinks outside the explicitly supplied dataset directory.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      paths.push(...await enumerateSupportedFiles(candidate));
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      paths.push(candidate);
    }
  }
  return paths;
}

async function readAndParseFiles(root: string, paths: string[]): Promise<SeedFile[]> {
  const files: SeedFile[] = [];
  let bytesRead = 0;
  let rowsParsed = 0;
  for (const path of paths) {
    const metadata = await stat(path);
    if (bytesRead + metadata.size > MAX_COMBINED_BYTES) {
      throw new SeedError("Combined CSV/XLSX files must be 10 MB or smaller.");
    }
    const bytes = new Uint8Array(await readFile(path));
    bytesRead += bytes.byteLength;
    if (bytesRead > MAX_COMBINED_BYTES) {
      throw new SeedError("Combined CSV/XLSX files must be 10 MB or smaller.");
    }
    const name = inputName(root, path);
    try {
      const tables = parseTabularFile({ name, bytes });
      rowsParsed += tables.reduce((total, table) => total + table.rows.length, 0);
      if (rowsParsed > MAX_PARSED_ROWS) {
        throw new SeedError("Parsed rows across all files must not exceed 25,000.");
      }
      files.push({ name, bytes, tables });
    } catch (error) {
      if (error instanceof SeedError) throw error;
      files.push({
        name,
        bytes,
        tables: [],
        parseError: error instanceof Error ? error.message : "Unable to parse this file.",
      });
    }
  }
  return files;
}

function inputName(root: string, path: string) {
  // Relative names preserve deterministic parser IDs while disambiguating two
  // same-named files in separate directories. Use POSIX separators in stored
  // metadata so a seed is portable between Windows and macOS.
  const name = relative(root, path).split(sep).join("/");
  return name || basename(path);
}

function storagePathFor(uploadDirectory: string, extension: string) {
  const resolvedDirectory = resolve(uploadDirectory);
  const output = resolve(resolvedDirectory, `${randomUUID()}${extension.toLowerCase()}`);
  const pathFromDirectory = relative(resolvedDirectory, output);
  if (
    pathFromDirectory === "" ||
    pathFromDirectory.startsWith("..") ||
    pathFromDirectory.includes(":") ||
    resolve(resolvedDirectory, pathFromDirectory) !== output
  ) {
    throw new SeedError("Could not create a safe local upload path.");
  }
  return output;
}

function mediaTypeFor(name: string) {
  return extname(name).toLowerCase() === ".csv"
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function withPersistedProject(analysis: unknown, project: { id: string; name: string; goal: string }, sourceCount: number) {
  const dashboard = asRecord(analysis);
  return {
    ...dashboard,
    project: {
      ...asRecord(dashboard.project),
      id: project.id,
      name: project.name,
      goal: project.goal,
      sourceCount,
      status: "ready",
      updatedAt: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
    },
  };
}

function parseDashboard(value: string) {
  try {
    const dashboard = JSON.parse(value) as unknown;
    return dashboardAnalysisSchema.parse(dashboard);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new SeedError(`Synthetic dashboard fixture is invalid: ${detail}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback?: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Seed failed.";
  console.error(`Seed failed: ${message}`);
  process.exitCode = 1;
});
