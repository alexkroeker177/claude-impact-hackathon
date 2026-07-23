import { describe, expect, it } from "vitest";
import { runAnalysis } from "@/lib/analysis/pipeline";
import { buildReportHtml, reportFileName } from "@/lib/analysis/report";
import { profileTable } from "@/lib/files/profile";
import type { ParsedTable } from "@/lib/files/types";
import type { SemanticPlan } from "@/lib/semantic/schema";

function buildFixture(): ParsedTable {
  const header = ["site_id", "region", "beneficiaries_reached"];
  const raw = [
    ["A1", "North <b>bold</b>", "100"],
    ["A2", "North", "150"],
    ["A3", "South", "80"],
  ];
  return {
    sourceId: "report-csv",
    fileName: "report.csv",
    sheetName: null,
    fields: header.map((h, i) => ({ id: `f${i}`, header: h, index: i })),
    rows: raw.map((r, i) => ({
      rowNumber: i + 2,
      values: Object.fromEntries(header.map((h, j) => [`f${j}`, r[j]])),
    })),
    warnings: [],
  };
}

const plan: SemanticPlan = {
  understanding: "A reach-tracking table split by region.",
  tables: [{ sourceId: "report-csv", purpose: "survey_responses", rationale: "One row per site." }],
  proposedMetrics: [
    {
      id: "m-total",
      name: "Total beneficiaries reached",
      description: "Sum of beneficiaries_reached across all sites.",
      howCalculated: null,
      formula: { kind: "atomic", expr: { op: "sum", ref: { sourceId: "report-csv", fieldId: "f2" }, filters: [] } },
      groupBy: null,
      unit: "people",
      confidence: 0.8,
      assumptions: [],
      caveats: ["Counts <script>alert(1)</script> only reported figures."],
    },
  ],
  candidateJoin: null,
  orderedFunnel: null,
  theoryOfChange: {
    activity: { status: "partial", fieldRefs: [], rationale: "" },
    output: { status: "identified", fieldRefs: [{ sourceId: "report-csv", fieldId: "f2" }], rationale: "" },
    outcome: { status: "not_found", fieldRefs: [], rationale: "" },
    impact: { status: "not_found", fieldRefs: [], rationale: "" },
  },
  fiveDimensions: {
    what: { status: "identified", fieldRefs: [{ sourceId: "report-csv", fieldId: "f2" }], rationale: "Reach is tracked." },
    who: { status: "identified", fieldRefs: [{ sourceId: "report-csv", fieldId: "f0" }], rationale: "" },
    howMuch: { status: "identified", fieldRefs: [{ sourceId: "report-csv", fieldId: "f2" }], rationale: "" },
    contribution: { status: "not_found", fieldRefs: [], rationale: "" },
    risk: { status: "partial", fieldRefs: [], rationale: "" },
  },
  frameworkTags: [],
  uncertainties: [],
};

describe("buildReportHtml", () => {
  it("renders insights, KPIs with plain-language calculations, dimensions and flags into one HTML document", async () => {
    const table = buildFixture();
    const dashboard = await runAnalysis({
      context: { projectName: "Report test", goal: "Measure reach", attention: null },
      files: [],
      interpret: async () => plan,
      precomputed: { tables: [table], profiles: [profileTable(table)] },
    });

    const html = buildReportHtml(dashboard, {
      id: "p1",
      name: "Report <Test> & Demo",
      status: "ready",
      synthetic: true,
    });

    // Project name is present and HTML-escaped.
    expect(html).toContain("Report &lt;Test&gt; &amp; Demo — Impact Report");
    expect(html).not.toContain("<script>");
    // Assessment + KPI with its derived plain-language calculation.
    expect(html).toContain(dashboard.assessment.replaceAll("&", "&amp;").replaceAll("<", "&lt;"));
    expect(html).toContain("Total beneficiaries reached");
    expect(html).toContain("How it's calculated:");
    expect(html).toContain("adding up");
    // Five dimensions and the flags sections render.
    expect(html).toContain("Five Dimensions of Impact");
    expect(html).toContain("Would it have happened anyway?");
    expect(html).toContain("Needs review");
    expect(html).toContain("Synthetic demo data");
  });
});

describe("reportFileName", () => {
  it("builds a filesystem-safe name with the analysis date", () => {
    expect(reportFileName("Report <Test> & Demo", "2026-07-23T18:00:00.000Z")).toBe(
      "report-test-demo-impact-report-2026-07-23.html",
    );
    expect(reportFileName("***", "2026-07-23T18:00:00.000Z")).toBe("project-impact-report-2026-07-23.html");
  });
});
