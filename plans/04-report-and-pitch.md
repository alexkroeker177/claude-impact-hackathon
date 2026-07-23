# Plan 04 — Report Generator + Pitch

> Owner: TBD. Report generator is the **first cut line** in PLAN.md — treat it as stretch. The pitch is not optional.

## Report generator (stretch, ~45 min)

One Claude call per cohort: input = that cohort's harmonized records + KPI results + free-text fields (needs, takeaways, "proud of"). Output = markdown M&E report: funnel narrative with **cited numbers incl. grades** ("Engage 6,450 [grade C — extrapolated household multiplier]"), capability-lift summary, thematic clustering of top-3-needs, recommendations for next curriculum. Render as a page in the dashboard (`/report/[cohort]`) — no PDF today.

## Pitch (8–10 min, rehearse at dinner 18:00–18:30)

1. **Problem (1 sentence):** Billions flow into social programmes, but the data proving what works is scattered, inconsistent, and unverifiable — this is YSI's real dataset, and it took us minutes, not weeks.
2. **Live demo (core, ~4 min):** show 2–3 raw CSVs briefly (the mess: person-vs-org columns, `R26 766 051` vs `120.000`) → portfolio dashboard → click a funnel number → provenance panel with the founder's own methodology text + grade → recommendation panel: "cost-per-beneficiary is one survey question away" → (if shipped) type the custom KPI live.
3. **Generalization (1 min):** compiler slide — per-dataset front-end is *generated and human-reviewed*, schema aligned to IRIS+/IMP five dimensions, shared analytics back-end. "New NGO = new mappings, same product."
4. **Impact & sustainability (1 min):** beneficiary = M&E analysts + funders; weeks→minutes; SaaS per portfolio for accelerators/foundations; YSI itself as design partner.
5. **Ask (specific):** pilot with YSI on the next AP cohort's live data + intro to one foundation's M&E team.

## Demo-risk rules

- Demo runs on localhost with data pre-baked; the "live ingestion" moment (if team voted for it) re-runs only S1 mapping on ONE small file, pre-tested three times.
- Screenshot fallback deck for every demo beat (record at 19:30).
- One person drives, one narrates. Never type an untested phrase on stage.

## Timeline

18:00 dinner = pitch outline agreed · 19:00 draft done · 19:30 screenshots/fallback captured · 19:45 one full rehearsal.
