# Demo runbook

Two-beat pitch (see [`plans/05-impactlens-reconciliation.md`](../../plans/05-impactlens-reconciliation.md) §2): unseen-upload genericity, then full-portfolio depth.

## Before going on stage

```bash
cd impact-lens
rm -rf .data
bun run seed:fallback     # zero-Claude insurance project, ~1s
bun run seed:harmonized   # one project PER ORGANISATION from the Aurelia data (62 orgs, 2,473 records), ~1s — needs ../pipeline/data/harmonized.json
bun run dev
```

Open `http://localhost:3000` — the home page's "Recent projects" should list 63 seeded projects as `ready` (62 organisations + the synthetic fallback). Each organisation is its own independent project with its own dashboard — nothing is combined across orgs. (The old single-combined-portfolio view is still available via `bun run seed:harmonized-portfolio` if a portfolio-level story is wanted for a different beat.)

## Rehearsal A — one organisation's depth story

1. Home → click **"PureCircle Innovations (AP1)"** (or any org — this one has the best anomaly to show).
2. Point at the assessment sentence (KPI count, coverage %, evidence-grade share, review-signal count) — scoped to just this organisation.
3. Point at the funnel chart — PureCircle's own funnel narrows from Impact (500,000) to Outcomes (2,500), which is backwards — call this out live.
4. Click a KPI card → evidence drawer slides in: formula, coverage bar, example rows with real source file/row from PureCircle's own uploaded files.
5. **Early warnings tab** → the funnel-monotonicity violation (impact 101,398 / 500,000 both exceed outcomes 2,500) and a team.fte outlier — call it "a review signal, not an automatic correction."
6. **Outlook tab** → empty state, explicitly not forecasting.
7. Go back home, click a *different* organisation (e.g. WellSpring Technologies) to show the drill-down genuinely differs per project — different KPI values, different funnel shape, different evidence mix.

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
- Each org project's "1 file" source count in the project list is cosmetic (all of an org's profiles share one provenance path back to `data/harmonized.json`); the dashboard itself correctly shows every source file that organisation actually appears in.
- A handful of smaller orgs only have 1 KPI (evidence-quality only) — they didn't report enough funnel stages for a chart. That's real data sparsity, not a bug; skip those orgs live and use one with 3 KPIs.
