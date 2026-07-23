import type { FieldProfile, ParsedTable, PhysicalType, SourceProfile } from "./types";

/** Physical value classes; "numeric" family = integer | number. */
type ValueClass = "boolean" | "percentage" | "currency" | "integer" | "number" | "date" | "other";

const BOOLEAN_RE = /^(yes|no|true|false)$/i;
const PERCENT_RE = /^[-+]?[\d.,\s']*\d\s*%$/;
const CURRENCY_LEAD_RE = /^([$€£¥₦]|R\$?|USD|EUR|GBP|ZAR|NGN|BRL|KES|INR|USh|KSh)\s*[-+]?[\d.,\s']*\d$/i;
const CURRENCY_TRAIL_RE = /^[-+]?[\d.,\s']*\d\s*([$€£¥₦]|R|USD|EUR|GBP|ZAR|NGN|BRL|KES|INR)$/i;
const DATE_RES = [
  /^\d{4}-\d{1,2}-\d{1,2}([T ][\d:.+Z-]+)?$/i, // ISO date / datetime
  /^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/, // 31.12.2024, 12/31/24
  /^\d{4}\/\d{1,2}\/\d{1,2}$/,
  /^\d{1,2}[- ](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ]\d{2,4}$/i,
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ -]\d{1,2},?[ -]\d{2,4}$/i,
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ -]\d{4}$/i,
];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Alphanumeric code: letters + digits mixed, no spaces (e.g. "AP1-0032"). */
const CODE_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Parse a numeric string incl. thousand separators ("1,234.56", "1.234,56", "1 200"). */
function parseNumeric(raw: string): number | null {
  const s = raw.trim();
  if (!/^[-+]?[\d.,\s']+$/.test(s) || !/\d/.test(s)) return null;
  let t = s.replace(/[\s']/g, "");
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) t = t.replace(/\./g, "").replace(",", "."); // 1.234,56
    else t = t.replace(/,/g, ""); // 1,234.56
  } else if (lastComma > -1) {
    const parts = t.split(",");
    if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) t = parts.join("");
    else if (parts.length === 2) t = `${parts[0]}.${parts[1]}`;
    else return null;
  } else if (lastDot > -1) {
    const parts = t.split(".");
    if (parts.length > 2) {
      if (parts.slice(1).every((p) => p.length === 3)) t = parts.join(""); // 1.234.567
      else return null;
    }
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Extract the numeric magnitude from a value, tolerating % and currency tokens. */
function numericValueOf(raw: string): number | null {
  const stripped = raw
    .trim()
    .replace(/%$/, "")
    .replace(/^([$€£¥₦]|R\$?|USD|EUR|GBP|ZAR|NGN|BRL|KES|INR)\s*/i, "")
    .replace(/\s*([$€£¥₦]|R|USD|EUR|GBP|ZAR|NGN|BRL|KES|INR)$/i, "")
    .trim();
  return parseNumeric(stripped);
}

function classifyValue(raw: string): ValueClass {
  const s = raw.trim();
  if (BOOLEAN_RE.test(s)) return "boolean";
  if (PERCENT_RE.test(s)) return "percentage";
  if (CURRENCY_LEAD_RE.test(s) || CURRENCY_TRAIL_RE.test(s)) return "currency";
  const n = parseNumeric(s);
  if (n !== null) return Number.isInteger(n) && !/[.]\d|,\d{1,2}$/.test(s) ? "integer" : "number";
  if (DATE_RES.some((re) => re.test(s))) return "date";
  return "other";
}

/** Family key for mixed-type detection: integer + number are compatible. */
function familyOf(cls: ValueClass): string {
  return cls === "integer" || cls === "number" ? "numeric" : cls;
}

function redactSample(value: string): string {
  const email = value.match(/^([^@\s]+)@([^@\s]+)$/);
  if (email) return `${(email[1] ?? "").slice(0, 1)}…@${email[2]}`;
  if (value.length > 80) return `${value.slice(0, 80)}…`;
  return value;
}

function profileField(
  fieldId: string,
  header: string,
  index: number,
  allValues: string[],
  totalRows: number,
): FieldProfile {
  const nonEmpty = allValues.filter((v) => v.trim() !== "");
  const nullRate = totalRows === 0 ? 0 : (totalRows - nonEmpty.length) / totalRows;
  const distinct = [...new Set(nonEmpty)];

  let inferredType: PhysicalType = "empty";
  let mixedTypes = false;
  let numericRange: { min: number; max: number } | null = null;

  if (nonEmpty.length > 0) {
    const classes = nonEmpty.map(classifyValue);
    const familyCounts = new Map<string, number>();
    for (const cls of classes) {
      const fam = familyOf(cls);
      familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
    }
    let dominantFamily = "other";
    let dominantCount = 0;
    for (const [fam, count] of familyCounts) {
      if (count > dominantCount) {
        dominantFamily = fam;
        dominantCount = count;
      }
    }
    mixedTypes = (nonEmpty.length - dominantCount) / nonEmpty.length > 0.1;

    switch (dominantFamily) {
      case "boolean":
        inferredType = "boolean";
        break;
      case "percentage":
        inferredType = "percentage";
        break;
      case "currency":
        inferredType = "currency";
        break;
      case "numeric":
        inferredType = classes.some((c) => c === "number") ? "number" : "integer";
        break;
      case "date":
        inferredType = "date";
        break;
      default: {
        const uniqueRatio = distinct.length / nonEmpty.length;
        const looksLikeIds =
          nonEmpty.filter((v) => CODE_RE.test(v.trim()) || EMAIL_RE.test(v.trim())).length / nonEmpty.length >= 0.9;
        if (uniqueRatio >= 0.95 && looksLikeIds) {
          inferredType = "identifier";
        } else if (distinct.length <= 12 && totalRows > 0 && distinct.length < 0.5 * totalRows) {
          inferredType = "category";
        } else {
          inferredType = "text";
        }
      }
    }

    if (
      inferredType === "integer" ||
      inferredType === "number" ||
      inferredType === "percentage" ||
      inferredType === "currency"
    ) {
      const nums = nonEmpty.map(numericValueOf).filter((n): n is number => n !== null);
      if (nums.length > 0) {
        numericRange = { min: Math.min(...nums), max: Math.max(...nums) };
      }
    }
  }

  return {
    fieldId,
    header,
    index,
    inferredType,
    nullRate,
    uniqueCount: distinct.length,
    numericRange,
    samples: distinct.slice(0, 5).map(redactSample),
    mixedTypes,
  };
}

export function profileTable(table: ParsedTable): SourceProfile {
  const totalRows = table.rows.length;
  const fields = table.fields.map((field) =>
    profileField(
      field.id,
      field.header,
      field.index,
      table.rows.map((row) => row.values[field.id] ?? ""),
      totalRows,
    ),
  );
  return {
    sourceId: table.sourceId,
    fileName: table.fileName,
    sheetName: table.sheetName,
    rowCount: totalRows,
    parseWarnings: table.warnings,
    fields,
  };
}
