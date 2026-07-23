# Claude Impact Hackathon

Repository for the **Claude Impact Hackathon** — Nuremberg, 2026-07-23.

## About

Built during the Claude Impact Hackathon in Nuremberg.

## Status

🚧 In progress.

## YSI Dataset X-Ray dashboard

The dashboard explores all 19 Aurelia Propel IMM survey exports without publishing the raw hackathon dataset. It highlights:

- cohort and survey-wave coverage;
- file width, sparsity, language, and delimiter inconsistencies;
- the five-level impact funnel with cohort and source filters; and
- candidate organisation matches for longitudinal analysis.

### Start the dashboard

The local `Aurelia_Propel_IMM Dataset/` folder must exist beside `ysi-dashboard/`.

```powershell
cd ysi-dashboard
pnpm install
pnpm dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. See [`ysi-dashboard/README.md`](ysi-dashboard/README.md) for dashboard controls, methodology, production builds, and troubleshooting.
