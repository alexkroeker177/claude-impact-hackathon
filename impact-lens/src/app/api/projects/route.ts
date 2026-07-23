import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import { addSource, createProject, getProject, listProjects, listSources } from "@/lib/db/projects";
import { parseTabularFile } from "@/lib/files/parse";
import { profileTable } from "@/lib/files/profile";

const MAX_COMBINED_BYTES = 10 * 1024 * 1024;
const MAX_PARSED_ROWS = 25_000;
const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx"]);

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const project = getProject(id);
    if (!project) return failure("Project not found.", 404);
    return Response.json({ project, sources: listSources(id).map(publicSource) });
  }
  return Response.json({ projects: listProjects() });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const name = requiredText(formData.get("projectName"), "Project name");
    const goal = requiredText(formData.get("goal"), "Goal");
    const attention = optionalText(formData.get("attention"));
    const files = formEntries(formData);

    if (files.length === 0) return failure("Select at least one CSV or XLSX file.", 400);
    const invalid = files.find((file) => !SUPPORTED_EXTENSIONS.has(fileExtension(file.name)));
    if (invalid) return failure(`Unsupported file type: ${safeDisplayName(invalid.name)}. Upload CSV or XLSX files only.`, 415);

    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > MAX_COMBINED_BYTES) return failure("Combined uploads must be 10 MB or smaller.", 413);

    let rowCount = 0;
    const parseFailures: Array<{ filename: string; message: string }> = [];
    const preparedFiles: Array<{
      displayName: string;
      extension: string;
      sourceKey: string;
      bytes: Uint8Array;
      mediaType: string;
      tables: ReturnType<typeof parseTabularFile>;
      parseError?: string;
    }> = [];

    // Parse and enforce request-wide limits before creating durable state.
    for (const file of files) {
      const extension = fileExtension(file.name);
      const displayName = safeDisplayName(file.name);
      const sourceKey = crypto.randomUUID();
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const tables = parseTabularFile({ name: displayName, bytes, sourceKey });
        const rowsInFile = tables.reduce((total, table) => total + table.rows.length, 0);
        if (rowCount + rowsInFile > MAX_PARSED_ROWS) {
          throw new UploadError("Parsed rows across all files must not exceed 25,000.", 413);
        }
        rowCount += rowsInFile;
        preparedFiles.push({ displayName, extension, sourceKey, bytes, mediaType: file.type || mediaTypeFor(extension), tables });
      } catch (error) {
        if (error instanceof UploadError) throw error;
        const message = error instanceof Error ? error.message : "Unable to parse this file.";
        parseFailures.push({ filename: displayName, message });
        preparedFiles.push({ displayName, extension, sourceKey, bytes, mediaType: file.type || mediaTypeFor(extension), tables: [], parseError: message });
      }
    }

    if (!preparedFiles.some((file) => file.tables.length > 0)) {
      return Response.json({ error: "None of the selected files could be parsed.", parseFailures }, { status: 422 });
    }

    const project = createProject({ name, goal, attention });
    const uploadDirectory = resolve(process.cwd(), ".data", "uploads", project.id);
    await mkdir(uploadDirectory, { recursive: true });
    const sources = [];
    for (const prepared of preparedFiles) {
      const storagePath = safeStoragePath(uploadDirectory, `${prepared.sourceKey}${prepared.extension}`);
      await writeFile(storagePath, prepared.bytes);
      if (prepared.parseError) {
        sources.push(addSource({
          projectId: project.id,
          displayName: prepared.displayName,
          storagePath,
          mediaType: prepared.mediaType,
          byteSize: prepared.bytes.byteLength,
          profile: null,
          parseWarnings: [prepared.parseError],
        }));
        continue;
      }
      for (const table of prepared.tables) {
        sources.push(addSource({
          projectId: project.id,
          displayName: table.sheetName ? `${prepared.displayName} · ${table.sheetName}` : prepared.displayName,
          storagePath,
          mediaType: prepared.mediaType,
          byteSize: prepared.bytes.byteLength,
          profile: profileTable(table),
          parseWarnings: table.warnings,
        }));
      }
    }

    return Response.json({ project, sources: sources.map(publicSource), parseFailures, rowCount }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) return failure(error.message, error.status);
    const message = error instanceof Error ? error.message : "The upload could not be processed.";
    return failure(message, 400);
  }
}

class UploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function formEntries(formData: FormData) {
  return [...formData.values()].filter((value): value is File => value instanceof File);
}

function requiredText(value: FormDataEntryValue | null, label: string) {
  const text = optionalText(value);
  if (!text) throw new UploadError(`${label} is required.`, 400);
  return text;
}

function optionalText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function fileExtension(filename: string) {
  return extname(leafFilename(filename)).toLowerCase();
}

function safeDisplayName(filename: string) {
  const displayName = leafFilename(filename).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  return displayName || "upload";
}

function leafFilename(filename: string) {
  return basename(filename.replaceAll("\\", "/"));
}

function safeStoragePath(uploadDirectory: string, storageName: string) {
  const resolvedDirectory = resolve(uploadDirectory);
  const resolvedPath = resolve(join(resolvedDirectory, storageName));
  const pathToFile = relative(resolvedDirectory, resolvedPath);
  if (pathToFile === "" || pathToFile.startsWith("..") || pathToFile.includes(":") || resolve(resolvedDirectory, pathToFile) !== resolvedPath) {
    throw new UploadError("Invalid upload storage path.", 400);
  }
  return resolvedPath;
}

function mediaTypeFor(extension: string) {
  return extension === ".csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function failure(error: string, status: number) {
  return Response.json({ error }, { status });
}

function publicSource(source: { id: string; displayName: string; mediaType: string; byteSize: number; profile: unknown | null; parseWarnings: unknown[] }) {
  return {
    id: source.id,
    displayName: source.displayName,
    mediaType: source.mediaType,
    byteSize: source.byteSize,
    profile: source.profile,
    parseWarnings: source.parseWarnings,
  };
}
