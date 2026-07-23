# ImpactLens MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean Next.js application that converts previously unseen CSV/XLSX programme data into validated KPIs, a chart, framework-aware interpretation, and auditable source evidence.

**Architecture:** A pure analysis core parses and profiles uploaded tables, runs one bounded `claude -p` subprocess in a read-only analysis workspace, validates its semantic plan, and calculates accepted KPI definitions directly from parsed rows. A thin Next.js layer adds the upload/review/dashboard flow and caches aggregate results in SQLite; raw files remain unchanged on ignored local disk.

**Tech Stack:** Next.js App Router, TypeScript, Bun, Tailwind CSS, Papa Parse, SheetJS, Claude Code CLI, Zod, SQLite via Bun's built-in `bun:sqlite`, Recharts, Vitest.

## Current repository status — 2026-07-23

- Tasks 1–7 are implemented together on `codex/impactlens-mvp` as one integrated vertical slice.
- The generic parser/profiler, bounded Claude Code semantic pass, deterministic evaluator, join audit, warnings, chart selection, SQLite cache, APIs, wizard, dashboard, evidence UI, and both seed commands are present.
- Claude receives structural profiles and aggregate ranges only—never raw uploads or sample rows. Interpretation is atomically single-run per project; repeat requests return the saved plan.
- Raw uploads remain unchanged under ignored `.data/`; same-named files receive stable non-path identities so source references cannot collide.
- Strict Zod contracts validate semantic plans and persisted dashboards. Generation reuses the saved plan and cannot launch Claude.
- Current verification: 12/12 Vitest tests pass, ESLint passes, and the Next.js production build completes. `/projects`, `/projects/demo`, and `/projects/new` return 200 from the built app; a fresh multipart CSV upload returns 201.
- The synthetic fallback seed installs successfully. The 19-file Aurelia directory is within upload limits, but its one-run Claude interpretation still exceeds the bounded 180-second seed timeout; this remains the only known MVP acceptance blocker.
- Review cards now expose source fields, formula, confidence, estimated field coverage, rationale, and exclusions. Project cards show source/KPI counts, charts render their declared bar/line/funnel type, and dashboard assessment text is assembled deterministically from calculated results.
- The plan's intermediate red/green and per-task commit checkpoints were intentionally skipped under the build-first/time-saving instruction; implementation evidence is recorded at the final integrated checkpoint.
- Windows is the implementation and test platform. macOS remains designed for portability but explicitly not smoke-tested.

### Integrated module boundary

| UI workstream | Ingestion workstream |
| --- | --- |
| `src/components/**` | `src/lib/**` |
| `src/app/projects/[id]/page.tsx` | `src/app/api/**` |
| `src/types/dashboard.ts` | uploads, persistence, Claude execution, metric calculation |
| `fixtures/synthetic-dashboard.json` | parser, profiler, semantic plan, evidence production |

The former parallel workstreams are integrated through one strictly validated `DashboardAnalysis` object. Fixture and production results use the same shape.

## Global Constraints

- Create `impact-lens/` from scratch; do not import, copy, or depend on `ysi-dashboard/`.
- Accept any number of `.csv` and `.xlsx` files within 10 MB combined and 25,000 parsed rows.
- Use one bounded `claude -p` subprocess per analysis run for semantic interpretation, KPI proposals, IMM coverage, and candidate framework tags.
- Invoke Claude Code with an argument array and `shell: false`; never interpolate user or file content into a command string.
- Give Claude Code only the built-in Read tool in an isolated run directory containing redacted profiles, never raw uploads or the repository.
- Require `--json-schema`, `--safe-mode`, `--no-session-persistence`, `--max-turns 3`, a configured budget, and a timeout.
- Support Windows and macOS: use TypeScript scripts, `node:path`, `node:os`, native argument-array subprocesses, and no shell-specific application commands.
- Never execute model-generated code, SQL, formulas, or chart configuration.
- Calculate KPI values, coverage, warnings, and chart series deterministically from parsed rows.
- Keep raw uploads unchanged under ignored `.data/uploads/`; never commit Aurelia data or generated local state.
- Analyse tables independently unless one exact join passes the strict audit and the user confirms it.
- Do not implement fuzzy joins, numeric forecasting, natural-language extra KPIs, or a row-level canonical database.
- Treat SDG, IRIS+, ESG, Triple Bottom Line, and Five Dimensions output as candidate interpretation, never compliance.
- Do not emit official SDG indicator IDs or IRIS+ metric codes unless the exact identifier was supplied by the user.
- Missing values remain missing and are counted in evidence; they are never replaced by zero.
- Maintain exactly five critical automated test cases before adding UI polish.

