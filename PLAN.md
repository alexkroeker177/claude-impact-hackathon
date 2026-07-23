# Plan — Evidence-Graded Impact Intelligence

> Team review doc, Claude Impact Lab Hackathon · YSI track · 2026-07-23.
> Read time ~5 min. Decide the open questions at the bottom, then we build.
> **Per-workstream deep-dive plans + the shared data contract live in [plans/](plans/README.md).**

## One-liner

**Turn any messy impact-survey export into auditable, longitudinal impact intelligence — every number graded and traceable to its source.**

Not a dashboard with AI bolted on. The product is an **impact-data compiler**:

```
messy exports ──► AI-generated mappings ──► Canonical Impact Schema ──► KPIs / Dashboard / Reports
   (per dataset)      (per dataset, cached)        (shared, standard-aligned)      (shared)
```

The generalization story: only the left side is dataset-specific, and it's *generated, not hand-coded*. Drop in a new NGO's exports → Claude proposes mappings → human approves → same engine, same dashboard. That's how this works "for Social Impact Measuring in general," without a graph DB or vector store we don't need at this scale.

---

## Components (build order)

### 1. Canonical Impact Schema — *the contract* (≤45 min)

A single long-format target: `org_id · cohort · wave · date · metric · value · raw_value · unit · source_file · source_row · confidence_grade`.

Metric taxonomy covers: 5-level impact funnel (+ %women, %marginalised per level), financials (revenue, MRR, runway, funding by type, headcount, customers), capability scores (competency × before/after), programme feedback (NPS, attribution, module ratings), free-text fields (needs, takeaways, "how calculated").

**Generalization hook:** name-align metrics to **IRIS+ / Impact Management Project's five dimensions** where they fit. "We map to the industry standard" is a stronger answer than any database choice — it's what makes output comparable *across* organisations, which is the track's stated problem.

### 2. Entity Resolution — *the join key that doesn't exist* (inside pipeline)

One Claude pass over all org names + contact emails + person names → canonical org registry (`org_id`, canonical name, aliases, email domain, country, cohort). ~40 entities; the README says email domains are deterministic from org names — use that as anchor. Output is a reviewable JSON artifact.

### 3. AI-Assisted Standardization Pipeline — *the core build* (~1.5 h)

Per file: detect delimiter/encoding/BOM → Claude generates a **mapping artifact** (JSON: source column → canonical metric, language, unit hints) → deterministic TypeScript applies it: number/currency/percent normalization, PT→EN alignment, blank-row handling. LLM does the fuzzy judgment once; code does the math every time. Mappings are cached & human-reviewable — that's the trust + feasibility story.

### 4. Confidence Grading + Validation — *the differentiator* (~45 min)

Rules: funnel monotonicity (Inform ≥ Engage ≥ … ≥ Societal), negative/absurd values, missing-wave gaps. Claude reads each "how did you calculate this number?" answer and grades the value: **A measured · B calculated · C estimated/extrapolated · D contradicted/implausible**. Grade stored per value.

### 5. Storage (~15 min)

**SQLite** (or flat JSON if SQLite fights us). One `values` table + `orgs` registry + computed `kpis` view. Explicitly NOT a graph/vector store — 218 rows, 40 orgs; the semantics live in the schema and the mapping artifacts.

### 6. KPI Engine — declarative, not hard-coded (~45 min)

KPIs are **JSON definitions** (name, formula over canonical metrics, grouping, direction/target), evaluated by one generic engine. Built-in set ships as pre-defined artifacts: funnel conversion rates per level, reach trajectory per org/cohort, %women & %marginalised, capability lift (before→after), cost-per-beneficiary, runway alerts, response-continuity (baseline-but-no-midline = silent churn). KPIs computed from low-grade inputs inherit a confidence ceiling.

### 6b. KPI Recommendation + Custom KPIs (~45 min)

After ingestion, Claude inspects the harmonised table (metric coverage, waves, grades) and **recommends only KPIs the data can actually support** — plus the negative space: *"cost-per-beneficiary is one survey question away."* That makes the tool a forward-looking survey-design advisor, not just reporting. Custom KPIs: user describes in natural language → Claude compiles to the same JSON definition → validates measurability against real coverage → engine evaluates. Second demo money moment: type "women reached per grant dollar" live, chart appears (pre-test the phrase).

### 7. Dashboard — `kpimpact/` Next.js scaffold (~1.5 h, parallel)

- **Portfolio view:** cohort comparison, total reach, funnel aggregate, alert strip (low runway, funnel violations, silent churn).
- **Org drill-down:** funnel over waves, financial trajectory, capability lift.
- **The money interaction:** click any number → provenance panel: raw cell, source file/row, founder's own methodology text, confidence grade. *This is the demo moment.*

### 8. Report Generator (~45 min, cut-line candidate)

Claude writes the cohort/portfolio M&E report with cited, graded numbers + thematic synthesis of "top 3 needs" free-text. The artifact an analyst hand-writes over weeks.

### 9. Pitch (~30 min + rehearse at dinner)

Problem in one sentence → live demo (upload/ingest → dashboard → click-to-provenance → generated report) → generalization slide (compiler diagram, IRIS+ alignment) → sustainability (SaaS for accelerators/foundations; per-portfolio pricing) → specific ask.

---

## Team split (4 people)

| Who | Owns | First deliverable |
| --- | --- | --- |
| A | Schema + mappings + entity resolution (1–3) | Canonical schema JSON by 15:30 |
| B | Pipeline runner + validation/grading + SQLite (3–5) | Harmonised table by **17:00 (hard checkpoint)** |
| C | Dashboard on mock data matching schema (7) | Clickable views by 17:00, real data after |
| D | KPI engine + recommendation/custom KPIs + report gen + pitch (6, 6b, 8, 9) | KPI engine + built-in definitions by 17:30, pitch draft by 19:00 |

**Cut lines if behind:** drop report generator → drop custom-KPI UI (keep recommendations — they're one Claude call) → drop capability-lift views → drop grading (keep provenance click-through) → funnel-only dashboard. Never cut: harmonised table + one clickable provenance demo + declarative KPI engine (retrofitting it later is the expensive path).

## Judging coverage check

- **Innovativeness:** evidence-graded, auditable impact claims + generated mapping layer + measurability-aware KPI recommendation ("here's what one more survey question unlocks") — not a chatbot, not a plain dashboard.
- **Feasibility:** runs on the real data today; new-dataset path is "generate mappings, review, run"; standard-aligned schema.
- **Impact:** M&E analyst weeks → minutes; funders get numbers they can trust; YSI sees which cohorts convert reach into durable change.
- **Pitch:** live demo with a single unforgettable interaction (a number justifying itself).

## Open questions for the team

1. **Demo framing:** portfolio-manager view (YSI's daily pain — my lean, Yunus people are judging) vs funder-trust view? Same build, different narrative.
2. **Report generator in or out** of the core scope? (First cut-line candidate.)
3. **Live ingestion in the demo** (drag a CSV in, watch it map) or pre-baked with the pipeline shown as code? Live is riskier, far more convincing.
4. Anyone strongly want SQLite vs flat JSON? (I'm fine either; JSON is zero-friction with Next.js.)
