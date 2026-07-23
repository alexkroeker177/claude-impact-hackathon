import { expect, test } from "vitest";

import { ClaudeRunError, parseStructuredText } from "@/lib/claude/run";
import type { SourceProfile } from "@/lib/files/types";
import { semanticPlanSchema, type SemanticPlan } from "@/lib/semantic/schema";
import { validateSemanticPlan } from "@/lib/semantic/validate";

const profiles: SourceProfile[] = [
  {
    sourceId: "s0",
    fileName: "survey.csv",
    sheetName: null,
    rowCount: 120,
    parseWarnings: [],
    fields: [
      {
        fieldId: "f0",
        header: "Beneficiary ID",
        index: 0,
        inferredType: "identifier",
        nullRate: 0,
        uniqueCount: 120,
        numericRange: null,
        samples: ["AP1-001", "AP1-002"],
        mixedTypes: false,
      },
      {
        fieldId: "f1",
        header: "Cohort",
        index: 1,
        inferredType: "category",
        nullRate: 0.02,
        uniqueCount: 4,
        numericRange: null,
        samples: ["AP1", "AP2"],
        mixedTypes: false,
      },
      {
        fieldId: "f2",
        header: "Income (EUR)",
        index: 2,
        inferredType: "number",
        nullRate: 0.1,
        uniqueCount: 88,
        numericRange: { min: 0, max: 2400 },
        samples: ["1200", "800"],
        mixedTypes: false,
      },
    ],
  },
];

function makePlan(): SemanticPlan {
  const emptyCoverage = { status: "not_found" as const, fieldRefs: [], rationale: "Not present in the data." };
  return {
    understanding: "A survey of program beneficiaries across cohorts.",
    tables: [{ sourceId: "s0", purpose: "survey_responses", rationale: "One row per respondent." }],
    proposedMetrics: [
      {
        id: "m1_avg_income",
        name: "Average income",
        description: "Average reported income across respondents.",
        howCalculated: null,
        formula: {
          kind: "atomic",
          expr: { op: "average", ref: { sourceId: "s0", fieldId: "f2" }, filters: [] },
        },
        groupBy: { sourceId: "s0", fieldId: "f1" },
        unit: "EUR",
        confidence: 0.8,
        assumptions: ["Income field is monthly."],
        caveats: ["10% of rows have no income value."],
      },
    ],
    candidateJoin: null,
    orderedFunnel: null,
    theoryOfChange: {
      activity: emptyCoverage,
      output: {
        status: "identified",
        fieldRefs: [{ sourceId: "s0", fieldId: "f0" }],
        rationale: "Respondent records evidence delivered surveys.",
      },
      outcome: {
        status: "partial",
        fieldRefs: [{ sourceId: "s0", fieldId: "f2" }],
        rationale: "Income proxies economic outcome.",
      },
      impact: emptyCoverage,
    },
    fiveDimensions: {
      what: {
        status: "identified",
        fieldRefs: [{ sourceId: "s0", fieldId: "f2" }],
        rationale: "Income change is the measured outcome.",
      },
      who: {
        status: "identified",
        fieldRefs: [{ sourceId: "s0", fieldId: "f1" }],
        rationale: "Cohort segments the beneficiary population.",
      },
      howMuch: emptyCoverage,
      contribution: emptyCoverage,
      risk: emptyCoverage,
    },
    frameworkTags: [
      {
        framework: "sdg",
        label: "Decent Work and Economic Growth",
        confidence: 0.5,
        evidenceBasis: "field_evidence",
        rationale: "Income data suggests alignment as a candidate interpretation.",
        caveat: "Candidate interpretation only, not a compliance claim.",
        referenceId: null,
      },
    ],
    uncertainties: ["Wave information is missing, so change over time cannot be computed."],
  };
}

test("3. semantic plan validation, schema rejection, and runner extraction", () => {
  const userContext = { text: "Track income growth for our beneficiaries." };

  // (a) a fully valid plan passes strict validation and is returned unchanged.
  const plan = makePlan();
  expect(validateSemanticPlan(plan, profiles, userContext)).toBe(plan);
  expect(semanticPlanSchema.safeParse(plan).success).toBe(true);

  // (b) a metric referencing a nonexistent fieldId throws /unavailable field/i.
  const badFieldPlan = makePlan();
  badFieldPlan.proposedMetrics[0].formula = {
    kind: "atomic",
    expr: { op: "sum", ref: { sourceId: "s0", fieldId: "f99" }, filters: [] },
  };
  expect(() => validateSemanticPlan(badFieldPlan, profiles, userContext)).toThrow(/unavailable field/i);

  // (c) a formula with an unsupported op fails semanticPlanSchema.safeParse.
  const badOpPlan = JSON.parse(JSON.stringify(makePlan())) as Record<string, unknown>;
  (badOpPlan.proposedMetrics as Array<Record<string, unknown>>)[0].formula = {
    kind: "atomic",
    expr: { op: "median", ref: { sourceId: "s0", fieldId: "f2" }, filters: [] },
  };
  expect(semanticPlanSchema.safeParse(badOpPlan).success).toBe(false);

  // (d) an sdg tag with a referenceId absent from userContext.text throws /user-supplied context/i.
  const sdgPlan = makePlan();
  sdgPlan.frameworkTags[0].referenceId = "3.2.1";
  expect(() => validateSemanticPlan(sdgPlan, profiles, userContext)).toThrow(/user-supplied context/i);

  // Same for an iris_plus code.
  const irisPlan = makePlan();
  irisPlan.frameworkTags[0] = { ...irisPlan.frameworkTags[0], framework: "iris_plus", referenceId: "PI4060" };
  expect(() => validateSemanticPlan(irisPlan, profiles, userContext)).toThrow(/user-supplied context/i);

  // But a user-supplied code passes when it literally appears in the context text.
  expect(() =>
    validateSemanticPlan(irisPlan, profiles, { text: "Please map to IRIS+ PI4060 where possible." }),
  ).not.toThrow();

  // Runner extraction: synthetic response text -> JSON.parse -> validate (no live API).
  const validPlanText = JSON.stringify(makePlan());
  const extracted = parseStructuredText(validPlanText, (raw) => semanticPlanSchema.parse(raw));
  expect(extracted.proposedMetrics[0].id).toBe("m1_avg_income");

  // Non-JSON output surfaces as a typed invalid_output failure.
  try {
    parseStructuredText("not json at all", (raw) => raw);
    expect.unreachable("parseStructuredText should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(ClaudeRunError);
    expect((err as ClaudeRunError).kind).toBe("invalid_output");
  }

  // Valid JSON that fails the validator also surfaces as invalid_output.
  try {
    parseStructuredText("{\"nope\": true}", (raw) => semanticPlanSchema.parse(raw));
    expect.unreachable("validator failure should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(ClaudeRunError);
    expect((err as ClaudeRunError).kind).toBe("invalid_output");
  }
});
