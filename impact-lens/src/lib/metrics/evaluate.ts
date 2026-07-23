import type { ParsedRow, ParsedTable } from "@/lib/files/parse";
import type {
  AtomicExpression,
  FieldRef,
  MetricDefinition,
  MetricFilter,
  RatioExpression,
} from "@/lib/semantic/schema";

export type {
  AtomicExpression,
  FieldRef,
  MetricDefinition,
  MetricFilter,
  RatioExpression,
} from "@/lib/semantic/schema";

export type ConfirmedExactJoin = {
  id?: string;
};

export type MetricResult = {
  metricId: string;
  value: number | null;
  coverage: number;
  recordsUsed: number;
  recordsAvailable: number;
  missingRecords: number;
  excludedRecords: number;
  series: Array<{ label: string; value: number | null }>;
  evidence: {
    sourceIds: string[];
    fieldRefs: FieldRef[];
    formula: string;
    filters: MetricFilter[];
    exampleRows: Array<{ sourceId: string; rowNumber: number }>;
    caveats: string[];
  };
};

type AtomicEvaluation = {
  value: number | null;
  contributingRows: ParsedRow[];
  usedRows: Set<number>;
  missingRows: Set<number>;
  excludedRows: Set<number>;
};

/**
 * Evaluates an already-validated definition using source strings only. No model
 * output is executed: supported operations, filters, and field references are
 * explicitly interpreted here.
 */
export function evaluateMetric(
  definition: MetricDefinition,
  tables: ParsedTable[],
  _confirmedJoin?: ConfirmedExactJoin,
): MetricResult {
  assertFormulaIsSupported(definition.formula);
  const sourceId = sourceIdFor(definition);
  const table = tables.find((candidate) => candidate.sourceId === sourceId);

  if (!table) {
    throw new Error(`Metric ${definition.metricId} references unavailable source ${sourceId}.`);
  }

  assertReferencedFieldsExist(definition, table);
  const filtered = applyFilters(table.rows, definition.filters);
  const aggregate = evaluateExpression(definition.formula, filtered.rows);
  const caveats = [...filtered.caveats];

  if (definition.formula.kind === "ratio" && aggregate.value === null && aggregate.divideByZero) {
    caveats.push("Ratio denominator evaluated to zero; the metric value is unavailable.");
  }

  const recordsAvailable = table.rows.length;
  const recordsUsed = aggregate.recordsUsed;
  const missingRecords = aggregate.missingRows.size;
  const excludedRecords = filtered.excludedRecords + aggregate.excludedRows.size;
  const series = definition.groupBy
    ? evaluateSeries(definition.formula, filtered.rows, definition.groupBy)
    : [];

  return {
    metricId: definition.metricId,
    value: aggregate.value,
    coverage: recordsAvailable === 0 ? 0 : recordsUsed / recordsAvailable,
    recordsUsed,
    recordsAvailable,
    missingRecords,
    excludedRecords,
    series,
    evidence: {
      sourceIds: [sourceId],
      fieldRefs: collectFieldRefs(definition),
      formula: formatFormula(definition.formula),
      filters: definition.filters,
      exampleRows: aggregate.contributingRows.slice(0, 5).map((row) => ({
        sourceId,
        rowNumber: row.rowNumber,
      })),
      caveats,
    },
  };
}

function sourceIdFor(definition: MetricDefinition): string {
  const references = collectFieldRefs(definition);
  const sourceIds = new Set(references.map((reference) => reference.sourceId));

  if (sourceIds.size !== 1) {
    throw new Error(`Metric ${definition.metricId} must reference fields from exactly one source.`);
  }

  const sourceId = sourceIds.values().next().value;
  if (!sourceId) throw new Error(`Metric ${definition.metricId} has no field reference.`);
  return sourceId;
}

function assertFormulaIsSupported(
  formula: MetricDefinition["formula"],
): asserts formula is AtomicExpression | RatioExpression {
  if (formula.kind === "atomic") {
    if (!isAtomicOperation(formula.operation)) {
      throw new Error(`Unsupported metric operation: ${String(formula.operation)}.`);
    }
    return;
  }

  if (formula.kind !== "ratio") {
    throw new Error("Metric formula must be an atomic expression or a one-level ratio.");
  }

  if (formula.numerator.kind !== "atomic" || formula.denominator.kind !== "atomic") {
    throw new Error("Nested ratios are not supported.");
  }

  if (!isAtomicOperation(formula.numerator.operation) || !isAtomicOperation(formula.denominator.operation)) {
    throw new Error("A ratio can only contain supported atomic operations.");
  }
}

function isAtomicOperation(
  operation: string,
): operation is AtomicExpression["operation"] {
  return operation === "count" || operation === "distinct_count" || operation === "sum" || operation === "average";
}

function assertReferencedFieldsExist(definition: MetricDefinition, table: ParsedTable): void {
  const available = new Set(table.fields.map((field) => field.id));
  for (const reference of collectFieldRefs(definition)) {
    if (!available.has(reference.fieldId)) {
      throw new Error(
        `Metric ${definition.metricId} references unavailable field ${reference.fieldId} in ${reference.sourceId}.`,
      );
    }
  }
}

function applyFilters(rows: ParsedRow[], filters: MetricFilter[]): {
  rows: ParsedRow[];
  excludedRecords: number;
  caveats: string[];
} {
  const caveats: string[] = [];
  const retained = rows.filter((row) => {
    for (const filter of filters) {
      const value = row.values[filter.field.fieldId] ?? "";
      if (filter.operator === "equals" && value !== filter.value) return false;
      if (filter.operator === "not_empty" && value === "") return false;
      if (filter.operator !== "equals" && filter.operator !== "not_empty") {
        caveats.push(`Unsupported filter ${String(filter.operator)} was not applied.`);
        return false;
      }
    }
    return true;
  });

  return { rows: retained, excludedRecords: rows.length - retained.length, caveats };
}

