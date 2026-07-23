# Plan 01 — AI-Assisted Data Standardization Pipeline

> Owner: **Alex**. Deep-dive plan, grounded in profiling all 19 CSVs (2026-07-23, see findings below).
> Output contract: `data/harmonized.json` + `registry/orgs.json` (shapes in [plans/README.md](README.md)).
> Principle throughout: **Claude judges once (cached, reviewable artifacts) — TypeScript computes always.**

## Profiling findings (what the pipeline must actually survive)

Ran a quote-aware profiler over all 19 files. Beyond the documented gotchas (3 semicolon files with BOM, multi-line quoted fields, mixed number formats), the load-bearing discoveries:

1. **Identity is a person+org+email triple, not an org name.** Column 0/1 `Name`/`Nome` usually holds a **person**; the org sits in column 2 (`Organisation`, `Nome da empresa`, `Company name`) — where it exists at all. `AP1_April_2023` (113 cols) and `AP1_Baseline_Nov_22` appear person-first. Emails exist **only** in AP3/AP4 files.
2. **Dirty identity data inside single columns:** `AP2_March_2024` row 1 has an org name ("NovaWell Technologies") in the person column. Person drift exists too: "Ijeoma Okoro" (AP1 BRA) vs "Ijeoma Okoro Nunes" (AP2 Oct 24).
3. **Org column position varies** (col 0, 1, 2, or 3 — AP4 midline has it at col 3, email at col 2).
4. **≥4 currencies:** `R` (ZAR), `$` (USD), `₦` (NGN, in free text and values), `R$`/Portuguese contexts (BRL). Plus `R26 766 051` (space separators), `120.000` (European thousands), `$5,000`, bare `4686.41`.
5. **Values hide in prose:** runway as `"12 months"`, beneficiaries as `"52000"` next to `"About 30 schools"`, percentages as `30%` / `50` / `0.5`.
6. **Sparse leading rows** (`AP1_Baseline`, `AP1_April_2025_Short`) — blank/partial rows before real data.

## Architecture — 7 stages

```
CSVs ─► S0 Profile ─► S1 Map (Claude) ─► S2 Resolve entities (Claude) ─► S3 Extract ─► S4 Normalize ─► S5 Validate+Grade ─► S6 Emit
              │              │                     │                        (deterministic TS from here, except S5 grading)
        profile.json   mappings/*.json       registry/orgs.json
                     (human-reviewable, cached — the "AI-assisted" part lives in these artifacts)
```

### S0 — Profile (deterministic, ~code exists from planning session)

Per file: delimiter (manifest-driven, verified), BOM, header list, data-row count (quote-aware parser), per-column fill rate, sample values (first 3 non-empty per column). → `build/profile.json`. This output is also **what S1's prompt sees** — Claude maps from profile, not from raw files, keeping prompts small and rows private to the pass that needs them.

### S1 — Mapping generation (Claude, one call per file, cached)

Input: canonical metric taxonomy + one file's profile (headers + samples). Output: `mappings/<file>.json`:

```json
{
  "file": "AP1and2_April_25.csv",
  "identity": { "org_col": 0, "person_col": null, "email_col": null },
  "columns": [
    {
      "index": 11,
      "header": "Inform: How many people have received educational health & hygiene messaging... as of October 2024?",
      "metric": "funnel.inform",
      "date_override": "2024-10",
      "type": "count",
      "lang": "en",
      "notes": "as-of date differs from file wave"
    },
    { "index": 15, "metric": "funnel.inform.methodology", "type": "text" },
    { "index": 4, "metric": null, "notes": "free-text elaboration, keep as context only" }
  ]
}
```

Key mapping duties: canonical metric or `null` (explicit skip), `type` (`count | money | percent | months | score | text`), `date_override` when the question text pins a different as-of date than the wave (real case above — one file asks the same funnel question for two dates), `lang` for PT columns (map directly to canonical English metrics — no separate translation step needed).

**Review loop:** mappings land as files in git. I eyeball the 19 artifacts (or spot-check the weird ones) before S3 runs. This is the trust story AND the generalization demo: new dataset = S0+S1 rerun, review, done.

### S2 — Entity resolution (Claude, ONE call, cached)

Input: all identity tuples from all files — (person?, org?, email?) + file + row — plus the README fact that email domains derive from org names. Output: `registry/orgs.json` with `org_id`, canonical name, aliases, people[], email_domains[], cohorts[], country. Person↔org links learned from files having both columns resolve the person-only rows. Unresolvable rows → `registry/unresolved.json` (surfaced, never silently dropped).

### S3 — Extract (deterministic)

