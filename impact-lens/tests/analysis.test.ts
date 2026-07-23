import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis/pipeline";
import { parseClaudeStructuredOutput } from "@/lib/claude/run";
import { parseTabularFile } from "@/lib/files/parse";
import { profileTable } from "@/lib/files/profile";
import { evaluateMetric } from "@/lib/metrics/evaluate";
import {
  semanticPlanSchema,
  type MetricDefinition,
  type SemanticPlan,
} from "@/lib/semantic/schema";
import { validateSemanticPlan } from "@/lib/semantic/validate";

const encoder = new TextEncoder();

function metric(input: {
  metricId: string;
  label: string;
  sourceId: string;
  fieldId: string;
  operation?: "count" | "distinct_count" | "sum" | "average";
  groupBy?: string;
}): MetricDefinition {
  return {
    metricId: input.metricId,
    label: input.label,
    description: `Deterministic calculation for ${input.label}.`,
    formula: {
      kind: "atomic",
      operation: input.operation ?? "sum",
      field: { sourceId: input.sourceId, fieldId: input.fieldId },
    },
    filters: [],
    ...(input.groupBy
      ? { groupBy: { sourceId: input.sourceId, fieldId: input.groupBy } }
      : {}),
    rationale: "The parsed values support this direct aggregation.",
    confidence: 0.8,
  };
}

function planFor(sourceId: string, metrics: MetricDefinition[]): SemanticPlan {
  const sourceField = (fieldId: string) => ({ sourceId, fieldId });
  const fieldIdFor = (definition: MetricDefinition) =>
    definition.formula.kind === "atomic"
      ? definition.formula.field.fieldId
      : definition.formula.numerator.field.fieldId;
  const firstFieldId = fieldIdFor(metrics[0]);
  const lastFieldId = fieldIdFor(metrics.at(-1) ?? metrics[0]);
  const coverage = (status: "identified" | "partial" | "not_found", fieldId: string) => ({
    status,
    fields: [sourceField(fieldId)],
    rationale: "This is a bounded interpretation of fields present in the uploaded table.",
  });

  return semanticPlanSchema.parse({
    summary: "The uploaded table contains activity and outcome evidence with explicit missingness.",
    tableInterpretations: [
      {
        sourceId,
        purpose: "outcomes",
        fieldRoles: metrics.map((definition) => ({
          field: definition.formula.kind === "atomic"
            ? definition.formula.field
            : definition.formula.numerator.field,
          role: "measure",
          rationale: "This field is used only as a calculable measure.",
        })),
      },
    ],
    proposedMetrics: metrics,
    theoryOfChangeCoverage: {
      activity: coverage("identified", firstFieldId),
      output: coverage("identified", firstFieldId),
      outcome: coverage("partial", lastFieldId),
      impact: coverage("not_found", lastFieldId),
    },
    fiveDimensionsCoverage: {
      what: coverage("identified", firstFieldId),
      who: coverage("partial", firstFieldId),
      howMuch: coverage("identified", firstFieldId),
      contribution: coverage("partial", lastFieldId),
      risk: coverage("not_found", lastFieldId),
    },
    frameworkTags: [],
    uncertainties: ["Blank source values remain missing and are not converted into zero."],
  });
}

async function sourceText(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceText(path);
    return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name) ? readFile(path, "utf8") : "";
  }));
  return contents.join("\n");
}