---

## File map

```text
impact-lens/
  .env.example
  .gitignore
  scripts/seed-project.ts
  fixtures/synthetic-impact.csv
  fixtures/synthetic-dashboard.json
  src/app/api/projects/route.ts
  src/app/api/projects/[id]/interpret/route.ts
  src/app/api/projects/[id]/generate/route.ts
  src/app/projects/new/page.tsx
  src/app/projects/[id]/page.tsx
  src/app/page.tsx
  src/components/project-wizard.tsx
  src/components/review-step.tsx
  src/components/dashboard.tsx
  src/components/evidence-drawer.tsx
  src/lib/files/parse.ts
  src/lib/files/profile.ts
  src/lib/semantic/schema.ts
  src/lib/semantic/validate.ts
  src/lib/claude/run.ts
  src/lib/semantic/interpret.ts
  src/lib/metrics/evaluate.ts
  src/lib/analysis/pipeline.ts
  src/lib/analysis/joins.ts
  src/lib/analysis/warnings.ts
  src/lib/analysis/charts.ts
  src/lib/db/client.ts
  src/lib/db/projects.ts
  tests/analysis.test.ts
  tests/setup.ts
  vitest.config.ts
```

---

### Task 1: Scaffold the app and prove CSV/XLSX parsing

**Files:**
- Create: `impact-lens/` scaffold
- Create: `impact-lens/src/lib/files/parse.ts`
- Create: `impact-lens/src/lib/files/profile.ts`
- Create: `impact-lens/tests/analysis.test.ts`
- Create: `impact-lens/tests/setup.ts`
- Create: `impact-lens/vitest.config.ts`
- Modify: `impact-lens/package.json`
- Modify: `impact-lens/.gitignore`

**Interfaces:**
- Produces: `parseTabularFile(input: FileInput): ParsedTable[]`, `profileTable(table: ParsedTable): SourceProfile`
- `ParsedTable` preserves filename, optional sheet name, stable field IDs, original row numbers, raw string values, and parse warnings.

- [x] **Step 1: Scaffold and install only MVP dependencies**

```powershell
bunx create-next-app@latest impact-lens --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-bun
Set-Location impact-lens
bun add better-sqlite3 papaparse recharts xlsx zod
bun add -d @types/better-sqlite3 @types/papaparse jsdom tsx vitest
```

Add scripts `test: "vitest run"`, `test:watch: "vitest"`, `seed:aurelia: "tsx scripts/seed-project.ts"`, and `seed:fallback: "tsx scripts/seed-project.ts --fallback"`. Add `.data/` to `.gitignore`.

