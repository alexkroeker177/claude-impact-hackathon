# YSI Dataset — Aurelia Propel Impact Measurement & Management (IMM)

> Orientation doc for the **YSI Track — AI-Powered Impact Intelligence** at the Claude Impact Lab Hackathon, ZOLLHOF Nuremberg, 23 July 2026.
> Source directory: `YSI Dataset/Aurelia_Propel_IMM Dataset/` (19 CSVs + README).

## Overview

**YSI = Yunus Social Innovation** (formerly Yunus Social Business), the impact-investing / accelerator organisation founded in the lineage of Nobel laureate Muhammad Yunus. This dataset comes from their **Aurelia Propel** accelerator programmes — cohorts of early-stage social enterprises across Africa, South Africa and Brazil that YSI supports with mentoring, masterclasses, seed funding and impact-measurement coaching.

The data is exactly what real-world impact measurement looks like on the ground: a pile of **survey exports** collected over 3.5 years (Nov 2022 → May 2026), across **four accelerator cohorts (AP1–AP4)**, in **two languages** (English + Portuguese), with **no shared join key**, **inconsistent number formats**, and **question wording that drifts between waves**. It captures both *how the enterprises are doing* (revenue, funding, headcount, customers) and *how much social impact they create* (people informed, engaged, and materially improved), plus *what the accelerator taught them* (knowledge & behaviour self-assessments).

The core challenge of the YSI track: turn this scattered, inconsistent, human-collected mess into **clean, comparable, longitudinal impact intelligence** — the kind of thing that normally eats weeks of an M&E analyst's time.

## Provenance (from the README)

The dataset ships with a README that is worth reading in full. Key points, paraphrased:

- **19 CSV exports** from the Aurelia accelerator programmes AP1–AP4, spanning Nov 2022 → May 2026: baseline / midline / endline surveys, organisational-performance snapshots, and IMM assessments — "collected at different times, in different languages, with different question sets and different column conventions. **Nobody has cleaned this up for you. That's the challenge.**"
- **Pseudonymised, and safe to work with.** Organisation names, contact names, emails and phone numbers are generated stand-ins — *not* real people or organisations. Email domains are deterministically derived from the pseudonymised org names (`adaeze.igwe@brightpathsolutions.org` ← "BrightPath Solutions"), and every phone number is a sequential placeholder of the form `+000-000-0000N`. Because of this, the **contact columns are one of the few consistent join keys** in the whole dataset — the README explicitly flags them as useful for linking records across waves.
- **Usage terms:** hackathon use only; not to be redistributed, published, or uploaded to third-party services beyond the AI tooling being built on the day; findings must not be presented as claims about named real-world enterprises.

### The README's documented gotchas

