export type ChartSeriesPoint = { label: string; value: number | null };

export type PrimaryChart = {
  type: "line" | "bar" | "funnel";
  title: string;
  description: string;
  series: ChartSeriesPoint[];
  metricId?: string;
};

export type ChartCandidate = {
  metricId: string;
  label: string;
  series: ChartSeriesPoint[];
  groupingKind?: "time" | "category" | "ordered_stage";
  explicitlyOrderedSameTableFunnel?: boolean;
};

export function selectPrimaryChart(candidates: ChartCandidate[]): PrimaryChart | undefined {
  const usable = candidates.filter((candidate) => candidate.series.filter((point) => point.value !== null).length >= 2);
  const time = usable.find((candidate) => candidate.groupingKind === "time");
  if (time) return chartFrom(time, "line", `${time.label} over time`);

  const funnel = usable.find(
    (candidate) => candidate.groupingKind === "ordered_stage" && candidate.explicitlyOrderedSameTableFunnel,
  );
  if (funnel) return chartFrom(funnel, "funnel", funnel.label);

  const category = usable.find((candidate) => candidate.groupingKind === "category");
  if (category) return chartFrom(category, "bar", `${category.label} by category`);
  return undefined;
}

function chartFrom(candidate: ChartCandidate, type: PrimaryChart["type"], title: string): PrimaryChart {
  const series = candidate.groupingKind === "time" ? sortTimeSeries(candidate.series) : [...candidate.series];
  const populated = series.filter((point) => point.value !== null);
  return {
    type,
    title,
    metricId: candidate.metricId,
    series,
    description: `${candidate.label} ranges from ${format(populated[0]?.value)} to ${format(populated.at(-1)?.value)} across ${populated.length} points.`,
  };
}

/** Returns a copy ordered by parsed time, with deterministic handling for invalid or tied labels. */
export function sortTimeSeries(series: ChartSeriesPoint[]): ChartSeriesPoint[] {
  return series
    .map((point, index) => ({ point, index, timestamp: Date.parse(point.label) }))
    .sort((left, right) => {
      const leftIsDate = Number.isFinite(left.timestamp);
      const rightIsDate = Number.isFinite(right.timestamp);
      if (leftIsDate && rightIsDate) {
        return left.timestamp - right.timestamp
          || left.point.label.localeCompare(right.point.label, "en-US")
          || left.index - right.index;
      }
      if (leftIsDate !== rightIsDate) return leftIsDate ? -1 : 1;
      return left.point.label.localeCompare(right.point.label, "en-US") || left.index - right.index;
    })
    .map(({ point }) => point);
}

function format(value: number | null | undefined): string {
  return value === null || value === undefined ? "missing" : value.toLocaleString("en-US");
}
