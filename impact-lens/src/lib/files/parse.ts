import Papa from "papaparse";
import * as XLSX from "xlsx";

import type { FileInput, ParsedField, ParsedRow, ParsedTable } from "./types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isXlsxInput(input: FileInput): boolean {
  const name = input.name.toLowerCase();
  if (/\.(xlsx|xlsm|xltx|xls)$/.test(name)) return true;
  if (/\.(csv|tsv|txt)$/.test(name)) return false;
  const b = input.bytes;
  // ZIP magic "PK\x03\x04" (xlsx) or OLE2 magic (legacy xls)
  return (
    (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) ||
    (b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)
  );
}

function isEmptyRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

/**
 * Assemble a ParsedTable from an array-of-arrays where matrix index i maps to
 * original 1-based row number i + 1 (header row = 1, first data row = 2).
 * Fully-empty rows are skipped but still consume their original position, so
 * row numbers stay stable across skipped blanks.
 */
function buildTable(
  sourceId: string,
  fileName: string,
  sheetName: string | null,
  matrix: string[][],
  extraWarnings: string[],
): ParsedTable | null {
  const warnings = [...extraWarnings];

  let headerIndex = 0;
  while (headerIndex < matrix.length && isEmptyRow(matrix[headerIndex] ?? [])) headerIndex++;
  if (headerIndex >= matrix.length) return null;
  if (headerIndex > 0) {
    warnings.push(`First ${headerIndex} row(s) empty; header taken from original row ${headerIndex + 1}.`);
  }

  const headerCells = matrix[headerIndex] ?? [];
  const fields: ParsedField[] = headerCells.map((h, i) => ({
    id: `f${i}`,
    header: String(h ?? "").trim(),
    index: i,
  }));

  const rows: ParsedRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    if (isEmptyRow(cells)) continue;
    if (cells.length > fields.length) {
      warnings.push(
        `Row ${i + 1} has ${cells.length} cells but only ${fields.length} header columns; extra cells ignored.`,
      );
    }
    const values: Record<string, string> = {};
    for (const field of fields) {
      const cell = cells[field.index];
      values[field.id] = cell === undefined || cell === null ? "" : String(cell);
    }
    rows.push({ rowNumber: i + 1, values });
  }

  return { sourceId, fileName, sheetName, fields, rows, warnings };
}

function parseCsv(input: FileInput): ParsedTable[] {
  // TextDecoder strips a UTF-8 BOM by default; strip a stray U+FEFF defensively too.
  let text = new TextDecoder("utf-8").decode(input.bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const result = Papa.parse<string[]>(text, {
    delimiter: "", // auto-detect: handles ",", ";", "\t", "|"
    quoteChar: '"',
    skipEmptyLines: false, // keep blank lines so original row positions survive
  });

  const warnings = result.errors
    .filter((e) => e.code !== "UndetectableDelimiter")
    .map((e) => `CSV parse: ${e.message}${e.row !== undefined ? ` (data row ${e.row + 1})` : ""}`);

  const matrix = result.data.map((row) => (row ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
  const table = buildTable(slugify(input.name), input.name, null, matrix, warnings);
  return table ? [table] : [];
}

function parseXlsx(input: FileInput): ParsedTable[] {
  const workbook = XLSX.read(input.bytes, { type: "array" });
  const tables: ParsedTable[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const aoa = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true, // keep blank rows so original row positions survive
    }) as unknown[][];
    const matrix = aoa.map((row) => (row ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
    const table = buildTable(
      `${slugify(input.name)}#${slugify(sheetName)}`,
      input.name,
      sheetName,
      matrix,
      [],
    );
    if (table) tables.push(table);
  }
  return tables;
}

export function parseTabularFile(input: FileInput): ParsedTable[] {
  return isXlsxInput(input) ? parseXlsx(input) : parseCsv(input);
}