- [x] **Step 2: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", setupFiles: ["./tests/setup.ts"], fileParallelism: false },
});
```

Create `tests/setup.ts` to set `IMPACTLENS_DB_PATH` to `.data/vitest-<pid>.db`.

- [x] **Step 3: Write automated tests 1 and 2 before implementation**

In `tests/analysis.test.ts`, test 1 parses a BOM-prefixed semicolon CSV containing a blank value and asserts two rows, correct headers, source row `2`, and a numeric field profile with the blank preserved. Test 2 creates an in-memory SheetJS workbook with two worksheets and asserts two `ParsedTable` results with distinct `sourceId` values.

```ts
it("1. parses and profiles CSV without turning missing values into zero", () => {
  const csv = "\uFEFFid;wave;beneficiaries\nA;Baseline;100\nB;Baseline;\n";
  const [table] = parseTabularFile({ name: "impact.csv", bytes: new TextEncoder().encode(csv) });
  const profile = profileTable(table);
  expect(table.rows[1].values.beneficiaries).toBe("");
  expect(profile.fields.find((f) => f.header === "beneficiaries")?.nullRate).toBe(0.5);
});
```

- [ ] **Step 4: Run tests and confirm failure**

Run: `bun test`

Expected: two failures because parser/profiler modules do not exist.

- [x] **Step 5: Implement deterministic parsing and profiling**

CSV parsing uses Papa Parse delimiter detection, `skipEmptyLines: "greedy"`, BOM removal, and multiline quoted-cell support. XLSX parsing enumerates every non-empty worksheet with `sheet_to_json({ header: 1, raw: false, defval: "" })`. Profiling infers boolean, percentage, currency, integer, number, date, identifier, category, or text; calculates missingness/uniqueness/ranges; emits at most five redacted samples; and never assigns semantic meaning.

- [ ] **Step 6: Verify and commit**

```powershell
bun test
bun run lint
git add impact-lens
git commit -m "feat: parse and profile tabular impact data"
```

Expected: exactly two passing tests.

---

### Task 2: Validate one framework-aware Claude semantic plan

**Files:**
- Create: `impact-lens/src/lib/semantic/schema.ts`
- Create: `impact-lens/src/lib/semantic/validate.ts`
- Create: `impact-lens/src/lib/claude/run.ts`
- Create: `impact-lens/src/lib/semantic/interpret.ts`
- Modify: `impact-lens/tests/analysis.test.ts`
- Create: `impact-lens/.env.example`

**Interfaces:**
- Consumes: `{ projectName, goal, attention, profiles }`
- Produces: `runClaudeStructured<T>(input): Promise<T>`, `interpretProject(input): Promise<SemanticPlan>`, `validateSemanticPlan(plan, profiles, userContext): SemanticPlan`

- [x] **Step 1: Define the structured contract**

Use Zod to define `FieldRef`, table purposes, field roles, optional exact `CandidateJoin`, and up to four `MetricDefinition` objects. Define formulas as either one atomic `count | distinct_count | sum | average` expression or one `ratio` with two atomic expressions. Define:

```ts
type FrameworkTag = {
  framework: "five_dimensions" | "sdg" | "iris_plus" | "esg" | "triple_bottom_line";
  label: string;
  confidence: number;
  evidenceBasis: "project_context" | "field_evidence" | "user_supplied";
  rationale: string;
  caveat: string;
  referenceId?: string;
};
```

The plan includes Theory-of-Change coverage for activity/output/outcome/impact and Five Dimensions coverage for what/who/how much/contribution/risk, each with `identified | partial | not_found`, field references, and rationale.

- [x] **Step 2: Write automated test 3**

Create a valid plan and a synthetic Claude Code JSON envelope, then assert the runner extracts and validates the structured result. Also assert validation rejects:

- a nonexistent `fieldId`;
- an unsupported formula operation;
- an `sdg` official indicator-like `referenceId` absent from user context; and
- an `iris_plus` metric code absent from user context.

```ts
it("3. rejects invalid Claude references and invented standards IDs", () => {
  expect(() => validateSemanticPlan({ ...validPlan, proposedMetrics: [metricWithMissingField] }, profiles, context)).toThrow(/unavailable field/i);
  expect(() => validateSemanticPlan(planWithInventedIrisCode, profiles, context)).toThrow(/user-supplied context/i);
});
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `bun test -t "3\."`

Expected: failure because schemas and validation do not exist.

- [x] **Step 4: Implement the bounded Claude Code runner**

