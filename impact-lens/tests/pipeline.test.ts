import { describe, expect, it } from "vitest";
import { runAnalysis } from "@/lib/analysis/pipeline";
import { profileTable } from "@/lib/files/profile";
import type { ParsedTable } from "@/lib/files/types";
import type { SemanticPlan } from "@/lib/semantic/schema";

// Generic, unseen-style fixture — deliberately not Aurelia/YSI headers.
function buildFixture(): ParsedTable {
  const header = ["site_id", "region", "beneficiaries_reached", "notes"];
  const raw = [
    ["A1", "North", "100", "on track"],
    ["A2", "North", "150", ""],
    ["A3", "South", "", ""],
    ["A4", "South", "80", ""],
  ];
  return {
    sourceId: "unseen-csv",
    fileName: "unseen.csv",
    sheetName: null,
    fields: header.map((h, i) => ({ id: `f${i}`, header: h, index: i })),
    rows: raw.map((r, i) => ({
      rowNumber: i + 2,
      values: Object.fromEntries(header.map((h, j) => [`f${j}`, r[j]])),
    })),
    warnings: [],
  };
}

describe("runAnalysis", () => {
  it("5. runs the full unseen-file thesis: KPIs, one chart, Five Dimensions, a missingness warning, real evidence", async () => {
    const table = buildFixture();
    const profiles = [profileTable(table)];

    const plan: SemanticPlan = {
      understanding: "A reach-tracking table split by region.",
      tables: [{ sourceId: "unseen-csv", purpose: "survey_responses", rationale: "One row per site." }],
      proposedMetrics: [
        {
          id: "m-total",
          name: "Total beneficiaries reached",
          description: "Sum of beneficiaries_reached across all sites.",
          formula: { kind: "atomic", expr: { op: "sum", ref: { sourceId: "unseen-csv", fieldId: "f2" }, filters: [] } },
          groupBy: null,
          unit: "people",
          confidence: 0.8,
          assumptions: [],
          caveats: [],
        },
        {
          id: "m-by-region",
          name: "Beneficiaries by region",
          description: "Sum of beneficiaries_reached grouped by region.",
          formula: { kind: "atomic", expr: { op: "sum", ref: { sourceId: "unseen-csv", fieldId: "f2" }, filters: [] } },
          groupBy: { sourceId: "unseen-csv", fieldId: "f1" },
          unit: "people",
          confidence: 0.8,
          assumptions: [],
          caveats: [],
        },
      ],
      candidateJoin: null,
      orderedFunnel: null,
      theoryOfChange: {
        activity: { status: "partial", fieldRefs: [], rationale: "" },
        output: { status: "identified", fieldRefs: [{ sourceId: "unseen-csv", fieldId: "f2" }], rationale: "" },
        outcome: { status: "not_found", fieldRefs: [], rationale: "" },
        impact: { status: "not_found", fieldRefs: [], rationale: "" },
      },
      fiveDimensions: {
        what: { status: "identified", fieldRefs: [{ sourceId: "unseen-csv", fieldId: "f2" }], rationale: "" },
        who: { status: "identified", fieldRefs: [{ sourceId: "unseen-csv", fieldId: "f0" }], rationale: "" },
        howMuch: { status: "identified", fieldRefs: [{ sourceId: "unseen-csv", fieldId: "f2" }], rationale: "" },
        contribution: { status: "not_found", fieldRefs: [], rationale: "" },
        risk: { status: "partial", fieldRefs: [{ sourceId: "unseen-csv", fieldId: "f3" }], rationale: "" },
      },
      frameworkTags: [],
      uncertainties: [],
    };

    const dashboard = await runAnalysis({
      context: { projectName: "Unseen test", goal: "Measure reach", attention: null },
      files: [],
      interpret: async () => plan,
      precomputed: { tables: [table], profiles },
    });

    expect(dashboard.metrics).toHaveLength(2);
    expect(dashboard.chart).not.toBeNull();
    expect(["bar", "line", "funnel"]).toContain(dashboard.chart?.type);
    expect(dashboard.plan.fiveDimensions.what.status).toBe("identified");
    expect(dashboard.warnings.some((w) => /missing/i.test(w.message))).toBe(true);

    const rowNumbers = new Set(table.rows.map((r) => r.rowNumber));
    for (const { result } of dashboard.metrics) {
      for (const example of result.evidence.exampleRows) {
        expect(rowNumbers.has(example.rowNumber)).toBe(true);
      }
    }
  });
});
