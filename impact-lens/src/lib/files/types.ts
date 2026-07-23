export interface FileInput {
  name: string;
  bytes: Uint8Array;
}

export interface ParsedField {
  /** Stable field id, unique within the table (e.g. "f0", "f1"). */
  id: string;
  header: string;
  index: number;
}

export interface ParsedRow {
  /** Original 1-based row number in the source file (header = row 1). */
  rowNumber: number;
  /** fieldId -> raw string value. Missing values stay "" — never coerced to 0. */
  values: Record<string, string>;
}

export interface ParsedTable {
  /** Stable source id, unique across the project (e.g. "s0", "s0:Sheet2"). */
  sourceId: string;
  fileName: string;
  sheetName: string | null;
  fields: ParsedField[];
  rows: ParsedRow[];
  warnings: string[];
}

export type PhysicalType =
  | "boolean"
  | "percentage"
  | "currency"
  | "integer"
  | "number"
  | "date"
  | "identifier"
  | "category"
  | "text"
  | "empty";

export interface FieldProfile {
  fieldId: string;
  header: string;
  index: number;
  inferredType: PhysicalType;
  /** Share of rows with an empty value, 0..1. */
  nullRate: number;
  uniqueCount: number;
  numericRange: { min: number; max: number } | null;
  /** At most 5 redacted sample values (emails/long text truncated). */
  samples: string[];
  /** True when non-empty values mix incompatible physical types. */
  mixedTypes: boolean;
}

export interface SourceProfile {
  sourceId: string;
  fileName: string;
  sheetName: string | null;
  rowCount: number;
  parseWarnings: string[];
  fields: FieldProfile[];
}