describe("ImpactLens analysis core", () => {
  it("1. parses and profiles CSV without turning missing values into zero", () => {
    const csv = "\uFEFFid;wave;beneficiaries\nA;Baseline;100\nB;Baseline;\n";
    const [table] = parseTabularFile({ name: "impact.csv", bytes: encoder.encode(csv) });
    const profile = profileTable(table);

    expect(table.rows).toHaveLength(2);
    expect(table.fields.map((field) => field.header)).toEqual(["id", "wave", "beneficiaries"]);
    expect(table.rows[0].rowNumber).toBe(2);
    expect(table.rows[1].values.beneficiaries).toBe("");
    expect(profile.fields.find((field) => field.header === "beneficiaries")).toMatchObject({
      inferredType: "integer",
      nullRate: 0.5,
    });
  });

  it("2. parses every non-empty worksheet in an XLSX upload", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["label"], ["first"]]), "Reach");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["label"], ["second"]]), "Outcomes");
    const bytes = new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer);

    const tables = parseTabularFile({ name: "programme.xlsx", bytes });

    expect(tables).toHaveLength(2);
    expect(tables.map((table) => table.sheetName)).toEqual(["Reach", "Outcomes"]);
    expect(new Set(tables.map((table) => table.sourceId)).size).toBe(2);
  });

  it("3. extracts a Claude envelope and rejects invalid references and invented standards IDs", () => {
    const sourceId = "measurements.csv";
    const profiles = [{ sourceId, fields: [{ fieldId: "amount" }] }];
    const validPlan = planFor(sourceId, [metric({ metricId: "total", label: "Total amount", sourceId, fieldId: "amount" })]);
    const context = { projectName: "Unseen programme", goal: "Review directly measured outcomes" };

    expect(
      parseClaudeStructuredOutput(JSON.stringify({ structured_output: JSON.stringify(validPlan) }), semanticPlanSchema),
    ).toEqual(validPlan);
    expect(() => validateSemanticPlan({
      ...validPlan,
      proposedMetrics: [metric({ metricId: "bad-field", label: "Bad field", sourceId, fieldId: "not_present" })],
    }, profiles, context)).toThrow(/unavailable field/i);
    expect(() => validateSemanticPlan({
      ...validPlan,
      proposedMetrics: [{
        ...validPlan.proposedMetrics[0],
        formula: { kind: "atomic", operation: "median", field: { sourceId, fieldId: "amount" } },
      }],
    }, profiles, context)).toThrow();
    expect(() => validateSemanticPlan({
      ...validPlan,
      frameworkTags: [{
        framework: "sdg",
        label: "Candidate SDG alignment",
        confidence: 0.5,
        evidenceBasis: "field_evidence",
        rationale: "This is only a candidate interpretation.",
        caveat: "No compliance claim is made.",
        referenceId: "3.8.2",
      }],
    }, profiles, context)).toThrow(/user-supplied context/i);
    expect(() => validateSemanticPlan({
      ...validPlan,
      frameworkTags: [{
        framework: "iris_plus",
        label: "Candidate IRIS+ alignment",
        confidence: 0.5,
        evidenceBasis: "field_evidence",
        rationale: "This is only a candidate interpretation.",
        caveat: "No compliance claim is made.",
        referenceId: "PI4060",
      }],
    }, profiles, context)).toThrow(/user-supplied context/i);
  });

  it("4. calculates constrained metrics with evidence and handles a zero denominator", () => {
    const [table] = parseTabularFile({
      name: "metrics.csv",
      bytes: encoder.encode("amount;denominator\n100;0\n200;0\n;0\n"),
    });
    const sourceId = table.sourceId;
    const sum = evaluateMetric(metric({ metricId: "sum", label: "Amount total", sourceId, fieldId: "amount" }), [table]);
    const average = evaluateMetric(metric({ metricId: "average", label: "Amount average", sourceId, fieldId: "amount", operation: "average" }), [table]);
    const zeroDenominator = evaluateMetric({
      ...metric({ metricId: "ratio", label: "Amount per denominator", sourceId, fieldId: "amount" }),
      formula: {
        kind: "ratio",
        numerator: { kind: "atomic", operation: "sum", field: { sourceId, fieldId: "amount" } },
        denominator: { kind: "atomic", operation: "sum", field: { sourceId, fieldId: "denominator" } },
      },
    }, [table]);

    expect(sum.value).toBe(300);
    expect(average.value).toBe(150);
    expect(sum.coverage).toBeCloseTo(2 / 3);
    expect(sum.evidence.exampleRows).toHaveLength(2);
    expect(sum.evidence.exampleRows.length).toBeLessThanOrEqual(5);
    expect(zeroDenominator.value).toBeNull();
    expect(zeroDenominator.evidence.caveats).toContain("Ratio denominator evaluated to zero; the metric value is unavailable.");
  });

  it("5. runs an unseen fixture end to end with warnings, a chart, and auditable evidence", async () => {
    const fixtureName = "unseen-programme.csv";
    const sourceId = fixtureName;
    const headers = ["zone_marker", "attended_sessions", "stated_goal"];
    const firstMetric = metric({
      metricId: "sessions",
      label: "Sessions delivered",
      sourceId,
      fieldId: "attended_sessions",
      groupBy: "zone_marker",
    });
    const secondMetric = metric({
      metricId: "outcome", label: "Reported outcome", sourceId, fieldId: "stated_goal", operation: "average",
    });
    const deterministicPlan = planFor(sourceId, [firstMetric, secondMetric]);
    const fixtureBytes = new Uint8Array(
      await readFile(join(process.cwd(), "tests", "fixtures", fixtureName)),
    );

    const analysis = await runAnalysis({
      projectName: "A previously unseen local programme",
      goal: "Summarise the activity and reported outcome data.",
      files: [{
        name: fixtureName,
        bytes: fixtureBytes,
      }],
      interpret: async () => deterministicPlan,
      now: new Date("2026-07-23T12:00:00.000Z"),
    });

    expect(analysis.dashboard.metrics).toHaveLength(2);
    expect(analysis.dashboard.chart?.type).toBe("bar");
    expect(analysis.dashboard.fiveDimensions).toHaveLength(5);
    expect(analysis.dashboard.warnings.some((warning) => /missingness/i.test(warning.title))).toBe(true);
    expect(analysis.metricResults[0].evidence.exampleRows).toEqual([
      { sourceId, rowNumber: 2 },
      { sourceId, rowNumber: 3 },
      { sourceId, rowNumber: 4 },
      { sourceId, rowNumber: 5 },
    ]);

    const applicationSource = await sourceText(join(process.cwd(), "src"));
    for (const header of headers) {
      expect(applicationSource).not.toContain(header);
    }
  });
});