Resolve the executable from `CLAUDE_PATH`, then `PATH`, then `path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude")`. Create `.data/runs/<uuid>/analysis-input.json` containing only project context, profiles, and redacted samples. Spawn with `node:child_process.spawn(executable, args, { cwd: runDir, shell: false, stdio: ["ignore", "pipe", "pipe"] })` and these arguments:

```ts
[
  "-p", "Read analysis-input.json and return the requested semantic plan.",
  "--output-format", "json",
  "--json-schema", JSON.stringify(jsonSchema),
  "--max-turns", "3",
  "--max-budget-usd", configuredBudget,
  "--tools", "Read",
  "--permission-mode", "dontAsk",
  "--safe-mode",
  "--no-session-persistence",
]
```

Add `--model` only when `CLAUDE_MODEL` is configured. Capture stdout/stderr with size caps, enforce `CLAUDE_TIMEOUT_MS`, terminate on timeout, require exit code zero, parse the JSON wrapper, extract structured output, and validate it again with Zod. Return specific retryable errors for missing CLI, authentication, timeout, budget, non-zero exit, and invalid output.

Implement timeout cleanup with `child.kill("SIGTERM")`, a short grace timer, and `child.kill("SIGKILL")`; Node maps this to process termination on Windows. Do not call `cmd.exe`, PowerShell, Bash, or interpolate a command string.

- [x] **Step 5: Implement semantic interpretation**

Write compact profiles and redacted samples to the isolated analysis packet. The prompt requires output matching the JSON Schema, at most four calculable KPIs, explicit uncertainty, no invented fields, candidate framework alignment only, and no compliance claims. Validate all field references, remove invalid metrics individually, and fail only if the overall plan is malformed.

Create `.env.example`:

```dotenv
CLAUDE_PATH=
CLAUDE_MODEL=
CLAUDE_MAX_BUDGET_USD=1.00
CLAUDE_TIMEOUT_MS=90000
```

Authentication remains in the locally configured Claude Code installation; the app does not manage an Anthropic API key.

- [ ] **Step 6: Verify and commit**

```powershell
bun test
bun run lint
git add impact-lens
git commit -m "feat: interpret impact schemas with Claude"
```

Expected: three passing tests.

---

### Task 3: Calculate constrained KPIs with evidence

**Files:**
- Create: `impact-lens/src/lib/metrics/evaluate.ts`
- Modify: `impact-lens/tests/analysis.test.ts`

**Interfaces:**
- Consumes: `MetricDefinition`, `ParsedTable`, optional confirmed exact join
- Produces: `evaluateMetric(definition, tables, join?): MetricResult`

```ts
type MetricResult = {
  metricId: string;
  value: number | null;
  coverage: number;
  recordsUsed: number;
  recordsAvailable: number;
  missingRecords: number;
  excludedRecords: number;
  series: Array<{ label: string; value: number | null }>;
  evidence: {
    sourceIds: string[];
    fieldRefs: FieldRef[];
    formula: string;
    filters: MetricFilter[];
    exampleRows: Array<{ sourceId: string; rowNumber: number }>;
    caveats: string[];
  };
};
```

- [x] **Step 1: Write automated test 4**

Use rows with values `100`, `200`, and blank. Assert sum `300`, average `150`, coverage `2/3`, five-or-fewer evidence rows, and a ratio with zero denominator returns `null` plus a divide-by-zero caveat.

- [ ] **Step 2: Run the test and confirm failure**

Run: `bun test -t "4\."`

Expected: failure because `evaluateMetric` does not exist.

- [x] **Step 3: Implement the evaluator**

Support exact equality and non-empty filters, at most one group-by field, four atomic operations, and one-level ratio. Validate numeric types for sum/average, deduplicate values for distinct count, exclude missing/invalid values, reject nested ratios, and build evidence from actual contributing rows.

- [ ] **Step 4: Verify and commit**

