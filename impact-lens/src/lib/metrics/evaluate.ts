import type { ParsedRow, ParsedTable } from "@/lib/files/types";
import type {
  AtomicExpr,
  FieldRef,
  MetricDefinition,
  MetricFilter,
} from "@/lib/semantic/schema";
import type { MetricResult } from "@/lib/analysis/types";

/** NFKC + trim + casefold. The only normalization used for value comparisons. */
export function normalizeValue(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/**
 * Parse a raw cell into a number. Strips %, currency symbols/codes (R$, R, $, €, £),
 * spaces and thousand separators; handles "1,200.50" and European "1.200,50".
 * Returns null when the value is not parseable.
 */
export function parseNumericValue(raw: string): number | null {
  let s = raw.normalize("NFKC").trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/%/g, "");
  s = s.replace(/R\$/gi, "");
  s = s.replace(/[$€£]/g, "");
  // "R" as a bare currency code, prefix or suffix around the numeric part.
  s = s.replace(/^R(?=[\s\d.,-])/i, "");
  s = s.replace(/([\d.,])R$/i, "$1");
  s = s.replace(/[\s  ]/g, "");
  s = s.replace(/(\d)'(?=\d)/g, "$1");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s === "") return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // The LAST separator is the decimal separator; the other is thousands.
    const decimalSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    s = s.split(thousandsSep).join("");
    if (s.split(decimalSep).length - 1 > 1) return null;
    if (decimalSep === ",") s = s.replace(",", ".");
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const occurrences = s.split(sep).length - 1;
    if (occurrences > 1) {
      // "1.200.500" style grouping.
      s = s.split(sep).join("");
    } else {
      const idx = s.indexOf(sep);
      const before = s.slice(0, idx);
      const after = s.slice(idx + 1);
      // A lone separator followed by exactly 3 digits at the end of an
      // integer-looking token is a thousands separator ("1.200" / "1,200").
      const isThousands = /^\d{1,3}$/.test(before) && before !== "0" && /^\d{3}$/.test(after);
      if (isThousands) {
        s = before + after;
      } else if (sep === ",") {
        s = `${before}.${after}`;
      }
    }
  }

  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

/** Sum of parseable numeric values of a field over a whole table; null when none parse. */
export function sumParseableField(table: ParsedTable, fieldId: string): number | null {
  let sum = 0;
  let used = 0;
  for (const row of table.rows) {
    const n = parseNumericValue(row.values[fieldId] ?? "");
    if (n !== null) {
      sum += n;
      used += 1;
    }
  }
  return used > 0 ? sum : null;
}

function isRatioLike(expr: unknown): boolean {
  return (
    typeof expr === "object" &&
    expr !== null &&
    ("numerator" in expr || "denominator" in expr || (expr as { kind?: string }).kind === "ratio")
  );
}

function assertAtomic(expr: AtomicExpr): void {
  if (isRatioLike(expr)) {
    throw new Error("Nested ratio formulas are not supported");
  }
}

function requireTable(tables: ParsedTable[], sourceId: string): ParsedTable {
  const table = tables.find((t) => t.sourceId === sourceId);
  if (!table) throw new Error(`Unknown source table "${sourceId}"`);
  return table;
}

function requireField(table: ParsedTable, fieldId: string): void {
  if (!table.fields.some((f) => f.id === fieldId)) {
    throw new Error(`Unknown field "${fieldId}" in source "${table.sourceId}"`);
  }
}

type JoinSpec = { left: FieldRef; right: FieldRef } | null | undefined;

/** Returns raw value of `ref` for a row of `baseTable`; null = no join match. */
type ValueGetter = (row: ParsedRow) => string | null;

function makeGetter(
  baseTable: ParsedTable,
  tables: ParsedTable[],
  join: JoinSpec,
  ref: FieldRef,
): ValueGetter {
  if (ref.sourceId === baseTable.sourceId) {
    requireField(baseTable, ref.fieldId);
    return (row) => row.values[ref.fieldId] ?? "";
  }
  if (!join) {
    throw new Error(
      `Field ${ref.sourceId}.${ref.fieldId} lives in another file — a confirmed join is required`,
    );
  }
  let baseKeyField: string;
  let foreignKeyRef: FieldRef;
  if (join.left.sourceId === baseTable.sourceId && join.right.sourceId === ref.sourceId) {
    baseKeyField = join.left.fieldId;
    foreignKeyRef = join.right;
  } else if (join.right.sourceId === baseTable.sourceId && join.left.sourceId === ref.sourceId) {
    baseKeyField = join.right.fieldId;
    foreignKeyRef = join.left;
  } else {
    throw new Error(
      `Confirmed join does not connect "${baseTable.sourceId}" to "${ref.sourceId}"`,
    );
  }
  requireField(baseTable, baseKeyField);
  const foreignTable = requireTable(tables, ref.sourceId);
  requireField(foreignTable, foreignKeyRef.fieldId);
  requireField(foreignTable, ref.fieldId);
  const lookup = new Map<string, ParsedRow>();
  for (const row of foreignTable.rows) {
    const key = normalizeValue(row.values[foreignKeyRef.fieldId] ?? "");
    if (key !== "" && !lookup.has(key)) lookup.set(key, row);
  }
  return (row) => {
    const key = normalizeValue(row.values[baseKeyField] ?? "");
    if (key === "") return null;
    const match = lookup.get(key);
    if (!match) return null;
    return match.values[ref.fieldId] ?? "";
  };
}

function passesFilter(filter: MetricFilter, raw: string | null): boolean {
  if (raw === null) return false;
  const norm = normalizeValue(raw);
  if (filter.op === "equals") return norm === normalizeValue(filter.value ?? "");
  return norm !== "";
}

interface OpOutcome {
  value: number | null;
  used: number;
  missing: number;
  excluded: number;
  contributing: ParsedRow[];
}

function applyOp(
  op: AtomicExpr["op"],
  valueGetter: ValueGetter | null,
  rows: ParsedRow[],
): OpOutcome {
  if (op === "count") {
    return { value: rows.length, used: rows.length, missing: 0, excluded: 0, contributing: rows };
  }
  if (!valueGetter) throw new Error(`${op} requires a field reference`);
  if (op === "distinct_count") {
    const seen = new Set<string>();
    const contributing: ParsedRow[] = [];
    let missing = 0;
    for (const row of rows) {
      const raw = valueGetter(row);
      const norm = raw === null ? "" : normalizeValue(raw);
      if (norm === "") {
        missing += 1;
        continue;
      }
      seen.add(norm);
      contributing.push(row);
    }
    return { value: seen.size, used: contributing.length, missing, excluded: 0, contributing };
  }
  // sum / average
  let sum = 0;
  let missing = 0;
  let excluded = 0;
  const contributing: ParsedRow[] = [];
  for (const row of rows) {
    const raw = valueGetter(row);
    if (raw === null || normalizeValue(raw) === "") {
      missing += 1;
      continue;
    }
    const n = parseNumericValue(raw);
    if (n === null) {
      excluded += 1;
      continue;
    }
    sum += n;
    contributing.push(row);
  }
  const used = contributing.length;
  let value: number | null = null;
  if (used > 0) value = op === "sum" ? sum : sum / used;
  return { value, used, missing, excluded, contributing };
}

interface AtomicEvaluation {
  table: ParsedTable;
  filtered: ParsedRow[];
  outcome: OpOutcome;
  valueGetter: ValueGetter | null;
}

function evaluateAtomicExpr(
  expr: AtomicExpr,
  tables: ParsedTable[],
  join: JoinSpec,
  fallbackSourceId?: string,
): AtomicEvaluation {
  assertAtomic(expr);
  if ((expr.op === "sum" || expr.op === "average" || expr.op === "distinct_count") && !expr.ref) {
    throw new Error(`${expr.op} requires a field reference`);
  }
  const baseSourceId = expr.ref?.sourceId ?? expr.filters[0]?.ref.sourceId ?? fallbackSourceId;
  if (!baseSourceId) {
    throw new Error("Cannot determine a source table for a ref-less count with no filters");
  }
  const table = requireTable(tables, baseSourceId);
  const filterGetters = expr.filters.map((filter) => ({
    filter,
    get: makeGetter(table, tables, join, filter.ref),
  }));
  const filtered = table.rows.filter((row) =>
    filterGetters.every(({ filter, get }) => passesFilter(filter, get(row))),
  );
  const valueGetter = expr.ref ? makeGetter(table, tables, join, expr.ref) : null;
  const outcome = applyOp(expr.op, valueGetter, filtered);
  return { table, filtered, outcome, valueGetter };
}

function headerFor(ref: FieldRef | null, tables: ParsedTable[]): string {
  if (!ref) return "rows";
  const table = tables.find((t) => t.sourceId === ref.sourceId);
  const field = table?.fields.find((f) => f.id === ref.fieldId);
  return field?.header ?? ref.fieldId;
}

function atomicFormulaString(expr: AtomicExpr, tables: ParsedTable[]): string {
  return `${expr.op}(${headerFor(expr.ref, tables)})`;
}

function collectRefs(definition: MetricDefinition): FieldRef[] {
  const refs: FieldRef[] = [];
  const push = (ref: FieldRef | null): void => {
    if (!ref) return;
    if (!refs.some((r) => r.sourceId === ref.sourceId && r.fieldId === ref.fieldId)) {
      refs.push(ref);
    }
  };
  const pushExpr = (expr: AtomicExpr): void => {
    push(expr.ref);
    for (const filter of expr.filters) push(filter.ref);
  };
  if (definition.formula.kind === "atomic") {
    pushExpr(definition.formula.expr);
  } else {
    pushExpr(definition.formula.numerator);
    pushExpr(definition.formula.denominator);
  }
  push(definition.groupBy);
  return refs;
}

interface Groups {
  order: string[];
  byKey: Map<string, { label: string; rows: ParsedRow[] }>;
}

function groupRows(rows: ParsedRow[], groupGetter: ValueGetter): Groups {
  const byKey = new Map<string, { label: string; rows: ParsedRow[] }>();
  const order: string[] = [];
  for (const row of rows) {
    const raw = groupGetter(row);
    if (raw === null) continue;
    const label = raw.normalize("NFKC").trim();
    if (label === "") continue;
    const key = normalizeValue(raw);
    let group = byKey.get(key);
    if (!group) {
      group = { label, rows: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.rows.push(row);
  }
  return { order, byKey };
}

export function evaluateMetric(
  definition: MetricDefinition,
  tables: ParsedTable[],
  join?: { left: FieldRef; right: FieldRef } | null,
): MetricResult {
  const formula = definition.formula;
  if (isRatioLike(formula) && formula.kind !== "ratio") {
    throw new Error("Nested ratio formulas are not supported");
  }

  const caveats: string[] = [];
  const series: Array<{ label: string; value: number | null }> = [];
  let value: number | null = null;
  let recordsAvailable = 0;
  let recordsUsed = 0;
  let missingRecords = 0;
  let excludedRecords = 0;
  let exampleSource: ParsedRow[] = [];
  let exampleSourceId = "";
  let formulaString = "";
  let filters: MetricFilter[] = [];

  if (formula.kind === "atomic") {
    const evaluated = evaluateAtomicExpr(formula.expr, tables, join);
    value = evaluated.outcome.value;
    recordsAvailable = evaluated.filtered.length;
    recordsUsed = evaluated.outcome.used;
    missingRecords = evaluated.outcome.missing;
    excludedRecords = evaluated.outcome.excluded;
    exampleSource = evaluated.outcome.contributing;
    exampleSourceId = evaluated.table.sourceId;
    formulaString = atomicFormulaString(formula.expr, tables);
    filters = formula.expr.filters;
    if (definition.groupBy) {
      const groupGetter = makeGetter(evaluated.table, tables, join, definition.groupBy);
      const groups = groupRows(evaluated.filtered, groupGetter);
      for (const key of groups.order) {
        const group = groups.byKey.get(key)!;
        const outcome = applyOp(formula.expr.op, evaluated.valueGetter, group.rows);
        series.push({ label: group.label, value: outcome.value });
      }
    }
  } else {
    assertAtomic(formula.numerator);
    assertAtomic(formula.denominator);
    const numeratorSourceId =
      formula.numerator.ref?.sourceId ?? formula.numerator.filters[0]?.ref.sourceId;
    const denominatorSourceId =
      formula.denominator.ref?.sourceId ?? formula.denominator.filters[0]?.ref.sourceId;
    const num = evaluateAtomicExpr(formula.numerator, tables, join, denominatorSourceId);
    const den = evaluateAtomicExpr(formula.denominator, tables, join, numeratorSourceId);
    if (den.outcome.value === null || den.outcome.value === 0) {
      value = null;
      caveats.push("Cannot divide by zero: the denominator evaluated to zero or was not computable");
    } else if (num.outcome.value === null) {
      value = null;
      caveats.push("Numerator could not be computed from any usable records");
    } else {
      value = num.outcome.value / den.outcome.value;
    }
    recordsAvailable = num.filtered.length;
    recordsUsed = num.outcome.used;
    missingRecords = num.outcome.missing;
    excludedRecords = num.outcome.excluded + den.outcome.excluded;
    exampleSource = num.outcome.contributing;
    exampleSourceId = num.table.sourceId;
    formulaString = `${atomicFormulaString(formula.numerator, tables)} / ${atomicFormulaString(formula.denominator, tables)}`;
    filters = [...formula.numerator.filters, ...formula.denominator.filters];
    if (definition.groupBy) {
      if (num.table.sourceId === den.table.sourceId) {
        const groupGetter = makeGetter(num.table, tables, join, definition.groupBy);
        const numGroups = groupRows(num.filtered, groupGetter);
        const denGroups = groupRows(den.filtered, groupGetter);
        for (const key of numGroups.order) {
          const numGroup = numGroups.byKey.get(key)!;
          const denGroup = denGroups.byKey.get(key);
          const numOutcome = applyOp(formula.numerator.op, num.valueGetter, numGroup.rows);
          const denOutcome = denGroup
            ? applyOp(formula.denominator.op, den.valueGetter, denGroup.rows)
            : null;
          const denValue = denOutcome?.value ?? null;
          const groupValue =
            denValue === null || denValue === 0 || numOutcome.value === null
              ? null
              : numOutcome.value / denValue;
          series.push({ label: numGroup.label, value: groupValue });
        }
      } else {
        caveats.push("Group-by was not applied: numerator and denominator use different tables");
      }
    }
  }

  if (excludedRecords > 0) {
    caveats.push(
      `${excludedRecords} value${excludedRecords === 1 ? "" : "s"} could not be parsed as numbers and were excluded`,
    );
  }

  const fieldRefs = collectRefs(definition);
  const sourceIds = [...new Set([exampleSourceId, ...fieldRefs.map((r) => r.sourceId)])].filter(
    (s) => s !== "",
  );
  const exampleRows = exampleSource
    .slice(0, 5)
    .map((row) => ({ sourceId: exampleSourceId, rowNumber: row.rowNumber }));

  return {
    metricId: definition.id,
    value,
    coverage: recordsAvailable > 0 ? recordsUsed / recordsAvailable : 0,
    recordsUsed,
    recordsAvailable,
    missingRecords,
    excludedRecords,
    series,
    evidence: {
      sourceIds,
      fieldRefs,
      formula: formulaString,
      filters,
      exampleRows,
      caveats,
    },
  };
}
