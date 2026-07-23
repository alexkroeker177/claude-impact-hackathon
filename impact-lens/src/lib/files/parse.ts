import Papa from "papaparse";
import * as XLSX from "xlsx";

export type FileInput = {
  name: string;
  bytes: Uint8Array;
  /** Stable, non-path identity used to disambiguate same-named uploads. */
  sourceKey?: string;
};

export type ParsedField = {
  id: string;
  header: string;
  index: number;
};

export type ParsedRow = {
  /** One-based line number in the original source, including the header row. */
  rowNumber: number;
  values: Record<string, string>;
};

export type ParsedTable = {
  sourceId: string;
  filename: string;
  sheetName?: string;
  fields: ParsedField[];
  rows: ParsedRow[];
  warnings: string[];
};

const UTF8_BOM = "\uFEFF";

/**
 * Parses one uploaded CSV or XLSX file without coercing any source values.
 * Every returned cell value is a string; an empty source cell is represented by
 * the empty string rather than a substituted zero, null, or undefined value.
 */
export function parseTabularFile(input: FileInput): ParsedTable[] {
  const extension = input.name.split(".").pop()?.toLocaleLowerCase();

  if (extension === "csv") {
    return [parseCsv(input)];
  }

  if (extension === "xlsx") {
    return parseWorkbook(input);
  }

  throw new Error(`Unsupported tabular file type: ${input.name}`);
}

function parseCsv(input: FileInput): ParsedTable {
  const source = removeBom(new TextDecoder("utf-8").decode(input.bytes));
  const result = Papa.parse<string[]>(source, {
    delimiter: "",
    dynamicTyping: false,
    skipEmptyLines: "greedy",
  });

  const warnings = result.errors.map((error) => {
    const row = typeof error.row === "number" ? ` at row ${error.row + 1}` : "";
    return `CSV parse warning (${error.code})${row}: ${error.message}`;
  });

  return tableFromGrid({
    filename: input.name,
    sourceId: createSourceId(input.sourceKey ?? input.name),
    grid: result.data,
    warnings,
  });
}

function parseWorkbook(input: FileInput): ParsedTable[] {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(input.bytes, { type: "array" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown workbook error";
    throw new Error(`Unable to read XLSX file ${input.name}: ${detail}`);
  }

  const tables: ParsedTable[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    if (grid.length === 0) continue;

    tables.push(
      tableFromGrid({
        filename: input.name,
        sheetName,
        sourceId: createSourceId(input.sourceKey ?? input.name, sheetName),
        grid: grid.map((row) => row.map(toRawString)),
        warnings: [],
      }),
    );
  }

  return tables;
}

function tableFromGrid(input: {
  filename: string;
  sourceId: string;
  sheetName?: string;
  grid: string[][];
  warnings: string[];
}): ParsedTable {
  const [headerRow = [], ...dataRows] = input.grid;
  const { fields, warnings: fieldWarnings } = createFields(headerRow);
  const warnings = [...input.warnings, ...fieldWarnings];

  return {
    sourceId: input.sourceId,
    filename: input.filename,
    ...(input.sheetName ? { sheetName: input.sheetName } : {}),
    fields,
    rows: dataRows.map((cells, rowIndex) => ({
      rowNumber: rowIndex + 2,
      values: fields.reduce<Record<string, string>>((values, field) => {
        values[field.id] = toRawString(cells[field.index] ?? "");
        return values;
      }, {}),
    })),
    warnings,
  };
}

function createFields(headerRow: string[]): {
  fields: ParsedField[];
  warnings: string[];
} {
  const usedIds = new Map<string, number>();
  const warnings: string[] = [];

  const fields = headerRow.map((cell, index) => {
    const header = toRawString(cell);
    const baseId = fieldBaseId(header, index);
    const seen = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, seen + 1);
    const id = seen === 0 ? baseId : `${baseId}_${seen + 1}`;

    if (header.trim() === "") {
      warnings.push(`Column ${index + 1} has no header; using field ID ${id}.`);
    } else if (seen > 0) {
      warnings.push(`Duplicate header "${header}"; using field ID ${id}.`);
    }

    return { id, header, index };
  });

  return { fields, warnings };
}

function fieldBaseId(header: string, index: number): string {
  const normalized = removeBom(header)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || `column_${index + 1}`;
}

function createSourceId(fileIdentity: string, sheetName?: string): string {
  return sheetName === undefined ? fileIdentity : `${fileIdentity}::${sheetName}`;
}

function removeBom(value: string): string {
  return value.startsWith(UTF8_BOM) ? value.slice(UTF8_BOM.length) : value;
}

function toRawString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}
