import type { ParsedField, ParsedRow, ParsedTable } from "./parse";

export type InferredFieldType =
  | "boolean"
  | "percentage"
  | "currency"
  | "integer"
  | "number"
  | "date"
  | "identifier"
  | "category"
  | "text";

export type PhysicalFieldType =
  | "boolean"
  | "percentage"
  | "currency"
  | "integer"
  | "number"
  | "date"
  | "text";

export type FieldProfile = {
  fieldId: string;
  header: string;
  inferredType: InferredFieldType;
  nullCount: number;
  nullRate: number;
  uniqueCount: number;
  uniqueRate: number;
  duplicateCount: number;
  physicalTypeDistribution: Record<PhysicalFieldType, number>;
  mixedTypes: boolean;
  invalidCount: number;
  min: number | string | null;
  max: number | string | null;
};

export type RedactedSample = {
  rowNumber: number;
  values: Record<string, string>;
};

export type SourceProfile = {
  sourceId: string;
  filename: string;
  sheetName?: string;
  rowCount: number;
  fields: FieldProfile[];
  samples: RedactedSample[];
  warnings: string[];
};

/**
 * Produces deterministic field statistics plus a small locally redacted UI
 * preview. The semantic model packet is built separately and omits previews.
 * This never changes ParsedTable values or infers programme meaning.
 */
export function profileTable(table: ParsedTable): SourceProfile {
  return {
    sourceId: table.sourceId,
    filename: table.filename,
    ...(table.sheetName ? { sheetName: table.sheetName } : {}),
    rowCount: table.rows.length,
    fields: table.fields.map((field) => profileField(field, table.rows)),
    samples: table.rows.slice(0, 5).map(redactRow),
    warnings: [...table.warnings],
  };
}

function profileField(field: ParsedField, rows: ParsedRow[]): FieldProfile {
  const values = rows.map((row) => row.values[field.id] ?? "");
  const nonMissing = values.filter((value) => value !== "");
  const uniqueValues = new Set(nonMissing);
  const inferredType = inferType(field, nonMissing, rows.length);
  const physicalTypeDistribution = countPhysicalTypes(nonMissing);
  const range = inferRange(inferredType, nonMissing);

  return {
    fieldId: field.id,
    header: field.header,
    inferredType,
    nullCount: values.length - nonMissing.length,
    nullRate: values.length === 0 ? 0 : (values.length - nonMissing.length) / values.length,
    uniqueCount: uniqueValues.size,
    uniqueRate: nonMissing.length === 0 ? 0 : uniqueValues.size / nonMissing.length,
    duplicateCount: nonMissing.length - uniqueValues.size,
    physicalTypeDistribution,
    mixedTypes: hasMixedPhysicalTypes(physicalTypeDistribution),
    invalidCount: countInvalidValues(inferredType, nonMissing),
    min: range.min,
    max: range.max,
  };
}

function inferType(
  field: ParsedField,
  nonMissing: string[],
  rowCount: number,
): InferredFieldType {
  if (nonMissing.length === 0) return "text";
  const headerLooksLikeIdentifier = /(^|[_\s-])(id|identifier|code|uuid|reference|ref)([_\s-]|$)/i.test(
    field.header,
  );
  if (headerLooksLikeIdentifier) return "identifier";
  if (nonMissing.every(isBoolean)) return "boolean";
  if (nonMissing.every(isPercentage)) return "percentage";
  if (nonMissing.every(isCurrency)) return "currency";
  if (nonMissing.every(isInteger)) return "integer";
  if (nonMissing.every(isNumber)) return "number";
  if (nonMissing.every(isDate)) return "date";

  // Retain a useful inferred type when a minority of otherwise typed values is
  // malformed, so invalidCount can surface the problem instead of hiding it as text.
  const dominantType = dominantPhysicalType(nonMissing);
  if (dominantType) return dominantType;

  const uniqueCount = new Set(nonMissing).size;
  const valuesLookLikeIdentifier =
    uniqueCount === nonMissing.length &&
    nonMissing.every((value) => /^[\p{L}\p{N}_-]+$/u.test(value)) &&
    nonMissing.some((value) => /[\p{L}_-]/u.test(value));

  if (valuesLookLikeIdentifier) return "identifier";

  const categoryLimit = Math.min(20, Math.max(1, Math.ceil(rowCount * 0.2)));
  if (uniqueCount <= categoryLimit) return "category";

  return "text";
}

