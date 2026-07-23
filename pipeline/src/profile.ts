import { readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "./csv";
import type { FileProfile, ManifestEntry } from "./types";

const SAMPLE_MAX_LEN = 140;

/** S0 — per-file structural profile. This (not raw rows) is what the mapping prompt sees. */
export function profileFile(datasetDir: string, entry: ManifestEntry): FileProfile {
  const text = readFileSync(join(datasetDir, entry.file), "utf8");
  const { header, data, bom } = parseFile(text, entry.delimiter);
  const columns = header.map((h, index) => {
    const values = data.map((r) => (r.cells[index] ?? "").trim()).filter((v) => v !== "");
    return {
      index,
      header: h,
      fillRate: data.length ? Math.round((values.length / data.length) * 100) / 100 : 0,
      samples: values.slice(0, 3).map((v) => (v.length > SAMPLE_MAX_LEN ? v.slice(0, SAMPLE_MAX_LEN) + "…" : v)),
    };
  });
  return { file: entry.file, bom, cols: header.length, dataRows: data.length, columns };
}
