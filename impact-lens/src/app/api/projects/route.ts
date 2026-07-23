import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseTabularFile } from "@/lib/files/parse";
import { profileTable } from "@/lib/files/profile";
import type { FileInput, SourceProfile } from "@/lib/files/types";
import { addSource, createProject, listProjects } from "@/lib/db/projects";

export const runtime = "nodejs";

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ROWS = 25000;
const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx"]);

function jsonError(status: number, kind: string, message: string): Response {
  return Response.json({ error: { kind, message } }, { status });
}

function emptyProfile(sourceId: string, fileName: string, warning: string): SourceProfile {
  return {
    sourceId,
    fileName,
    sheetName: null,
    rowCount: 0,
    parseWarnings: [warning],
    fields: [],
  };
}

interface PreparedFile {
  displayName: string;
  ext: string;
  bytes: Uint8Array;
  profiles: SourceProfile[];
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "bad_request", "Expected multipart form data.");
  }

  const nameRaw = form.get("name");
  const goalRaw = form.get("goal");
  const attentionRaw = form.get("attention");
  if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
    return jsonError(400, "validation", "Field 'name' is required.");
  }
  if (typeof goalRaw !== "string" || goalRaw.trim() === "") {
    return jsonError(400, "validation", "Field 'goal' is required.");
  }
  const name = nameRaw.trim();
  const goal = goalRaw.trim();
  const attention =
    typeof attentionRaw === "string" && attentionRaw.trim() !== "" ? attentionRaw.trim() : null;

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);

  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    const ext = path.extname(path.basename(file.name)).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return jsonError(
        400,
        "unsupported_file",
        `Unsupported file "${path.basename(file.name)}" — only .csv and .xlsx are accepted.`,
      );
    }
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return jsonError(
      413,
      "too_large",
      `Combined upload size ${totalBytes} bytes exceeds the 10 MB limit.`,
    );
  }

  // Parse + profile everything in memory before touching disk or the database.
  const warnings: string[] = [];
  const prepared: PreparedFile[] = [];
  let totalRows = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const displayName = path.basename(file.name);
    const ext = path.extname(displayName).toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const input: FileInput = { name: displayName, bytes };
    try {
      const tables = parseTabularFile(input);
      const profiles = tables.map((table) => profileTable(table));
      for (const table of tables) {
        totalRows += table.rows.length;
      }
      prepared.push({ displayName, ext, bytes, profiles });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`${displayName}: failed to parse (${message})`);
      prepared.push({
        displayName,
        ext,
        bytes,
        profiles: [emptyProfile(`failed-${i}`, displayName, message)],
      });
    }
  }
  if (totalRows > MAX_TOTAL_ROWS) {
    return jsonError(
      413,
      "too_many_rows",
      `Total parsed rows (${totalRows}) exceed the ${MAX_TOTAL_ROWS} row limit.`,
    );
  }

  try {
    const project = createProject({ name, goal, attention });
    const uploadDir = path.join(".data", "uploads", project.id);
    await fsp.mkdir(uploadDir, { recursive: true });
    const resolvedUploadDir = path.resolve(uploadDir);

    const profiles: SourceProfile[] = [];
    for (const file of prepared) {
      const storedPath = path.join(uploadDir, `${randomUUID()}${file.ext}`);
      if (!path.resolve(storedPath).startsWith(resolvedUploadDir + path.sep)) {
        return jsonError(400, "invalid_path", `Refusing storage path for "${file.displayName}".`);
      }
      await fsp.writeFile(storedPath, file.bytes);
      for (const profile of file.profiles) {
        addSource({
          projectId: project.id,
          fileName: file.displayName,
          storedPath,
          profile,
        });
        profiles.push(profile);
      }
    }

    return Response.json({ projectId: project.id, profiles, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, "internal", `Failed to persist project: ${message}`);
  }
}

export async function GET(): Promise<Response> {
  try {
    return Response.json({ projects: listProjects() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, "internal", message);
  }
}