function inferRange(
  type: InferredFieldType,
  values: string[],
): { min: number | string | null; max: number | string | null } {
  if (type === "integer" || type === "number" || type === "percentage" || type === "currency") {
    const numbers = values.map(numberForProfile).filter((value): value is number => value !== null);
    return numbers.length === 0
      ? { min: null, max: null }
      : { min: Math.min(...numbers), max: Math.max(...numbers) };
  }

  if (type === "date") {
    const ordered = values
      .filter(isDate)
      .sort((left, right) => Date.parse(left) - Date.parse(right));
    return { min: ordered[0] ?? null, max: ordered.at(-1) ?? null };
  }

  return { min: null, max: null };
}

function countPhysicalTypes(values: string[]): Record<PhysicalFieldType, number> {
  const distribution: Record<PhysicalFieldType, number> = {
    boolean: 0,
    percentage: 0,
    currency: 0,
    integer: 0,
    number: 0,
    date: 0,
    text: 0,
  };

  for (const value of values) distribution[physicalTypeOf(value)] += 1;
  return distribution;
}

function physicalTypeOf(value: string): PhysicalFieldType {
  if (isBoolean(value)) return "boolean";
  if (isPercentage(value)) return "percentage";
  if (isCurrency(value)) return "currency";
  if (isInteger(value)) return "integer";
  if (isNumber(value)) return "number";
  if (isDate(value)) return "date";
  return "text";
}

function hasMixedPhysicalTypes(distribution: Record<PhysicalFieldType, number>): boolean {
  const families = new Set<string>();
  for (const [type, count] of Object.entries(distribution)) {
    if (count > 0) families.add(type === "integer" || type === "number" ? "number" : type);
  }
  return families.size > 1;
}

function dominantPhysicalType(values: string[]): Exclude<PhysicalFieldType, "text"> | null {
  if (values.length < 2) return null;
  const candidates: Array<[Exclude<PhysicalFieldType, "text">, (value: string) => boolean]> = [
    ["boolean", isBoolean],
    ["percentage", isPercentage],
    ["currency", isCurrency],
    ["integer", isInteger],
    ["number", isNumber],
    ["date", isDate],
  ];
  let best: (typeof candidates)[number] | null = null;
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = values.filter(candidate[1]).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best && bestCount > values.length / 2 ? best[0] : null;
}

function countInvalidValues(type: InferredFieldType, values: string[]): number {
  const validator: Partial<Record<InferredFieldType, (value: string) => boolean>> = {
    boolean: isBoolean,
    percentage: isPercentage,
    currency: isCurrency,
    integer: isInteger,
    number: isNumber,
    date: isDate,
  };
  const isValid = validator[type];
  return isValid ? values.filter((value) => !isValid(value)).length : 0;
}

function redactRow(row: ParsedRow): RedactedSample {
  return {
    rowNumber: row.rowNumber,
    values: Object.fromEntries(
      Object.entries(row.values).map(([fieldId, value]) => [fieldId, redactValue(value)]),
    ),
  };
}

function redactValue(value: string): string {
  if (value === "") return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "[redacted email]";
  if (/^\+?[\d\s().-]{7,}$/.test(value)) return "[redacted phone]";
  if (value.length > 160) return `${value.slice(0, 157)}...`;
  return value;
}

function isBoolean(value: string): boolean {
  return /^(true|false|yes|no|y|n)$/i.test(value);
}

function isPercentage(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*%$/.test(value);
}

function isCurrency(value: string): boolean {
  return /^(?:[$€£¥]\s?|(?:USD|EUR|GBP|JPY)\s?)[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value);
}

function isInteger(value: string): boolean {
  return /^[+-]?\d+$/.test(value);
}

function isNumber(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

function isDate(value: string): boolean {
  return /^(?:\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

function numberForProfile(value: string): number | null {
  const normalized = value
    .replace(/^(?:[$€£¥]\s?|(?:USD|EUR|GBP|JPY)\s?)/, "")
    .replace(/%$/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
