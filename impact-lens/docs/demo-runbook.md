# Demo runbook

Two-beat pitch (see [`plans/05-impactlens-reconciliation.md`](../../plans/05-impactlens-reconciliation.md) §2): unseen-upload genericity, then full-portfolio depth.

## Before going on stage

```bash
cd impact-lens
rm -rf .data
bun run seed:fallback     # zero-Claude insurance project, ~1s
bun run seed:harmonized   # deep Aurelia portfolio (2,473 records, 61 orgs), ~1s — needs ../pipeline/data/harmonized.json
bun run dev
```

Open `http://localhost:3000` — the home page's "Recent projects" should list both seeded projects as `ready`.

## Rehearsal A — deep portfolio (the depth story)

1. Home → click **"Aurelia Propel — full portfolio (deep harmonization)"**.
2. Point at the assessment sentence (KPI count, coverage %, evidence-grade share, review-signal count).
3. Point at the funnel chart — narrows from Inform to Societal across 5 stages, all orgs, all waves.
4. Click a KPI card → evidence drawer slides in: formula, coverage bar, example rows with real source file/row.
5. **Early warnings tab** → funnel monotonicity violations and low-coverage flags — call out one as "a review signal, not an automatic correction."
6. **Outlook tab** → empty state, explicitly not forecasting.

## Rehearsal B — unseen upload (the genericity story)

1. Home → **Create project**.
2. Name + goal + one unseen CSV or XLSX (not from the Aurelia set — anything with a few numeric/categorical columns works).
3. Watch the staged progress (upload → profile → "Claude is interpreting the schema…", up to ~90s).
4. Review step: KPIs proposed, Five Dimensions coverage, candidate framework tags (never compliance language).
5. Uncheck one KPI, click **Generate dashboard** → lands on the same Dashboard component Rehearsal A used — same code path, unseen data.

## Recovery if the API is down or budget-capped mid-demo

- Rehearsal A never calls Claude live (seeded ahead of time) — always safe.
- If Rehearsal B's interpret call fails: the wizard shows an inline error + **Retry interpretation** button; profiles are preserved server-side, so retry is free.
- If Claude is fully down: fall back to narrating Rehearsal A only, or re-run `bun run seed:fallback` and open that project cold — it has a full precomputed dashboard with zero live dependency.

## Known non-issues

- `bun run seed:*` must go through the package.json scripts (which invoke `tsx`, i.e. Node) — running `bun scripts/seed-project.ts` directly crashes Bun's own engine on `better-sqlite3`'s native binary. Not a problem in normal use; just don't bypass the npm-script layer.
- The harmonized seed's "1 file" source count in the project list is cosmetic (all 17 profiles share one provenance path); the dashboard itself correctly shows all 17 sources.