function evaluateExpression(
  formula: AtomicExpression | RatioExpression,
  rows: ParsedRow[],
): AtomicEvaluation & { recordsUsed: number; divideByZero?: boolean } {
  if (formula.kind === "atomic") {
    const evaluation = evaluateAtomic(formula, rows);
    return { ...evaluation, recordsUsed: evaluation.usedRows.size };
  }

  const numerator = evaluateAtomic(formula.numerator, rows);
  const denominator = evaluateAtomic(formula.denominator, rows);
  const denominatorIsZero = denominator.value === 0;
  const contributingRows = uniqueRows([...numerator.contributingRows, ...denominator.contributingRows]);
  const usedRows = unionSets(numerator.usedRows, denominator.usedRows);
  const missingRows = differenceSet(unionSets(numerator.missingRows, denominator.missingRows), usedRows);
  const excludedRows = new Set(
    rows
      .map((row) => row.rowNumber)
      .filter((rowNumber) => !usedRows.has(rowNumber) && !missingRows.has(rowNumber)),
  );

  return {
    value:
      numerator.value === null || denominator.value === null || denominatorIsZero
        ? null
        : numerator.value / denominator.value,
    recordsUsed: usedRows.size,
    contributingRows,
    usedRows,
    missingRows,
    excludedRows,
    ...(denominatorIsZero ? { divideByZero: true } : {}),
  };
}

function evaluateAtomic(formula: AtomicExpression, rows: ParsedRow[]): AtomicEvaluation {
  const values = rows.map((row) => ({ row, value: row.values[formula.field.fieldId] ?? "" }));
  const missingRows = new Set(values.filter((entry) => entry.value === "").map((entry) => entry.row.rowNumber));
  const present = values.filter((entry) => entry.value !== "");

  if (formula.operation === "count") {
    return {
      value: present.length,
      contributingRows: present.map((entry) => entry.row),
      usedRows: new Set(present.map((entry) => entry.row.rowNumber)),
      missingRows,
      excludedRows: new Set(),
    };
  }

  if (formula.operation === "distinct_count") {
    const seen = new Set<string>();
    const contributingRows = present
      .filter((entry) => {
        if (seen.has(entry.value)) return false;
        seen.add(entry.value);
        return true;
      })
      .map((entry) => entry.row);
    return {
      value: seen.size,
      contributingRows,
      usedRows: new Set(present.map((entry) => entry.row.rowNumber)),
      missingRows,
      excludedRows: new Set(),
    };
  }

  const numeric = present.map((entry) => ({ ...entry, number: parseStrictNumber(entry.value) }));
  const valid = numeric.filter((entry): entry is (typeof numeric)[number] & { number: number } => entry.number !== null);
  const excludedRows = new Set(
    numeric.filter((entry) => entry.number === null).map((entry) => entry.row.rowNumber),
  );
  const usedRows = new Set(valid.map((entry) => entry.row.rowNumber));

  if (valid.length === 0) {
    return { value: null, contributingRows: [], usedRows, missingRows, excludedRows };
  }

  const sum = valid.reduce((total, entry) => total + entry.number, 0);
  return {
    value: formula.operation === "sum" ? sum : sum / valid.length,
    contributingRows: valid.map((entry) => entry.row),
    usedRows,
    missingRows,
    excludedRows,
  };
}

function evaluateSeries(
  formula: AtomicExpression | RatioExpression,
  rows: ParsedRow[],
  groupBy: FieldRef,
): Array<{ label: string; value: number | null }> {
  const groups = new Map<string, ParsedRow[]>();

  for (const row of rows) {
    const label = row.values[groupBy.fieldId] ?? "";
    const group = groups.get(label) ?? [];
    group.push(row);
    groups.set(label, group);
  }

  return [...groups.entries()].map(([label, groupRows]) => ({
    label,
    value: evaluateExpression(formula, groupRows).value,
  }));
}

function collectFieldRefs(definition: MetricDefinition): FieldRef[] {
  const refs: FieldRef[] = [];
  const formula = definition.formula;

  if (formula.kind === "atomic") {
    refs.push(formula.field);
  } else {
    refs.push(formula.numerator.field, formula.denominator.field);
  }

  refs.push(...definition.filters.map((filter) => filter.field));
  if (definition.groupBy) refs.push(definition.groupBy);

  const seen = new Set<string>();
  return refs.filter((reference) => {
    const key = `${reference.sourceId}\u0000${reference.fieldId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatFormula(formula: AtomicExpression | RatioExpression): string {
  if (formula.kind === "atomic") return formatAtomic(formula);
  return `${formatAtomic(formula.numerator)} / ${formatAtomic(formula.denominator)}`;
}

function formatAtomic(formula: AtomicExpression): string {
  return `${formula.operation}(${formula.field.sourceId}.${formula.field.fieldId})`;
}

function parseStrictNumber(value: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueRows(rows: ParsedRow[]): ParsedRow[] {
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.rowNumber)) return false;
    seen.add(row.rowNumber);
    return true;
  });
}

function unionSets<T>(left: Set<T>, right: Set<T>): Set<T> {
  return new Set([...left, ...right]);
}

function differenceSet<T>(values: Set<T>, excluded: Set<T>): Set<T> {
  return new Set([...values].filter((value) => !excluded.has(value)));
}
