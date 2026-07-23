# YSI Dataset X-Ray

Local exploration dashboard for the Aurelia Propel IMM dataset. It profiles all 19 CSV exports, visualises cohort/wave coverage and the five-level impact funnel, and surfaces candidate organisation joins.

## Run

```powershell
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The data preprocessing step runs automatically before the app starts.

## Build

```powershell
pnpm build
pnpm preview
```

Raw dataset files remain outside the app. Generated summaries under `public/data/` and production assets under `dist/` are ignored by Git.
