import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dashboard, ProjectStatusPanel } from "./dashboard";
import type { DashboardAnalysis } from "@/types/dashboard";

const analysis: DashboardAnalysis = {
  project: {
    id: "demo",
    name: "WellSpring Technologies",
    goal: "Understand reach, depth of change, and evidence quality.",
    updatedAt: "23 Jul 2026, 17:30",
    sourceCount: 4,
    dataWindow: "Baseline to endline",
    status: "ready",
    synthetic: true,
  },
  assessment: {
    summary:
      "Reach remains strong through the outcome stage, while societal impact has thinner evidence coverage.",
    confidence: "medium",
    coverage: 0.82,
  },
  metrics: [
    {
      id: "people-informed",
      label: "People informed",
      value: 7500,
      displayValue: "7,500",
      unit: "people",
      coverage: 0.94,
      recordsUsed: 47,
      recordsAvailable: 50,
      missingRecords: 3,
      excludedRecords: 0,
      confidence: "high",
      context: "Top of the five-level impact funnel",
      evidence: {
        sources: ["AP1and2_April_25.xlsx · Impact sheet"],
        fields: ["Inform"],
        formula: "Sum of valid Inform values",
        filters: ["Non-empty numeric values"],
        exampleRows: [2, 8, 14].map((rowNumber) => ({ sourceId: "impact-sheet", rowNumber })),
        assumptions: [],
        caveats: ["Indirect reach may include modelled estimates."],
      },
    },
    {
      id: "lasting-impact",
      label: "Lasting impact",
      value: 5600,
      displayValue: "5,600",
      unit: "people",
      coverage: 0.78,
      recordsUsed: 39,
      recordsAvailable: 50,
      missingRecords: 9,
      excludedRecords: 2,
      confidence: "medium",
      context: "People reporting deep or lasting change",
      evidence: {
        sources: ["AP1and2_April_25.xlsx · Impact sheet"],
        fields: ["Impact"],
        formula: "Sum of valid Impact values",
        filters: ["Non-empty numeric values"],
        exampleRows: [2, 8].map((rowNumber) => ({ sourceId: "impact-sheet", rowNumber })),
        assumptions: [],
        caveats: ["Self-reported impact has not been externally verified."],
      },
    },
  ],
  chart: {
    type: "bar",
    title: "Reach-to-impact funnel",
    description: "Reported people decrease from Inform to Societal impact.",
    series: [
      { label: "Inform", value: 7500 },
      { label: "Engage", value: 6450 },
      { label: "Outcomes", value: 5600 },
      { label: "Impact", value: 5600 },
      { label: "Societal", value: 3500 },
    ],
  },
  fiveDimensions: [
    { dimension: "What", status: "identified", evidence: "Health and hygiene outcomes" },
    { dimension: "Who", status: "identified", evidence: "Vulnerable groups described" },
    { dimension: "How much", status: "identified", evidence: "Five-stage reach counts" },
    { dimension: "Contribution", status: "partial", evidence: "Attribution is self-reported" },
    { dimension: "Risk", status: "not_found", evidence: "No risk indicators found" },
  ],
  frameworkTags: [
    {
      framework: "sdg",
      label: "SDG 3 · Good Health and Well-being",
      confidence: 0.74,
      rationale: "Project context and outcome fields reference health access.",
      caveat: "Candidate interpretation, not standards compliance.",
    },
  ],
  warnings: [
    {
      id: "missingness",
      scope: "data",
      severity: "high",
      title: "High missingness in societal impact",
      detail: "54% of records do not contain a usable societal-impact value.",
      recommendation: "Confirm whether blanks mean not measured or not applicable.",
    },
  ],
  outlook: {
    status: "insufficient_evidence",
    summary: "There is not enough comparable time-series evidence for a defensible prognosis.",
    missingRequirements: ["Comparable outcome dates", "Confirmed target values"],
  },
};

describe("ImpactLens dashboard", () => {
  it("shows the overall assessment, KPIs, framework coverage, and chart summary", () => {
    render(<Dashboard analysis={analysis} />);

    expect(screen.getByRole("heading", { name: /wellspring technologies/i })).toBeVisible();
    expect(screen.getByText("7,500")).toBeVisible();
    expect(screen.getByText(/candidate alignment/i)).toBeVisible();
    expect(screen.getAllByText(/reported people decrease/i)).toHaveLength(2);
    expect(screen.getByText("Contribution")).toBeVisible();
  });

  it("opens auditable metric evidence from a KPI card", () => {
    render(<Dashboard analysis={analysis} />);

    fireEvent.click(
      screen.getByRole("button", { name: /view evidence for people informed/i }),
    );

    expect(screen.getByRole("dialog", { name: /people informed evidence/i })).toBeVisible();
    expect(screen.getByText("Sum of valid Inform values")).toBeVisible();
    expect(screen.getByText(/47 of 50 records used/i)).toBeVisible();
  });

  it("switches between early warnings and a non-forecasting outlook", () => {
    render(<Dashboard analysis={analysis} />);

    fireEvent.click(screen.getByRole("tab", { name: /early warnings/i }));
    expect(screen.getByText(/high missingness in societal impact/i)).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: /outlook/i }));
    expect(screen.getByRole("heading", { name: /insufficient evidence/i })).toBeVisible();
    expect(screen.getByText(/comparable outcome dates/i)).toBeVisible();
  });
});

describe("project result states", () => {
  it("keeps failed analyses retryable and preserves the parsed-state message", () => {
    render(
      <ProjectStatusPanel
        status="failed"
        message="Profiles are saved. Claude interpretation timed out."
      />,
    );

    expect(screen.getByText(/profiles are saved/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /retry interpretation/i })).toBeEnabled();
  });
});
