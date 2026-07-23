import { buildInsights, explainFormula, type Insight } from "@/lib/analysis/explain";
import type { SourceProfile } from "@/lib/files/types";
import type { CoverageStatus, MetricDefinition } from "@/lib/semantic/schema";
import type { AnalysisWarning, DashboardAnalysis, MetricResult } from "@/lib/analysis/types";

export interface ReportProject {
  id: string;
  name: string;
  status: string;
  synthetic: boolean;
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" });

function formatValue(value: number | null, unit: string | null): string {
  if (value === null) return "—";
  const formatted = Math.abs(value) > 99_999 ? compactFormat.format(value) : numberFormat.format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fileNameFor(sourceId: string, profiles: SourceProfile[]): string {
  const profile = profiles.find((p) => p.sourceId === sourceId);
  if (!profile) return sourceId;
  return profile.sheetName ? `${profile.fileName} · ${profile.sheetName}` : profile.fileName;
}

const STATUS_LABEL: Record<CoverageStatus, string> = {
  identified: "Answered",
  partial: "Partly answered",
  not_found: "Not answered",
};

const STATUS_CLASS: Record<CoverageStatus, string> = {
  identified: "status-good",
  partial: "status-watch",
  not_found: "status-muted",
};

const INSIGHT_MARK: Record<Insight["tone"], { symbol: string; label: string; className: string }> = {
  good: { symbol: "✓", label: "Good sign", className: "status-good" },
  watch: { symbol: "!", label: "Worth checking", className: "status-watch" },
  problem: { symbol: "✕", label: "Fix first", className: "status-problem" },
};

const SEVERITY_LABEL: Record<AnalysisWarning["severity"], string> = {
  info: "Note",
  warning: "Needs a look",
  critical: "Must fix",
};

const DIMENSIONS: Array<{ key: keyof DashboardAnalysis["plan"]["fiveDimensions"]; question: string }> = [
  { key: "what", question: "What changed?" },
  { key: "who", question: "Who was affected?" },
  { key: "howMuch", question: "How big was the change?" },
  { key: "contribution", question: "Would it have happened anyway?" },
  { key: "risk", question: "How solid is the evidence?" },
];

function metricSection(
  definition: MetricDefinition,
  result: MetricResult,
  profiles: SourceProfile[],
): string {
  const coveragePct = Math.round(result.coverage * 100);
  const sources = result.evidence.sourceIds.map((id) => fileNameFor(id, profiles)).join(", ");
  const caveats = [...definition.caveats, ...result.evidence.caveats];
  return `
    <div class="metric">
      <div class="metric-head">
        <span class="metric-name">${escapeHtml(definition.name)}</span>
        <span class="metric-value">${escapeHtml(formatValue(result.value, definition.unit))}</span>
      </div>
      <p class="metric-desc">${escapeHtml(definition.description)}</p>
      <p class="metric-how"><strong>How it's calculated:</strong> ${escapeHtml(
        definition.howCalculated ?? explainFormula(definition, profiles),
      )}</p>
      <p class="metric-meta">Based on ${numberFormat.format(result.recordsUsed)} of ${numberFormat.format(
        result.recordsAvailable,
      )} available records (${coveragePct}%)${sources ? ` · Source: ${escapeHtml(sources)}` : ""}</p>
      ${caveats.length > 0 ? `<p class="metric-meta">Keep in mind: ${escapeHtml(caveats.join(" "))}</p>` : ""}
    </div>`;
}

function warningList(title: string, warnings: AnalysisWarning[], emptyText: string): string {
  const body =
    warnings.length === 0
      ? `<p class="muted">${escapeHtml(emptyText)}</p>`
      : warnings
          .map(
            (w) =>
              `<p class="warning"><span class="severity">${SEVERITY_LABEL[w.severity]}</span> ${escapeHtml(w.message)}</p>`,
          )
          .join("");
  return `<h3>${escapeHtml(title)}</h3>${body}`;
}

/**
 * Renders the full analysis as a self-contained, print-friendly HTML report —
 * same insights, KPIs, dimensions and flags as the dashboard, deterministic,
 * nothing recomputed or forecast.
 */
export function buildReportHtml(data: DashboardAnalysis, project: ReportProject): string {
  const insights = data.insights ?? buildInsights(data);
  const dataWarnings = data.warnings.filter((w) => w.scope === "data");
  const projectWarnings = data.warnings.filter((w) => w.scope === "project");
  const notFoundDimensions = DIMENSIONS.filter((d) => data.plan.fiveDimensions[d.key].status === "not_found");
  const lowCoverageMetrics = data.metrics.filter((m) => m.result.coverage < 0.6);

  const missingItems = [
    ...notFoundDimensions.map((d) => `An answer to “${d.question}” — nothing in the data covers it yet.`),
    ...lowCoverageMetrics.map(
      (m) =>
        `More complete records for “${m.definition.name}” (only ${Math.round(m.result.coverage * 100)}% of rows were usable).`,
    ),
  ];
  if (missingItems.length === 0) {
    missingItems.push("A comparison group or baseline period, to support a claim that the programme caused the change.");
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(project.name)} — Impact Report</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 24px; font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #fff; line-height: 1.6; }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.1em; color: #047857; border-bottom: 2px solid #047857; padding-bottom: 6px; margin: 36px 0 14px; }
  h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin: 20px 0 8px; }
  p { margin: 0 0 8px; font-size: 15px; }
  .muted { color: #94a3b8; }
  .subtitle { color: #64748b; font-size: 14px; }
  .assessment { font-size: 16px; border-left: 4px solid #047857; padding: 10px 14px; background: #ecfdf5; border-radius: 0 8px 8px 0; }
  .insight { display: flex; gap: 10px; align-items: baseline; }
  .mark { font-weight: 700; width: 16px; flex-shrink: 0; text-align: center; }
  .status-good { color: #047857; }
  .status-watch { color: #b45309; }
  .status-problem { color: #dc2626; }
  .status-muted { color: #64748b; }
  .metric { padding: 14px 0; border-bottom: 1px solid #e2e8f0; }
  .metric:last-child { border-bottom: none; }
  .metric-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .metric-name { font-weight: 600; font-size: 16px; }
  .metric-value { font-size: 22px; font-weight: 700; color: #047857; white-space: nowrap; }
  .metric-desc { color: #475569; }
  .metric-how { background: #f8fafc; border-radius: 6px; padding: 8px 10px; }
  .metric-meta { font-size: 13.5px; color: #64748b; margin-bottom: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
  .warning { padding: 8px 10px; background: #f8fafc; border-radius: 6px; }
  .severity { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #b45309; margin-right: 6px; }
  ul { margin: 0; padding-left: 20px; font-size: 15px; }
  li { margin-bottom: 4px; }
  footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #94a3b8; }
  .print-button { position: fixed; top: 16px; right: 16px; background: #047857; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
  @media print {
    body { padding: 0; }
    .print-button { display: none; }
    h2 { break-after: avoid; }
    .metric, .warning, .insight { break-inside: avoid; }
  }
</style>
</head>
<body>
<button class="print-button" onclick="window.print()">Print / Save as PDF</button>
<main>
  <header>
    <h1>${escapeHtml(project.name)} — Impact Report</h1>
    <p class="subtitle">Analysis generated ${escapeHtml(new Date(data.generatedAt).toLocaleString("en-GB"))}${
      project.synthetic ? " · Synthetic demo data" : ""
    }</p>
  </header>

  <h2>What this data says</h2>
  <p class="assessment">${escapeHtml(data.assessment)}</p>
  ${insights
    .map((insight) => {
      const mark = INSIGHT_MARK[insight.tone];
      return `<p class="insight"><span class="mark ${mark.className}">${mark.symbol}</span><span><strong class="${mark.className}">${mark.label}:</strong> ${escapeHtml(insight.text)}</span></p>`;
    })
    .join("\n  ")}

  <h2>Key figures</h2>
  ${data.metrics.map(({ definition, result }) => metricSection(definition, result, data.profiles)).join("\n  ")}

  ${
    data.chart
      ? `<h2>${escapeHtml(data.chart.title)}</h2>
  <p>${escapeHtml(data.chart.summary)}</p>
  <table>
    <thead><tr><th>Stage</th><th>Value</th></tr></thead>
    <tbody>
      ${data.chart.points
        .map(
          (p) =>
            `<tr><td>${escapeHtml(p.label)}</td><td>${escapeHtml(p.value === null ? "—" : numberFormat.format(p.value))}</td></tr>`,
        )
        .join("\n      ")}
    </tbody>
  </table>`
      : ""
  }

  <h2>Five Dimensions of Impact</h2>
  <p class="subtitle">The five questions every impact report should answer — answered from this data where possible.</p>
  <table>
    <thead><tr><th>Question</th><th>Status</th><th>What the data shows</th></tr></thead>
    <tbody>
      ${DIMENSIONS.map(({ key, question }) => {
        const entry = data.plan.fiveDimensions[key];
        return `<tr><td>${escapeHtml(question)}</td><td class="${STATUS_CLASS[entry.status]}">${
          STATUS_LABEL[entry.status]
        }</td><td>${escapeHtml(entry.rationale || "Nothing in the data answers this yet.")}</td></tr>`;
      }).join("\n      ")}
    </tbody>
  </table>

  <h2>Needs review</h2>
  <p class="subtitle">Figures the checks flagged as inconsistent, implausible or thin — nothing was auto-corrected.</p>
  ${warningList("In the numbers", projectWarnings, "Nothing flagged — the reported figures are consistent.")}
  ${warningList("In the source files", dataWarnings, "Nothing flagged — the files parsed cleanly.")}

  <h2>What would make this analysis stronger</h2>
  <ul>
    ${missingItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n    ")}
  </ul>

  <footer>
    Generated by ImpactLens. Every figure above is traceable to its source file; nothing was auto-corrected,
    estimated or forecast.
  </footer>
</main>
</body>
</html>`;
}

/** Stable, filesystem-safe file name for the exported report. */
export function reportFileName(projectName: string, generatedAt: string): string {
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  return `${slug}-impact-report-${generatedAt.slice(0, 10)}.html`;
}
