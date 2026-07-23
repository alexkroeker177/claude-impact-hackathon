# Plan 05 — Reconciliation: ImpactLens × Harmonization Pipeline

> Written 2026-07-23 after the ImpactLens docs landed ([spec](../docs/superpowers/specs/2026-07-23-impactlens-design.md), [MVP plan](../docs/superpowers/plans/2026-07-23-impactlens-mvp.md)). **ImpactLens is the governing implementation plan for the app.** This doc normalizes terminology, records what is already built, and defines the integration points. Plans 02/03/04 in this folder are **superseded** by the ImpactLens docs; plan 01 (pipeline) is **built and shipping**.

## The two layers — same philosophy, different jobs

Both systems share the product's core thesis: **Claude interprets, deterministic code validates and calculates, evidence traces everything.** They apply it at different depths:

| | ImpactLens (to build — teammates) | Harmonization pipeline (BUILT — `pipeline/`) |
| --- | --- | --- |
| Job | Generic first-pass: any unseen CSV/XLSX → semantic plan → reviewed KPIs → evidence | Deep portfolio harmonization: known multi-wave dataset → canonical longitudinal table |
| Entity resolution | Explicitly out of scope (tables independent, 1 exact join max) | Done — 61 orgs from person/org/email triples, 0 unresolved rows |
| Cross-wave / longitudinal | Out of scope | Done — org × wave × date long table, 2,473 records |
| LLM role | One bounded `claude -p` semantic plan | Per-file mappings, entity resolution, per-cell semantic normalization, per-record evidence grades (A–D/N) |
| Aurelia results | Seed must *discover* the funnel + 1 theme | Funnel extracted per org per wave with monotonicity checks, USD normalization, 192 anomalies, grades |

**Terminology fix:** when the ImpactLens docs say "standardization," they mean deterministic parse/profile (Papa Parse/SheetJS physical typing). Our `pipeline/` is the *harmonization* layer. Don't treat one as a substitute for the other: ImpactLens's parser (XLSX, unseen files, no manifest) still needs building; our pipeline is manifest-driven, CSV-only, and Aurelia-tuned by configuration.

## What this means for the build (no wasted work)

1. **Teammates build ImpactLens exactly per its task plan** (Tasks 1–7, stop rule respected). Nothing we built blocks or replaces it.
2. **Our pipeline becomes the "deep mode" proof + the strongest Aurelia demo asset.** The pitch gets two beats: ImpactLens live on an *unseen* upload (their Rehearsal B), then the same philosophy at full depth on YSI's real 3.5-year portfolio (funnel over waves, evidence grades, anomaly list, the origin-vs-formatted audit viewer). Production roadmap slide: ImpactLens's "reusable semantic layers / canonical observations" future *is* our pipeline — we've already de-risked it.
3. **Optional integration (cheap, decided by the ImpactLens owner):** a second generic seed path, `seed:harmonized -- <harmonized.json>`, that imports an externally-harmonized long table (our published contract: `org_id · wave · date · metric · value · grade · provenance`) as a ready project with precomputed series. It's data-driven — no YSI-specific logic in app code, passes the Task 7 genericity audit. Our side is zero effort (contract already emitted); their side ~30–45 min inside the seed script. If time is tight, skip — `pipeline/inspect.html` already demos provenance standalone.
4. **Evidence grades are a free upgrade to their evidence drawer.** Their evidence model (source, formula, coverage, caveats) can render our `grade` + `grade_reason` fields when present in imported data. Additive, optional.

## Flags for the ImpactLens implementer

- **`claude -p` inside a Claude Code session will refuse to run.** The CLI blocks nested sessions via the `CLAUDECODE` env var — if the Next.js dev server is started from a terminal inside Claude Code, the subprocess inherits it and dies. Strip `CLAUDECODE` (and `CLAUDE_CODE_*`) from the subprocess `env` in `src/lib/claude/run.ts`, or launch the dev server from a plain terminal.
- **SDK alternative exists if the CLI path fights back:** root `.env` already has `ANTHROPIC_API_KEY`; `pipeline/src/claude.ts` shows the working pattern (Opus 4.8 + structured outputs + streaming, schema-constrained JSON — equivalent guarantees to `--json-schema`). Same Zod contract either way; swap only `runClaudeStructured`'s transport.
- **Funnel monotonicity, currency ambiguity, N/A handling:** our S4b/S5 encountered all the real cases (multi-select Likert cells, "58% men and 42% women", `TBC`) — see [pipeline/README.md](../pipeline/README.md) and `build/anomalies.json` for ground truth to test against.

## Status snapshot (what exists right now)

- `pipeline/` v2: 17 files → 2,473 records, 61 orgs, grades A 1404 / B 647 / C 201 / D 158 / N 63, 192 anomalies. Artifacts: `data/harmonized.json`, `data/orgs.json`, `build/coverage.json`, `build/anomalies.json` (all gitignored — derived dataset content).
- `pipeline/inspect.html` (generated, untracked): origin-vs-formatted audit viewer with per-cell provenance and grades.
- `kpimpact/` (untracked scaffold) and the `agent/ysi-dataset-dashboard` branch: per ImpactLens's constraint ("do not import, copy, or depend on `ysi-dashboard/`"), treat both as abandoned unless their owner says otherwise.