```powershell
bun test
bun run lint
git add impact-lens
git commit -m "feat: calculate evidence-backed KPIs"
```

Expected: four passing tests.

---

### Task 4: Prove the entire risky path in one integration test

**Files:**
- Create: `impact-lens/src/lib/analysis/warnings.ts`
- Create: `impact-lens/src/lib/analysis/charts.ts`
- Create: `impact-lens/src/lib/analysis/joins.ts`
- Create: `impact-lens/src/lib/analysis/pipeline.ts`
- Modify: `impact-lens/tests/analysis.test.ts`

**Interfaces:**
- Consumes: project context, `FileInput[]`, injected `interpret` function, accepted metric IDs, optional confirmed join
- Produces: `runAnalysis(input): Promise<DashboardAnalysis>`

- [x] **Step 1: Write automated test 5**

Inject a deterministic semantic plan into `runAnalysis`. Assert an unseen fixture reaches a dashboard result with two calculated KPIs, one bar or line chart, Five Dimensions coverage, at least one missingness warning, and evidence referencing real source rows. Assert the original header names are not mentioned anywhere in application logic outside the fixture/plan.

- [ ] **Step 2: Run the test and confirm failure**

Run: `bun test -t "5\."`

Expected: failure because orchestration does not exist.

- [x] **Step 3: Implement the exact-join audit**

`auditExactJoin(candidate, tables)` normalises values only with Unicode NFKC, trim, and case folding. It returns eligible only for compatible key types, at least 90% match coverage on the relevant side, zero duplicates on the required one side, and no many-to-many pairs. It rejects fuzzy/composite candidates. Until the user confirms an eligible audit, cross-file metrics remain invalid.

- [x] **Step 4: Implement minimal warnings and chart selection**

Warnings cover parse failures, missingness `>= 50%`, mixed physical types, invalid numeric/date values, duplicate candidate IDs, low coverage, rejected joins, and non-increasing violations only for an explicitly identified ordered same-table funnel. Charts are selected deterministically: ordered time → line; category → bar; explicitly ordered same-table stages → funnel; otherwise no chart.

- [x] **Step 5: Implement pure orchestration**

`runAnalysis` enforces 10 MB/25,000 rows without checking file count, parses and profiles all files, calls the injected interpreter once, validates the plan, evaluates accepted metrics, selects at most one primary chart, and returns a deterministic assessment plus framework metadata and warnings.

- [ ] **Step 6: Verify the core thesis and commit**

```powershell
bun test
bun run lint
git add impact-lens
git commit -m "feat: run generic impact analysis end to end"
```

Expected: exactly five passing tests. Do not add more automated tests before the live flow works.

---

### Task 5: Add SQLite caching and the upload/review wizard

**Files:**
- Create: `impact-lens/src/lib/db/client.ts`
- Create: `impact-lens/src/lib/db/projects.ts`
- Create: `impact-lens/src/app/api/projects/route.ts`
- Create: `impact-lens/src/app/api/projects/[id]/interpret/route.ts`
- Create: `impact-lens/src/app/api/projects/[id]/generate/route.ts`
- Create: `impact-lens/src/app/projects/new/page.tsx`
- Create: `impact-lens/src/components/project-wizard.tsx`
- Create: `impact-lens/src/components/review-step.tsx`

**Interfaces:**
- Produces: multipart project creation, retryable interpretation, review submission, and cached dashboard generation.

- [x] **Step 1: Create the five-table schema**

Create `projects`, `sources`, `analysis_runs`, `metrics`, and `findings`. Store profiles, semantic plans, definitions, results, chart series, framework metadata, and evidence as validated JSON. Store raw-file paths in `sources`; do not create entity or observation tables.

- [x] **Step 2: Implement upload validation and storage**

`POST /api/projects` accepts the three context fields and any number of CSV/XLSX files. Reject combined bytes above `10 * 1024 * 1024`, parsed rows above `25_000`, or unsupported formats. Sanitize filenames, store originals under `.data/uploads/<project-id>/`, persist profiles, and isolate individual parse failures.

