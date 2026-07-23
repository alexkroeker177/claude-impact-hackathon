# ImpactLens demo runbook

## Before the pitch

1. Install dependencies with `bun install`.
2. Copy `.env.example` to `.env.local` and set `CLAUDE_PATH` when Claude is not on `PATH`.
3. Run `bun run seed:fallback` so the synthetic project is always available.
4. Optionally run `bun run seed:aurelia -- "<absolute dataset directory>"` from a plain terminal.
5. Start the app with `bun run dev` and open `http://localhost:3000`.

Do not start the dev server from inside a Claude Code session. The application runner strips inherited `CLAUDECODE` variables, but a plain terminal remains the simplest live-demo setup.

## Rehearsal A — stable fallback

Target: under 90 seconds.

1. Open **Harbor Health Collective** from Projects.
2. Point out the reach-to-impact funnel and coverage on every KPI.
3. Open one evidence drawer and show the exact source, formula, record accounting, example rows, and caveat.
4. Open **Early warnings** and explain that ImpactLens flags missingness rather than silently correcting it.
5. Open **Outlook** and show that it refuses to invent a probability when evidence is insufficient.

Recovery: `/projects/demo` is precomputed and does not require Claude, uploads, or network access.

## Rehearsal B — unseen upload

Target: under three minutes.

1. Create a project and describe its goal in one sentence.
2. Upload an unseen CSV or XLSX file.
3. Show the real parsing and interpretation stages.
4. Review Claude's proposed KPIs and remove one.
5. Generate the dashboard and open one evidence drawer.

Recovery: if Claude times out or is unauthenticated, show that profiles remain saved, retry once, then return to the fallback project.

## Hackathon-machine rehearsal record

Verified on Windows on 2026-07-23 against the production build:

- `/` redirects to `/projects`; the project list and cached dashboards return HTTP 200.
- The generic Aurelia seed loaded 19 CSV files as 19 tables and produced four accepted KPIs. Its cached dashboard opens without another Claude call.
- An unseen XLSX workbook with two worksheets uploaded as six rows, reached KPI review after one Claude run, and produced four deterministic KPIs plus a grouped bar chart and evidence. Interpretation took about 92 seconds; dashboard generation took under two seconds.
- The synthetic fallback installs with `bun run seed:fallback` and remains available at `/projects/demo` without Claude.

For the pitch, allow two minutes for the live Claude interpretation even though the target script is three minutes overall. If it runs longer, narrate the already-visible parsed table profiles, retry once, and switch to the cached Aurelia or synthetic dashboard.

## Platform configuration

```text
Windows: CLAUDE_PATH=C:\Users\<user>\.local\bin\claude.exe
macOS:   CLAUDE_PATH=/Users/<user>/.local/bin/claude
```

Windows is the hackathon-tested platform. macOS support is designed through Node path/process APIs and must be described as designed-for portability until smoke-tested on a Mac.

## Final safety check

- `.data/` is ignored.
- No supplied dataset or raw upload is staged.
- The synthetic badge is visible on fallback data.
- The pitch calls framework tags **Candidate alignment**, never certification or compliance.
