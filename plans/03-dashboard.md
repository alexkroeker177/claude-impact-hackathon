# Plan 03 — Dashboard (`kpimpact/`)

> Owner: TBD. Next.js scaffold already exists in `kpimpact/` (create-next-app + shadcn init, untouched). Build against **mock JSON matching the contract shapes** ([plans/README.md](README.md)) from minute one; real data lands 17:00. bun, not npm.

## Three views, one money interaction

1. **Portfolio** (`/`): cohort cards (AP1–AP4: org count, total reach, avg funnel conversion), aggregate funnel viz, **alert strip** from `build/anomalies.json` + alert KPIs (low runway, funnel violations, silent churn). KPI recommendation panel: "recommended" chips + "unlockable" cards with the suggested survey question.
2. **Org drill-down** (`/org/[org_id]`): funnel per wave (grouped bars or funnel chart over time), financial trajectory line (native currency labelled + USD), capability lift (if data ships), free-text highlights (top 3 needs, biggest takeaway).
3. **Provenance panel** (drawer/modal, reachable from EVERY rendered number): raw cell value, source file + row + column header, methodology text, grade badge (A–D) with reason. *This is the demo moment — build it second, right after the portfolio skeleton, not last.*

## Notes

- Data access: read the JSON artifacts server-side (they're small); no API layer, no DB.
- Grade badges everywhere a number renders — colour-coded A green → D red. The visual identity of the whole product is "numbers that carry their evidence."
- Custom-KPI textbox (if plan 02 ships it): input → POST to a route calling the plan-02 compile function → new chart appears. Pre-test the demo phrase.
- Charts: recharts (or plain SVG for the funnel — it's 5 bars). Read the `dataviz` skill before the first chart.
- Cut-line order for views: capability lift → org financial trajectory → recommendation panel (keep if at all possible) → never cut portfolio + provenance panel.

## Order of work

1. Mock data files from contract shapes + portfolio skeleton — 30 min
2. **Provenance panel** — 30 min
3. Funnel viz + alert strip — 30 min
4. Org drill-down — 30 min
5. Recommendation panel + custom-KPI box — 30 min
6. 17:00 swap to real data; 19:15 freeze, demo walkthrough only after that
