# Workstream Plans

> Split from [PLAN.md](../PLAN.md) (the master overview — read that first). One file per workstream so we can divide work and plan independently without stepping on each other.

| Plan | Workstream | Owner |
| --- | --- | --- |
| [01-standardization-pipeline.md](01-standardization-pipeline.md) | AI-assisted data standardization pipeline (profiling → mappings → entity resolution → normalize → grade → emit) | **Alex** |
| [02-kpi-engine.md](02-kpi-engine.md) | Declarative KPI engine + KPI recommendation + custom KPIs | TBD |
| [03-dashboard.md](03-dashboard.md) | `kpimpact/` Next.js dashboard (portfolio, org drill-down, provenance panel) | TBD |
| [04-report-and-pitch.md](04-report-and-pitch.md) | Report generator + pitch | TBD |

## The shared contract (agree once, then build in parallel)

Everything meets at two JSON artifacts. Dashboard and KPI engine build against **mock files matching these shapes from minute one**; the pipeline replaces them with real data at the 17:00 checkpoint.

### `data/harmonized.json` — long-format value records

```json
{
  "org_id": "wellspring-technologies",
  "cohort": "AP2",
  "wave": "followup-apr-2025",
  "date": "2025-04",
  "metric": "funnel.inform",
  "value": 7500,
  "unit": "people",
  "raw_value": "7500",
  "source_file": "AP1and2_April_25.csv",
  "source_row": 2,
  "source_column": "Inform: How many people have received educational health & hygiene messaging...",
  "grade": "C",
  "grade_reason": "Extrapolated: assumes each child shares with 3-4 family members",
  "methodology_text": "We calculated the number of people reached by combining direct and indirect..."
}
```

Money metrics additionally carry `"currency": "NGN"` and `"value_usd"` (see currency decision in plan 01).

### `registry/orgs.json` — canonical org registry

```json
{
  "org_id": "wellspring-technologies",
  "canonical_name": "WellSpring Technologies",
  "aliases": ["WellSpring Technologies"],
  "people": ["Adaeze Igwe"],
  "email_domains": ["wellspringtechnologies.org"],
  "cohorts": ["AP2"],
  "country": "Nigeria"
}
```

### Other interfaces

- KPI definitions: `kpis/definitions/*.json` (shape owned by plan 02).
- Canonical metric taxonomy: `pipeline/schema/metrics.json` (owned by plan 01, consumed by 02/03/04 — **frozen by 15:30**, additions allowed, renames forbidden after that).
- Wave/date manifest: `pipeline/schema/manifest.json` — hand-written map of all 19 files → (cohort, wave, date, delimiter).

## Timeline & checkpoints (from PLAN.md)

- **15:30** — metric taxonomy frozen; mock `harmonized.json` committed for dashboard/KPI work.
- **17:00** — HARD: real harmonized table replaces mock.
- **17:30** — KPI engine evaluating built-in definitions on real data.
- **19:00** — pitch draft; feature freeze ~19:15.
- Cut lines: see PLAN.md.
