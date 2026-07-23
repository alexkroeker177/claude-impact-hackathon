import { describe, expect, it } from "vitest";
import { evaluateMetric } from "@/lib/metrics/evaluate";
import type { ParsedTable } from "@/lib/files/types";
import type { MetricDefinition } from "@/lib/semantic/schema";

function table(): ParsedTable {
  return {
    sourceId: "s0",
    fileName: "impact.csv",
    sheetName: null,
    fields: [
      { id: "f0", header: "id", index: 0 },
      { id: "f1", header: "amount", index: 1 },
    ],
    rows: [
      { rowNumber: 2, values: { f0: "A", f1: "100" } },
      { rowNumber: 3, values: { f0: "B", f1: "200" } },
      { rowNumber: 4, values: { f0: "C", f1: "" } },
    ],
    warnings: [],
  };
}

describe("evaluateMetric", () => {
  it("4. sums/averages numeric values, tracks coverage and evidence, and rejects divide-by-zero", () => {
    const tables = [table()];

    const sumDef: MetricDefinition = {
      id: "m-sum",
      name: "Total amount",
      description: "",
      howCalculated: null,
      formula: { kind: "atomic", expr: { op: "sum", ref: { sourceId: "s0", fieldId: "f1" }, filters: [] } },
      groupBy: null,
      unit: null,
      confidence: 0.9,
      assumptions: [],
      caveats: [],
    };
    const sumResult = evaluateMetric(sumDef, tables);
    expect(sumResult.value).toBe(300);
    expect(sumResult.coverage).toBeCloseTo(2 / 3);
    expect(sumResult.evidence.exampleRows.length).toBeGreaterThanOrEqual(1);
    expect(sumResult.evidence.exampleRows.length).toBeLessThanOrEqual(5);

    const avgDef: MetricDefinition = { ...sumDef, id: "m-avg", formula: { kind: "atomic", expr: { op: "average", ref: { sourceId: "s0", fieldId: "f1" }, filters: [] } } };
    expect(evaluateMetric(avgDef, tables).value).toBe(150);

    const ratioDef: MetricDefinition = {
      id: "m-ratio",
      name: "Zero-denominator ratio",
      description: "",
      howCalculated: null,
      formula: {
        kind: "ratio",
        numerator: { op: "sum", ref: { sourceId: "s0", fieldId: "f1" }, filters: [] },
        denominator: {
          op: "count",
          ref: null,
          filters: [{ ref: { sourceId: "s0", fieldId: "f1" }, op: "equals", value: "nonexistent" }],
        },
      },
      groupBy: null,
      unit: null,
      confidence: 0.5,
      assumptions: [],
      caveats: [],
    };
    const ratioResult = evaluateMetric(ratioDef, tables);
    expect(ratioResult.value).toBeNull();
    expect(ratioResult.evidence.caveats.some((c) => /divide by zero/i.test(c))).toBe(true);
  });
});
