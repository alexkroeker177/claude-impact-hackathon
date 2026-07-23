# YSI Dataset X-Ray

Local exploration dashboard for the Aurelia Propel IMM dataset. It profiles all 19 CSV exports, visualises cohort/wave coverage and the five-level impact funnel, and surfaces candidate organisation joins.

The app is designed for hackathon-team exploration: it shows both the impact signal and the data-quality work required before that signal can be treated as longitudinal evidence.

## Prerequisites

- Node.js 20 or newer
- pnpm 10 or newer
- The hackathon dataset at `../Aurelia_Propel_IMM Dataset/`

The dataset stays outside the browser bundle. Do not rename or move its directory unless you also update `scripts/build-data.ts`.

## Run

```powershell
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The data preprocessing step runs automatically before the app starts.

## How to use the dashboard

1. Start with **Where the evidence lives**. The cohort-by-wave matrix shows which baseline, follow-up, midline, and endline files exist. Hover a populated cell to see its contributing source files.
2. Use **The shape of the mess** to compare source files. Bubble position represents schema width and sparsity; bubble size represents response count. Hover a bubble for its source name, dimensions, language, and empty-cell rate.
3. Explore **The impact signal**. Choose a cohort and optionally a source file. The funnel recalculates medians, sample sizes, stage-to-stage conversion, and sequence violations.
4. Review **Can we follow organisations over time?** Candidate matches show where normalized organisation names may link multiple files. Treat fuzzy candidates as leads requiring human review.
5. Open **Methodology + caveats** in the footer before presenting a finding. It documents how funnel columns, numbers, and join candidates are derived.

The dashboard intentionally distinguishes missing values from zero. A large value or a non-monotonic funnel is flagged for investigation, not automatically corrected.

## Build

```powershell
pnpm build
pnpm preview
```

Raw dataset files remain outside the app. Generated summaries under `public/data/` and production assets under `dist/` are ignored by Git.

## Data pipeline

`scripts/build-data.ts` runs before both development and production builds. It:

- detects comma- and semicolon-delimited exports and strips BOM markers;
- removes fully blank records and profiles row count, column count, and sparsity;
- extracts funnel stages through explicit header patterns;
- normalizes common numeric formats conservatively;
- flags records where a later funnel stage exceeds the preceding stage; and
- creates exact-normalized and fuzzy organisation-match candidates.

Only derived summaries are written to `public/data/dashboard.json`. Email addresses, phone numbers, and raw free-text answers are excluded.

## Troubleshooting

- **Dashboard says it cannot load data:** run `pnpm data`, then restart `pnpm dev`.
- **Dataset directory not found:** confirm `Aurelia_Propel_IMM Dataset/` is at the repository root.
- **Vite port is busy:** use `pnpm dev -- --port 5174` and open the printed URL.
- **Charts show fewer records than expected:** funnel charts include only rows with at least one parseable funnel value; the displayed `n` can differ by stage.
