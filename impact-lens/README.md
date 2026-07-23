# ImpactLens

Turns previously unseen CSV/XLSX programme data into validated KPIs, a chart, framework-aware interpretation, and auditable source evidence. Built for the Claude Impact Lab hackathon (Yunus Social Innovation track).

**Architecture:** parse+profile (Papa Parse/SheetJS, deterministic) → one Claude call producing a schema-validated `SemanticPlan` (≤4 KPIs, constrained formula language) → deterministic evaluation against parsed rows (nothing model-generated is executed) → SQLite-cached dashboard with an evidence drawer per KPI. See [`docs/superpowers/plans/2026-07-23-impactlens-mvp.md`](../docs/superpowers/plans/2026-07-23-impactlens-mvp.md) for the full task plan and [`plans/05-impactlens-reconciliation.md`](../plans/05-impactlens-reconciliation.md) for how this relates to the separately-built deep harmonization `pipeline/`.

## Requirements

- Bun 1.3+
- `ANTHROPIC_API_KEY` in `.env.local` (SDK transport, default — see below)

## Run locally

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verify

```bash
bun run test    # 6 tests across parsing/semantic/metrics/pipeline
bun run lint
bun run build
```

## Seed demo projects (no upload needed)

```bash
bun run seed:fallback     # synthetic programme data, precomputed plan — zero Claude calls, always works
bun run seed:harmonized   # imports the ../pipeline/data/harmonized.json deep-portfolio table (run pipeline first)
bun run seed:aurelia -- <directory>   # generic seed: profiles real files in <dir>, calls Claude once
```

**Run seed scripts with `bun run seed:*` (which invokes `tsx`), never `bun scripts/seed-project.ts` directly.** `better-sqlite3`'s native binary crashes Bun's own JS engine (an N-API bug) — it only works correctly under Node, which is what `tsx` and Next.js's own dev/prod server actually use even when launched via `bun run dev`.

## Local configuration

`.env.local` (gitignored) needs `ANTHROPIC_API_KEY`. Optional: `CLAUDE_MODEL` (defaults to `claude-opus-4-8`), `CLAUDE_TRANSPORT=cli` to use the Claude Code CLI instead of the SDK (strips `CLAUDECODE`/`CLAUDE_CODE_*` from the subprocess env so it doesn't refuse to run nested), `CLAUDE_TIMEOUT_MS`, `CLAUDE_MAX_BUDGET_USD`. Raw uploads, generated analysis workspaces, and local SQLite state live under `.data/`, excluded from git.

## Genericity

No dataset-specific logic lives in `src/` — verify with `rg -n -i "beneficiar|aurelia|cohort|midline|endline|ysi|ap[1-4]" src`. Every hit that survives is a false positive from the substring "ysi" inside "anal**ysi**s"/"analysing", or a generic wave-detection hint (`baseline`/`midline`/`endline`) used to pick chart type on *any* dataset. `scripts/seed-project.ts` and `scripts/lib/harmonized.ts` reference Aurelia only as seed-time context, never as application logic.