Quote-aware CSV parse (custom ~40-line parser — no deps needed, already written in profiling), BOM strip, blank-row skip, apply mapping: emit raw records `(org_ref, metric, raw_value, source_file/row/column, date)` with date from manifest unless `date_override`. Resolve `org_ref → org_id` via registry (exact + alias + email-domain match; no fuzzy logic at this stage — fuzziness was S2's job).

### S4 — Normalize (deterministic, unit-hint-driven)

Per `type`:
- **money:** detect currency symbol/prefix (`R`→ZAR unless `R$`→BRL, `$`→USD, `₦`→NGN; mapping `notes` can pin currency for ambiguous columns); strip separators with the European-vs-US disambiguation rule (`120.000` → 120000 iff exactly 3 digits after `.` and value would otherwise be implausibly small for the metric); store `currency` + `value` + `value_usd` via a fixed rates table (`rates.json`, hackathon-grade constants, flagged as such).
- **percent:** `30%`→30, `0.5`→50 iff ≤1 and column majority >1, bare number passthrough.
- **count:** strip separators/words, extract leading number from prose (`"52000"` ok, `"About 30 schools"` → 30 with `grade≤C` flag).
- **months:** `"12 months"` → 12.
- Unparseable → record kept with `value: null`, `raw_value` preserved, `grade: "D"`, listed in `build/parse-failures.json`. **Nothing silently dropped.**

### S5 — Validate + grade

- **Deterministic checks:** funnel monotonicity per org×date (Inform ≥ Engage ≥ Outcomes ≥ Impact ≥ Societal), negative runway/revenue, count outliers (>10× cohort median), duplicate org×wave×metric conflicts. Violations → `build/anomalies.json` (this is dashboard content, not just QA).
- **Claude grading (one batched call):** every metric with a sibling `*.methodology` text gets a grade — **A** measured/records-based, **B** calculated with stated method, **C** estimated/extrapolated, **D** contradicted or implausible. Deterministic downgrades: monotonicity violation → involved values capped at D; prose-extracted numbers capped at C. No methodology text → grade `B` default for financials (self-reported), `C` for reach numbers. Grades + reasons stored on each record.

### S6 — Emit

`data/harmonized.json` (the contract), `registry/orgs.json`, `build/anomalies.json`, `build/parse-failures.json`, plus `build/coverage.json` (metric × cohort × wave fill matrix — **this is the input the KPI recommender needs**, so it ships from the pipeline, not the KPI workstream).

## Repo layout

```
pipeline/
  schema/metrics.json        # canonical taxonomy (FROZEN 15:30) + rates.json + manifest.json
  src/{profile,map,resolve,extract,normalize,grade,emit}.ts
  run.ts                     # bun pipeline/run.ts [--stage sN] [--file X]
  mappings/*.json            # Claude-generated, git-tracked, human-reviewed
  registry/orgs.json
build/                       # gitignored intermediates
data/harmonized.json         # the deliverable
```

Claude calls via Anthropic SDK, strongest current model, JSON-schema-constrained outputs; cache = "artifact file exists → skip call" (`--force` to regenerate). Budget: ~20 mapping calls + 1 resolve + 1 grading batch ≈ trivially within the $100 credit.

## Order of work & time budget (start ~15:00)

| # | Step | Est. | Done when |
| --- | --- | --- | --- |
| 1 | `metrics.json` taxonomy (~40 metrics, from docs/YSI-Dataset.md themes) + `manifest.json` (19 entries) | 30 min | Taxonomy frozen, committed **15:30** |
| 2 | S0 profile (port profiler) + S3 parser | 20 min | `profile.json` row counts match docs table |
| 3 | S1 mapping prompt + runner → 19 artifacts, review pass | 40 min | Spot-check: funnel file, one PT file, one K&B file map sanely |
| 4 | S2 entity resolution → registry, review | 25 min | ~40 orgs; AP1 person-only files resolve; unresolved list small & explained |
| 5 | S4 normalize + rates | 30 min | The known horror values all parse (`R26 766 051`, `120.000`, `$5,000`, `12 months`, `30%`) |
| 6 | S5 validation + grading batch | 30 min | Anomalies file non-empty (monotonicity violations exist), grades on funnel metrics |
| 7 | S6 emit + reconciliation | 15 min | **17:00: harmonized.json real**, record count ≥ sum of mapped cells sanity band |

Buffer ≈ 30 min. **Fallback if S1 misbehaves on the two worst files (113/142-col K&B monsters): mark them `deferred` in the manifest and ship without capability-lift metrics — matches the PLAN.md cut line.**

## Verification (how we know it's right, fast)

1. Row-count reconciliation per file vs profiler counts.
2. Golden spot-checks: 5 hand-picked values traced raw→normalized (incl. WellSpring funnel 7500→6450→5600→5600→3500 with monotonicity PASS, and one known violation).
3. Every dashboard number carries provenance — the demo interaction doubles as continuous verification.
4. `bun test` on the normalizer with the horror-value table (only unit tests worth writing today).

## Open decisions (deciding solo unless someone objects at review)

1. **Currency:** store native + `value_usd` with fixed hackathon rates table. Alternative: skip conversion, per-currency KPIs only. I say convert + label rates as demo-grade.
2. **The two K&B monster files** (113/142 cols): in scope for S1 but first on the personal cut line (they only feed capability-lift).
3. **SQLite:** skipping — flat JSON satisfies the contract; ~2k records max. Revisit only if dashboard filtering hurts.
4. **PT translation:** mapping-level only (PT column → English canonical metric). Free-text PT answers stay PT; report generator can translate quotes if needed.
