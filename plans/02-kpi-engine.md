# Plan 02 — KPI Engine + Recommendation + Custom KPIs

> Owner: TBD. Consumes `data/harmonized.json`, `registry/orgs.json`, `build/coverage.json` (shapes: [plans/README.md](README.md)). Start against mock data immediately; real data lands 17:00.

## Core rule

KPIs are **JSON definitions evaluated by one generic engine** — never hard-coded functions. Built-in KPIs are just pre-shipped definitions; that's what proves extensibility in the pitch.

## KPI definition shape (owner may refine, keep it this small)

```json
{
  "id": "funnel-conversion-engage",
  "name": "Inform → Engage conversion",
  "formula": { "op": "ratio", "numerator": "funnel.engage", "denominator": "funnel.inform" },
  "group_by": ["org_id", "date"],
  "format": "percent",
  "direction": "higher-better",
  "min_grade": null,
  "origin": "builtin"
}
```

Engine: filter harmonized records → group → apply op (`ratio | sum | delta | latest | count-below-threshold`) → attach **confidence ceiling** = worst input grade per group. Five ops cover every built-in KPI below; resist adding more.

## Built-in definitions (write these first, they drive the dashboard)

1. Funnel conversion per level (4 ratios) · 2. Reach trajectory (`funnel.engage` latest per wave) · 3. % women reached, % marginalised · 4. Capability lift (delta before→after per competency — only if pipeline ships K&B files) · 5. Cost-per-beneficiary (`funding.total_usd / funnel.engage`) · 6. Runway alert (`count-below-threshold`, runway < 6 months) · 7. Silent churn (orgs with baseline wave but no later wave).

## KPI Recommendation (the innovative bit — one Claude call)

Input: `coverage.json` (metric × cohort × wave fill matrix + grade distribution) + the KPI definition schema + taxonomy. Output JSON:
- `recommended`: KPI definitions the data supports **now**, each with a coverage note ("computable for 9/12 AP3+AP4 orgs across 2 waves").
- `unlockable`: KPIs one survey question away — `{ kpi, missing_metric, suggested_question }`. *This is the survey-design-advisor moment in the pitch — make sure at least 2 good unlockables render.*

## Custom KPIs (natural language → definition)

Textbox → Claude call with (user text + taxonomy + coverage) → returns either a valid KPI definition JSON (schema-constrained) or `{ "error": "not measurable", "missing": [...], "suggested_question": "..." }`. Validate: referenced metrics exist in taxonomy AND have coverage. Then it's just another definition file — engine needs zero changes.

**Demo phrase to pre-test until it works flawlessly:** *"women reached per grant dollar"* → ratio of `funnel.engage.women_share_abs` over `funding.grants_usd`.

## Order of work

1. Engine + 3 built-in definitions on mock data (→ dashboard unblocked) — 45 min
2. Remaining built-ins + grade ceilings — 30 min
3. Recommendation call + render data — 30 min
4. Custom-KPI call (cut line: PLAN.md drops this before recommendations) — 30 min
5. 17:00–17:30: swap to real data, fix the surprises