Use `path.basename` only for display labels and a generated UUID plus original extension for storage. Reject names whose resolved storage path escapes the project upload directory. Use `path.join` and `fs.mkdir({ recursive: true })`; do not concatenate filesystem separators.

- [x] **Step 3: Implement interpretation and generation routes**

`POST /api/projects/:id/interpret` loads profiles and performs the single bounded `claude -p` run. `POST /api/projects/:id/generate` accepts `acceptedMetricIds` and optional `confirmedJoinId`, reparses raw files, evaluates metrics, stores aggregate results, and never launches Claude again.

- [x] **Step 4: Build one compact wizard**

The wizard contains project name, goal, optional attention, unlimited-count file picker, real processing stages, concise understanding, file/table summary, Five Dimensions coverage, optional framework tags, three/four KPI cards, optional exact join confirmation, and collapsed advanced details. It redirects to `/projects/<id>` after generation.

- [ ] **Step 5: Manually smoke-test and commit**

Run `bun run dev`; create projects from one CSV, one XLSX, and several small files. Confirm no count cap exists, combined safeguards work, one KPI can be removed, and refresh preserves the review state.

```powershell
bun test
bun run lint
bun run build
git add impact-lens
git commit -m "feat: add ImpactLens upload and review workflow"
```

---

### Task 6: Render the dashboard, evidence, and limited-result states

**Files:**
- Create: `impact-lens/src/app/projects/[id]/page.tsx`
- Create: `impact-lens/src/components/dashboard.tsx`
- Create: `impact-lens/src/components/evidence-drawer.tsx`
- Modify: `impact-lens/src/app/page.tsx`
- Modify: `impact-lens/src/app/globals.css`

**Interfaces:**
- Consumes: cached `DashboardAnalysis`
- Produces: Overall, Early Warnings, and Outlook tabs with auditable KPI evidence.

- [x] **Step 1: Render the official Overall MVP**

Show two to four KPI cards, at most one Recharts line/bar/funnel chart, deterministic assessment, coverage, Five Dimensions strip, and optional candidate framework tags. Label every tag `Candidate alignment` and never use compliance language.

- [x] **Step 2: Implement evidence drawers**

Display source filename/sheet, fields, formula, filters, used/available/missing/excluded counts, confidence, assumptions, caveats, and up to five row examples. Provide a textual summary for every chart.

- [x] **Step 3: Render warnings and Outlook**

Separate basic Data warnings from stretch Project warnings. Outlook displays `Insufficient evidence` with missing requirements; do not implement scoring or forecasting. Empty charts and unsupported framework tags are omitted.

- [x] **Step 4: Add project list and failure states**

List ready/processing/failed projects, preserve parsed profiles after Claude failure, offer retry, explain when fewer than two KPIs survive validation, and open cached dashboards without a model call.

Current implementation note: project routes now load strict validated dashboards from SQLite, resume saved reviews, distinguish interpretation from generation failures, and retain the synthetic fallback route.

- [x] **Step 5: Commit the integrated implementation**

Verification record on 2026-07-23: the single requested final suite passed 10/10 tests. A static security/code review was completed and its critical findings were fixed. No second test run, lint, or production build was performed after those fixes, per user instruction.

```powershell
bun test
bun run lint
bun run build
git add impact-lens
git commit -m "feat: render explainable impact dashboards"
```

---

### Task 7: Seed both demos and rehearse the pitch

**Files:**
- Create: `impact-lens/scripts/seed-project.ts`
- Create: `impact-lens/fixtures/synthetic-impact.csv`
- Create: `impact-lens/fixtures/synthetic-dashboard.json`
- Create: `impact-lens/README.md`
- Create: `impact-lens/docs/demo-runbook.md`
- Modify: `impact-lens/package.json`

