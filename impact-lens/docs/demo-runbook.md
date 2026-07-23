# Demo runbook

Two-beat pitch (see [`plans/05-impactlens-reconciliation.md`](../../plans/05-impactlens-reconciliation.md) §2): unseen-upload genericity, then full-portfolio depth.

## Before going on stage

```bash
cd impact-lens
rm -rf .data
bun run seed:fallback     # zero-Claude insurance project, ~1s
bun run seed:harmonized   # one project PER ORGANISATION (62 orgs, 2,473 records) + an LLM analysis pass
bun run dev
```

The harmonized seed now runs a **per-org LLM analysis pass** (Sonnet, 6 concurrent): each organisation's actual figures go to Claude, which writes the Five Dimensions answers and a headline insight grounded in that org's real numbers. First run ≈ 3.5 min; results are cached in `.enrichment-cache.json` (survives `rm -rf .data`), so reseeds are instant. Needs `ANTHROPIC_API_KEY` in `.env.local`; `bun run seed:harmonized -- --no-llm` skips the pass and keeps deterministic template answers. The odd org can fail validation stochastically (it logs and keeps the fallback) — rerun `bun run seed:harmonized -- --org=<id>` after deleting that project row if it matters.

Open `http://localhost:3000` — the home page's "Recent projects" should list 63 seeded projects as `ready` (62 organisations + the synthetic fallback). Each organisation is its own independent project with its own dashboard — nothing is combined across orgs. (The old single-combined-portfolio view is still available via `bun run seed:harmonized-portfolio` if a portfolio-level story is wanted for a different beat.)

## Rehearsal A — one organisation's depth story

1. Home → click **"PureCircle Innovations (AP1)"** (or any org — this one has the best anomaly to show).
2. Point at the **"What this data says"** card — a plain-English assessment plus 2–3 insight bullets, scoped to just this organisation. PureCircle's opens with "Its funnel numbers contradict each other… which points to a reporting error."
3. Point at the funnel chart ("From first contact to lasting change") — stages now run in canonical order, so PureCircle shows Outcomes 2,500 **followed by Impact 500,000** — visibly backwards. The KPI cards say it too: "People reached 2,500" vs "Deepest impact 500,000". Call it out live.
4. Click a KPI card → evidence drawer opens with a green **"How it's calculated"** panel in plain language, then sources, exact formula, coverage, and example rows from PureCircle's own files.
5. **Needs review tab** (shows the count in the tab label) → plain-language items: "Numbers don't add up: funnel.impact (500,000) exceeds funnel.outcomes (2,500)… likely a reporting or unit mix-up. Check AP1_April_23_Org_Performance_SA.csv" plus a team.fte outlier. Nothing is auto-corrected.
6. **What's missing tab** → what would make the analysis stronger; explicitly not forecasting.
7. Go back home, click **PureFlow Innovations (AP4)** — the contrast beat: a genuine growth story (customers 45 → 1,500, a 33x jump) with solid evidence grades and zero automated flags, yet the LLM analysis still notes what can't be verified (revenue actually fell $7,000 → $6,000). The pitch line: *every* organisation gets real scrutiny — clean-looking ones included.
8. Scroll to **Five Dimensions of Impact** on either org — these are now genuine LLM-written answers grounded in the org's own figures (real values, dates, trends), not coverage metadata. TerraNova Water Group is the spare wow-card: its headline calls out a claimed 200x reach jump (10,452 → 2,000,000) that the org's own funnel can't explain.

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
- **WellSpring Technologies is NOT the clean example anymore.** Canonical funnel ordering revealed its deeper stages all report a flat 15,000 (previously masked by value-sorted ordering) — it now correctly reads as a broken funnel. Use **BrightWell Solutions (AP2)** or **PureFlow Innovations (AP4)** (zero warnings) for the clean contrast.
