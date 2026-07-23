"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { buildInsights, type Insight } from "@/lib/analysis/explain";
import type { CoverageStatus, MetricDefinition } from "@/lib/semantic/schema";
import type { AnalysisWarning, DashboardAnalysis, MetricResult } from "@/lib/analysis/types";

interface DashboardProps {
  data: DashboardAnalysis;
  project: { id: string; name: string; status: string; synthetic: boolean };
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" });

function formatValue(value: number | null, unit: string | null): string {
  if (value === null) return "—";
  const formatted = Math.abs(value) > 99_999 ? compactFormat.format(value) : numberFormat.format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

const DIMENSIONS: Array<{
  key: keyof DashboardAnalysis["plan"]["fiveDimensions"];
  label: string;
  question: string;
}> = [
  { key: "what", label: "What", question: "What changed?" },
  { key: "who", label: "Who", question: "Who was affected?" },
  { key: "howMuch", label: "How much", question: "How big was the change?" },
  { key: "contribution", label: "Contribution", question: "Would it have happened anyway?" },
  { key: "risk", label: "Risk", question: "How solid is the evidence?" },
];

const STATUS_BADGE: Record<CoverageStatus, string> = {
  identified: "border-transparent bg-emerald-100 text-emerald-800",
  partial: "border-transparent bg-amber-100 text-amber-800",
  not_found: "border-transparent bg-slate-200 text-slate-600",
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  identified: "Answered",
  partial: "Partly answered",
  not_found: "Not answered",
};

const SEVERITY_ICON = { info: Info, warning: AlertTriangle, critical: OctagonAlert };
const SEVERITY_COLOR = {
  info: "text-slate-400",
  warning: "text-amber-600",
  critical: "text-red-600",
};

const INSIGHT_ICON: Record<Insight["tone"], { icon: typeof Info; color: string }> = {
  good: { icon: CheckCircle2, color: "text-emerald-600" },
  watch: { icon: AlertTriangle, color: "text-amber-600" },
  problem: { icon: OctagonAlert, color: "text-red-600" },
};

function WarningRow({ warning }: { warning: AnalysisWarning }) {
  const Icon = SEVERITY_ICON[warning.severity];
  return (
    <div className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
      <Icon className={`mt-0.5 size-4 shrink-0 ${SEVERITY_COLOR[warning.severity]}`} />
      <p className="text-sm text-slate-700">{warning.message}</p>
    </div>
  );
}

export function Dashboard({ data, project }: DashboardProps) {
  const [selected, setSelected] = useState<{ definition: MetricDefinition; result: MetricResult } | null>(null);

  const dataWarnings = data.warnings.filter((w) => w.scope === "data");
  const projectWarnings = data.warnings.filter((w) => w.scope === "project");
  const flaggedCount = data.warnings.filter((w) => w.severity !== "info").length;

  const insights = buildInsights(data);
  const notFoundDimensions = DIMENSIONS.filter((d) => data.plan.fiveDimensions[d.key].status === "not_found");
  const lowCoverageMetrics = data.metrics.filter((m) => m.result.coverage < 0.6);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-950">{project.name}</h1>
            <Badge
              className={
                project.status === "ready"
                  ? "border-transparent bg-emerald-100 text-emerald-800"
                  : "border-transparent bg-amber-100 text-amber-800"
              }
            >
              {project.status}
            </Badge>
            {project.synthetic && <Badge variant="outline">Synthetic demo</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
      </div>

      <Card className="border-l-4 border-l-emerald-600">
        <CardHeader>
          <CardTitle className="text-base">What this data says</CardTitle>
          <CardDescription className="text-sm leading-6 text-slate-700">{data.assessment}</CardDescription>
        </CardHeader>
        {insights.length > 0 && (
          <CardContent className="flex flex-col gap-2.5">
            {insights.map((insight, i) => {
              const { icon: Icon, color } = INSIGHT_ICON[insight.tone];
              return (
                <div key={i} className="flex items-start gap-2.5">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} />
                  <p className="text-sm leading-6 text-slate-800">{insight.text}</p>
                </div>
              );
            })}
          </CardContent>
        )}
      </Card>

      <Tabs defaultValue="overall">
        <TabsList>
          <TabsTrigger value="overall">Overview</TabsTrigger>
          <TabsTrigger value="warnings">
            Needs review{flaggedCount > 0 ? ` (${flaggedCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="outlook">What&rsquo;s missing</TabsTrigger>
        </TabsList>

        <TabsContent value="overall" className="mt-6 flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.metrics.map(({ definition, result }) => (
              <button
                key={definition.id}
                onClick={() => setSelected({ definition, result })}
                className="text-left"
              >
                <Card className="h-full transition hover:ring-emerald-600/40">
                  <CardHeader>
                    <CardDescription>{definition.name}</CardDescription>
                    <CardTitle className="text-2xl">
                      {formatValue(result.value, definition.unit)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex h-full flex-col justify-between gap-2">
                    <p className="line-clamp-3 text-xs leading-5 text-slate-600">
                      {definition.description}
                    </p>
                    <p className="text-xs font-medium text-emerald-700">
                      How is this calculated? →
                    </p>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>

          {data.chart && (
            <Card>
              <CardHeader>
                <CardTitle>{data.chart.title}</CardTitle>
                <CardDescription>{data.chart.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={{ value: { label: "People", color: "#047857" } }} className="aspect-auto h-72 w-full">
                  {data.chart.type === "line" ? (
                    <LineChart data={data.chart.points}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={56}
                        tickFormatter={(v: number) => compactFormat.format(v)}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="value" stroke="#047857" strokeWidth={2} dot />
                    </LineChart>
                  ) : (
                    <BarChart
                      data={data.chart.points}
                      layout={data.chart.type === "funnel" ? "vertical" : "horizontal"}
                      margin={data.chart.type === "funnel" ? { right: 64 } : undefined}
                    >
                      <CartesianGrid vertical={data.chart.type !== "funnel"} horizontal={data.chart.type === "funnel"} />
                      {data.chart.type === "funnel" ? (
                        <>
                          <XAxis
                            type="number"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => compactFormat.format(v)}
                          />
                          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={100} />
                        </>
                      ) : (
                        <>
                          <XAxis dataKey="label" tickLine={false} axisLine={false} />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            width={56}
                            tickFormatter={(v: number) => compactFormat.format(v)}
                          />
                        </>
                      )}
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="value" fill="#047857" radius={4}>
                        {data.chart.type === "funnel" && (
                          <LabelList
                            dataKey="value"
                            position="right"
                            className="fill-slate-600"
                            fontSize={12}
                            formatter={(v) => compactFormat.format(Number(v))}
                          />
                        )}
                      </Bar>
                    </BarChart>
                  )}
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
              Five Dimensions of Impact
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              The five questions every impact report should answer — answered from this data where possible.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DIMENSIONS.map(({ key, question }) => {
                const entry = data.plan.fiveDimensions[key];
                return (
                  <Card key={key} size="sm" className="h-full">
                    <CardContent className="flex h-full flex-col items-start gap-2">
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{question}</span>
                        <Badge className={`shrink-0 ${STATUS_BADGE[entry.status]}`}>
                          {STATUS_LABEL[entry.status]}
                        </Badge>
                      </div>
                      <p className="text-sm leading-6 text-slate-600">
                        {entry.rationale || "Nothing in the data answers this yet."}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          {data.plan.frameworkTags.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
                Framework alignment
              </h3>
              <div className="flex flex-wrap gap-2">
                {data.plan.frameworkTags.map((tag, i) => (
                  <Badge key={i} variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                    Candidate alignment · {tag.label}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </TabsContent>

        <TabsContent value="warnings" className="mt-6 flex flex-col gap-6">
          <p className="text-sm text-slate-600">
            Figures the checks flagged as inconsistent, implausible or thin. Each one names its source file — nothing
            was auto-corrected.
          </p>
          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
              In the numbers
            </h3>
            {projectWarnings.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing flagged — the reported figures are consistent.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {projectWarnings.map((w) => (
                  <WarningRow key={w.id} warning={w} />
                ))}
              </div>
            )}
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
              In the source files
            </h3>
            {dataWarnings.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing flagged — the files parsed cleanly.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {dataWarnings.map((w) => (
                  <WarningRow key={w.id} warning={w} />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="outlook" className="mt-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Info className="size-4" />
              </EmptyMedia>
              <EmptyTitle>What would make this analysis stronger</EmptyTitle>
              <EmptyDescription>
                ImpactLens never forecasts or fills gaps with guesses. To say more, the data would need:
              </EmptyDescription>
            </EmptyHeader>
            <div className="flex w-full max-w-md flex-col gap-2 text-left text-sm text-slate-600">
              {notFoundDimensions.map((d) => (
                <p key={d.key}>· An answer to &ldquo;{d.question}&rdquo; — nothing in the data covers it yet.</p>
              ))}
              {lowCoverageMetrics.map((m) => (
                <p key={m.definition.id}>
                  · More complete records for &ldquo;{m.definition.name}&rdquo; (only {Math.round(m.result.coverage * 100)}% of rows were usable).
                </p>
              ))}
              {notFoundDimensions.length === 0 && lowCoverageMetrics.length === 0 && (
                <p>· A comparison group or baseline period, to support a claim that the programme caused the change.</p>
              )}
            </div>
          </Empty>
        </TabsContent>
      </Tabs>

      <EvidenceDrawer
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        definition={selected?.definition ?? null}
        result={selected?.result ?? null}
        profiles={data.profiles}
        chart={data.chart}
      />
    </div>
  );
}