**Interfaces:**
- Produces: `bun run seed:aurelia -- <directory>`, `bun run seed:fallback`, and a pitch-ready local app.

- [x] **Step 1: Implement the generic Aurelia directory seed**

Enumerate every supported CSV/XLSX file in the supplied directory with Node filesystem APIs, enforce only combined byte/row limits, and call the same shared pipeline as upload. Project context may name Aurelia, but the script contains no source filenames, headers, metrics, or join mappings. Persist ignored local results. The command accepts either a Windows or POSIX absolute directory path.

After seeding, inspect the validated semantic plan against the four documented Aurelia themes:

1. five-level reach-to-impact funnel;
2. organisational performance and financials;
3. Knowledge and Behaviour capability lift; and
4. programme feedback and satisfaction.

The seed passes when the generic plan identifies the five-level funnel plus at least one other theme. Do not patch the prompt or application with YSI headers to force this result. If a theme is detected but not safely calculable, retain it as an explained evidence gap.

For funnel metrics, calculate and warn on non-increasing-stage violations only after Claude Code identifies an ordered same-table funnel. For financial metrics, reject ambiguous currencies or number formats. For capability lift, require comparable fields, ordered waves, and any necessary confirmed exact join. For feedback, calculate only clear numeric scales; treat free text as detected qualitative evidence without cross-response theme synthesis.

- [x] **Step 2: Add the committed synthetic fallback**

Create invented programme data and a precomputed validated dashboard JSON. `seed:fallback` installs that cache without Claude so the pitch retains a ready example during API failure. Mark the project `synthetic` in the UI.

- [x] **Step 3: Audit genericity and repository safety**

```powershell
rg -n -i "beneficiar|aurelia|cohort|midline|endline|ysi|ap[1-4]" src
git check-ignore -v impact-lens/.data/impactlens.db
git status --short
```

Expected: no YSI-specific application logic; `.data` ignored; no supplied dataset staged.

- [ ] **Step 4: Run final verification** — tests/lint/build and fallback seed pass; Aurelia seed remains blocked by bounded Claude timeout.

```powershell
bun test
bun run lint
bun run build
bun run seed:fallback
bun run seed:aurelia -- "D:\Claude_Impact_Hackathon\Aurelia_Propel_IMM Dataset"
```

Expected: five tests pass, lint/build succeed, both seeded projects open, and no raw or local state enters git.

- [ ] **Step 5: Rehearse both live paths**

Rehearsal A: open Aurelia → KPIs/chart → Five Dimensions → evidence → warning.

During Rehearsal A, show the discovered five-level funnel and one additional safe Aurelia theme. Open the funnel evidence and, if present, explain one monotonicity warning as a review signal rather than an automatic data correction.

Rehearsal B: new project → unseen upload → one bounded `claude -p` run → remove KPI → generate → evidence.

Record timings and recovery steps in `docs/demo-runbook.md`. Keep one unseen CSV and one unseen XLSX available.

Document and manually smoke-test these two configurations:

```text
Windows: CLAUDE_PATH=C:\Users\<user>\.local\bin\claude.exe
macOS:   CLAUDE_PATH=/Users/<user>/.local/bin/claude
```

Run the full live path on the hackathon machine. Before claiming macOS support, run parser, build, Claude health check, seed fallback, and one upload smoke test on a macOS machine; if unavailable before the pitch, label macOS as designed-for portability but not yet smoke-tested.

- [x] **Step 6: Commit pitch readiness**

```powershell
git add impact-lens/scripts impact-lens/fixtures impact-lens/README.md impact-lens/docs impact-lens/package.json impact-lens/bun.lock
git commit -m "feat: prepare ImpactLens hackathon demo"
```

---

## Stop rule

Task 4 proves the product thesis without UI. Task 5 creates the live vertical slice. Task 6 completes the official MVP. If time contracts, do not start stretch work; seed the demos and rehearse the stable checkpoint.
