# AI-Assisted Data Standardization Pipeline

Compiles the 19 messy YSI survey exports into one clean, provenance-carrying long table. Design: **Claude judges once (cached, reviewable artifacts) — TypeScript computes always.** Plan: [plans/01-standardization-pipeline.md](../plans/01-standardization-pipeline.md).

## Run

```bash
bun pipeline/run.ts                      # full run (uses cached artifacts where present)
bun pipeline/run.ts --stage profile      # S0 only, no API calls
bun pipeline/run.ts --force              # regenerate Claude artifacts (mappings, registry, grades)
bun pipeline/run.ts --include-deferred   # also process the two 113/142-col K&B files
```

Needs `ANTHROPIC_API_KEY` in root `.env` (bun auto-loads it). Model: `claude-opus-4-8`, structured outputs, adaptive thinking.

## Stages

| Stage | What | Claude? | Artifact |
| --- | --- | --- | --- |
| S0 profile | delimiter/BOM/headers/fill-rates/samples | no | `build/profile.json` |
| S1 map | per-file column → canonical-metric mapping | ✅ per file, cached | `pipeline/mappings/*.json` (git-tracked, review these!) |
| S2 resolve | entity resolution → org registry | ✅ once, cached | `pipeline/registry/orgs.json` |
| S3/S4 transform | extract + normalize (currencies, `120.000`, `R26 766 051`, prose numbers) | no | in-memory |
| S5 validate+grade | funnel monotonicity, outliers, duplicates; evidence grades A–D from "how calculated" texts | ✅ batched, cached | `build/{anomalies,grades}.json` |
| S6 emit | the deliverables | no | see below |

## Outputs (the contract — shapes in [plans/README.md](../plans/README.md))

- **`data/harmonized.json`** — long-format records: `org_id · cohort · wave · date · metric · value · currency/value_usd · raw_value · source_file/row/column · grade (A–D) + reason`. Nothing silently dropped: unparseable values ship with `value: null`, grade D, raw preserved.
- **`data/orgs.json`** — canonical org registry (aliases, people, email domains, cohorts) + unresolved rows.
- **`build/coverage.json`** — metric × cohort|wave fill matrix + grade distribution → **input for the KPI recommender (plan 02)**.
- **`build/anomalies.json`** — funnel-monotonicity violations, negative values, >10× outliers, cross-file conflicts → **dashboard alert-strip content (plan 03)**.
- **`build/parse-failures.json`** — every value that didn't normalize, with reasons.

## Evidence grades

**A** measured (records-based) · **B** calculated / self-reported · **C** estimated (extrapolations, household multipliers, prose-extracted numbers) · **D** contradicted (monotonicity violation, impossible value, unparseable). Deterministic downgrades always win over Claude's grade.

## Generalizing to a new dataset

Add files + a manifest entry (`cohort/wave/date/delimiter`), run — S1 proposes mappings, you review the JSON, done. The taxonomy (`pipeline/schema/metrics.json`) is the stable target; `rates.json` is demo-grade fixed FX.