| Gotcha | Detail |
| --- | --- |
| **Mixed delimiters** | Most files are comma-separated. Three are **semicolon**-separated: `AP3_Baseline_October_2024.csv`, `AP_April_2025_extra_data.csv`, `IMM_Assessment_October_2025.csv`. Confirmed by inspection. |
| **Multi-line quoted fields** | Free-text answers contain newlines. Counting physical lines gives wrong row counts — a real CSV parser is mandatory (all counts in this doc come from Python's `csv` module). |
| **Two languages** | The `*_BRA.csv` files have Portuguese headers and answers; some cells mix both. |
| **No shared join key** | Organisations recur across files with inconsistent spelling and **no ID column**. Entity resolution is part of the problem. |
| **Inconsistent number formats** | `120.000`, `150000`, `40351`, `$65,000`, `R26 766 051` all appear in the same conceptual column. Percentages appear as `50%`, `50`, and `0.5`. |
| **Sparse / blank rows** | Several files have empty rows and mostly-empty columns where a question was added mid-programme. |
| **Question drift** | The "same" metric is worded differently baseline vs. midline. Mapping them is on you. |

## File inventory

Row counts are **data rows** (header excluded), parsed with a proper CSV reader. Delimiter noted where non-comma.

| File | Rows | Cols | Delim | Cohort / Wave | What it is |
| --- | ---: | ---: | :---: | --- | --- |
| `AP1_Baseline_Nov_22_SA.csv` | 33 | 23 | , | AP1 · Baseline | Nov 2022 South Africa baseline — Knowledge & Behaviour self-scores per founder |
| `AP1_April_2023_SA__Knowledge___Behaviour.csv` | 15 | 113 | , | AP1 · Wave (Apr 23) | Deep knowledge & behaviour self-assessment (before/after per competency) |
| `AP1_April_23_Org_Performance_SA.csv` | 5 | 39 | , | AP1 · Org perf (Apr 23) | Revenue / EBITDA / net profit / equity-debt-grant funding, jobs, beneficiaries |
| `AP1_October_2023_SA.csv` | 6 | 87 | , | AP1 · Follow-up (Oct 23) | South Africa follow-up — wide knowledge + practice + org-performance survey |
| `AP1_October_2023_BRA.csv` | 6 | 43 | , | AP1 · Follow-up (Oct 23) | Brazil follow-up, **Portuguese** headers/answers |
| `AP1_Endline_April_24_SA.csv` | 6 | 59 | , | AP1 · **Endline** | Apr 2024 endline — satisfaction, capability lift, financials, impact, needs |
| `AP1_June_2024_BRA.csv` | 6 | 43 | , | AP1 · Follow-up (Jun 24) | Brazil follow-up, **Portuguese** |
| `AP1_October_2024_SA_BR.csv` | 12 | 7 | , | AP1 · Follow-up (Oct 24) | Combined SA + Brazil short check-in (beneficiaries, gender split, innovation idea) |
| `AP1_April_2025_Short_Beneficiary_Survey.csv` | 7 | 4 | , | AP1 · Short (Apr 25) | Minimal beneficiary-reach survey (accelerator impact 1–10, people impacted, % women) |
| `AP1and2_April_25.csv` | 9 | 49 | , | AP1+AP2 · combined (Apr 25) | Combined cohort — the **5-level impact funnel** + org performance snapshot |
| `AP2_Baseline_October_2023.csv` | 6 | 9 | , | AP2 · Baseline | Oct 2023 baseline — customers, beneficiaries, funding, revenue, team |
| `AP2_March_2024.csv` | 6 | 142 | , | AP2 · Wave (Mar 24) | **Widest file** — full programme-feedback + knowledge + practice self-assessment |
| `AP2_October_2024.csv` | 5 | 57 | , | AP2 · Follow-up (Oct 24) | Confidence, capability, financials, governance, gender distribution |
| `AP3_Baseline_October_2024.csv` | 8 | 41 | **;** | AP3 · Baseline / application | Application-style intake: role, gender, country, legal status, stage, impact, funding |
| `AP3_April_2025_Midline.csv` | 8 | 82 | , | AP3 · **Midline** | Module ratings (M1–M4) + knowledge deltas + **5-level impact funnel** + financials |
| `AP4_2025_2026_Baseline_Survey.csv` | 20 | 64 | , | AP4 · Baseline | 2025–26 cohort intake — multi-contact roster, priorities, confidence, financials, impact framework |
| `AP4_May_2026_Midline.csv` | 19 | 64 | , | AP4 · **Midline** | May 2026 — experience ratings, knowledge lift, impact funnel, financials, consent block |
| `AP_April_2025_extra_data.csv` | 4 | 50 | **;** | Cross · Prize (Apr 25) | Aurelia **prize recipients** — recommend score + impact funnel + org metrics |
| `IMM_Assessment_October_2025.csv` | 31 | 14 | **;** | Cross-cohort · IMM (Oct 25) | **Largest by rows** — lean cross-cohort impact snapshot (beneficiaries, % marginalised, MRR, runway, needs) |

Roughly **~218 data rows total** across the 19 files. This is a *small-n, wide-schema* dataset: few respondents, hundreds of distinct questions. The intelligence is in the **longitudinal and cross-file joins**, not in any single large table.

## Data model / structure

### Two axes: cohort × wave

Every file sits at the intersection of a **cohort** (which accelerator intake) and a **wave** (when in the programme lifecycle it was collected).

**Cohorts (AP = Aurelia Propel):**
- **AP1** — earliest, largest footprint (SA + Brazil), Nov 2022 baseline through Apr 2025 follow-ups. 9 of 19 files.
- **AP2** — Oct 2023 baseline, tracked through Oct 2024.
- **AP3** — Oct 2024 baseline (application-style intake), Apr 2025 midline.
- **AP4** — newest, 2025–26 baseline, May 2026 midline.
- **Cross-cohort** — `AP1and2_April_25`, `AP_April_2025_extra_data` (prizes), and `IMM_Assessment_October_2025` cut across cohorts.

**Waves (the accelerator lifecycle):**
```
Baseline  ─►  (interim follow-ups / knowledge & behaviour)  ─►  Midline  ─►  Endline
 at intake        during programme                             mid-programme   at graduation
```
Only AP1 has a true **Endline** (`AP1_Endline_April_24_SA`). AP3 and AP4 currently reach **Midline**. AP2 has baseline + follow-ups. This asymmetry is itself a finding: cohorts are at different lifecycle stages.

### Geography & language
- **SA** = South Africa (English). **BRA** = Brazil (Portuguese). **SA_BR** = combined export.
- AP3/AP4 baselines skew to **Nigeria / East Africa** (`AP3_Baseline` rows are Nigerian LLCs), showing the programme's geographic expansion over time.

### How records relate (the join problem)
There is **no ID column anywhere.** Records link only through fuzzy keys:
1. **Organisation name** — the primary link (`Organisation`, `Organization`, `Organisation Name`, `Company Name`, `Nome da empresa`, `Social Enterprise`, or bare `Name` in the IMM file). Spellings drift across files.
2. **Contact email** — the most reliable machine key, because domains are deterministically derived from org names (`*.igwe@brightpathsolutions.org` ↔ "BrightPath Solutions"). Present in the baseline/intake files (AP3, AP4) and midlines.
3. **Contact person name** — secondary, but founders change roles and files sometimes store the founder, sometimes a team member.

Entity resolution across these keys — collapsing "BrightPath Solutions" / "Brightpath Sol." / the email domain into one canonical org — is a **core, unsolved part of the challenge**, explicitly called out by the README.

## Key columns & themes

Four measurement themes recur across the files:

### 1. The 5-level Impact Funnel (YSI's IMM core metric)
The signature framework, appearing in `AP1and2_April_25`, `AP3_April_2025_Midline`, `AP4_May_2026_Midline`, and `AP_April_2025_extra_data`. A cascade of how many people an enterprise reaches, from awareness to durable change:

```
1. Inform     → people who received education/information
2. Engage     → people directly engaged with the product/service
3. Outcomes   → people who experienced a measurable outcome
4. Impact     → people who experienced deep/lasting impact
5. Societal   → people who experienced broader societal impact
```
Each level carries sub-questions (`.1` who are the vulnerable/marginalised, `.2` share of women, `.3` how you reached them, `.4` how you calculated the number). Example values from `AP1and2_April_25` (WellSpring Technologies): Inform 7500 → Engage 6450 → Outcomes 5600 → Impact 5600 → Societal 3500 — a classic funnel that should be monotonically non-increasing (a data-quality check in itself).

### 2. Organisational performance / financials
Revenue, EBITDA, net profit, MRR, runway (months), FTE / contract headcount, customer counts, funding raised split by **equity / debt / grant**, current funding requirement, valuation. Heaviest in `AP1_April_23_Org_Performance_SA` and the endline. **Number formats are chaotic** — `R26 766 051`, `R0`, `$60500`, `4686.41`, `120.000`, `$5,000` all coexist and need normalisation before any aggregation.

### 3. Knowledge & Behaviour self-assessment (capability lift)
The accelerator's learning outcomes. `AP1_Baseline_Nov_22_SA` scores founders on ~20 competencies (Systems, Purpose, IMM, Customer, Design Thinking, Product-Service, Business strategy, Unit economics…) as Knowledge vs. Behaviour. Later waves (`AP1_April_2023...113 cols`, `AP2_March_2024...142 cols`, the AP3/AP4 midlines) capture the same competencies with **before/after** framing and Likert-style self-ratings — enabling pre/post capability-lift analysis if the question wording is mapped across waves.

### 4. Programme feedback / satisfaction
NPS-style "how likely to recommend" (0–10), module ratings (AP3 midline rates Modules 1–4), satisfaction, "biggest take-away", "what can be improved", "top 3 needs", and attribution ("YSB Attribution", "how much has the accelerator influenced…"). Rich free-text, ideal for LLM summarisation.

## Data quality notes

- **Tiny-n, wide-schema.** Files run 4–33 rows but up to **142 columns** (`AP2_March_2024`). Expect very sparse matrices.
- **Blank leading rows.** In `AP1_April_2025_Short_Beneficiary_Survey` and `AP1_Baseline_Nov_22_SA`, the first data rows are empty or partially empty — real answers start several rows down. Don't assume row 1 is populated.
- **Mixed delimiters** (`;` in 3 files) — detect per-file, never assume comma.
- **BOM present** on the semicolon files — headers read as `﻿Name` (leading U+FEFF). Strip it.
- **Number normalisation required** before any math: strip currency symbols (`R`, `$`), thousands separators (space, `.`, `,`), and reconcile `120.000` (= 120,000, European) vs `150000`. Percentages need `%`/bare/`0.5` normalisation.
- **No primary key** → fuzzy entity resolution needed to join waves.
- **Question drift** → semantic column mapping needed to compare "the same" metric across baseline/midline/endline.
- **Two languages** → Portuguese files need translation/alignment to the English schema before cross-cohort analysis.
- **Impact-funnel monotonicity** is a free validation signal: Inform ≥ Engage ≥ Outcomes ≥ Impact ≥ Societal should generally hold; violations flag data-entry errors.

## Hackathon opportunities

Five concrete directions for a Claude-powered build on this data. All lean into exactly the messiness above — which is where an LLM beats a spreadsheet.

1. **Impact Data Harmoniser (the flagship).** A Claude pipeline that ingests all 19 CSVs, auto-detects delimiter/encoding, **resolves entities** (org name + email-domain fuzzy matching into one canonical enterprise ID), **maps drifting questions** to a canonical metric schema, and **normalises numbers/percentages/currencies** — emitting one clean longitudinal table (enterprise × wave × metric). This is the enabling layer everything else sits on, and it's the single highest-value deliverable for the YSI track: it turns weeks of manual M&E cleanup into minutes.

2. **Longitudinal Impact Dashboard.** On top of the harmonised data, a per-enterprise and per-cohort view showing the 5-level impact funnel over time, capability lift (knowledge/behaviour before→after), and financial trajectory (revenue, funding, headcount) from baseline → midline → endline. Surfaces which enterprises are converting reach into deep impact and which are leaking at the funnel top.

3. **Automated M&E Insight Narrator.** Claude reads the harmonised data plus the free-text answers ("biggest take-away", "what can be improved", "top 3 needs") and writes the **impact report YSI would otherwise hand-write** — per cohort and portfolio-wide — with cited numbers, funnel conversion rates, capability deltas, and thematic synthesis of qualitative feedback. Human-quality M&E reporting at machine speed.

4. **Data-Quality & Anomaly Sentinel.** A validator that flags impossible values (funnel non-monotonicity, negative runway, `R0` revenue with 480k beneficiaries), missing-wave gaps (enterprises with a baseline but no midline), and format outliers — then proposes corrections. Directly attacks the "nobody cleaned this up" problem and builds trust in every downstream number.

5. **Portfolio Impact Intelligence / benchmarking.** Cross-cohort analytics: cost-per-beneficiary and reach-per-founder benchmarks, "% women reached" and "% marginalised" equity tracking, and a **needs-clustering** engine over the recurring "top 3 needs" free-text to tell YSI what the *next* accelerator curriculum should emphasise. Turns backward-looking M&E into forward-looking programme optimisation.
