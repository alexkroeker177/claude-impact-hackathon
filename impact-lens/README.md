# ImpactLens

ImpactLens turns unfamiliar CSV/XLSX programme data into reviewed, evidence-backed impact KPIs. Claude Code interprets field meaning; deterministic TypeScript validates references and calculates every displayed value.

## Requirements

- Bun 1.3+ with its built-in cross-platform SQLite runtime
- Claude Code installed and authenticated for live interpretation

## Run locally

```powershell
bun install
Copy-Item .env.example .env.local
bun run seed:fallback
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). The committed fallback is synthetic and works without Claude.

On macOS, use `cp .env.example .env.local`; all application filesystem and subprocess operations use Node APIs rather than shell-specific commands.

## Live analysis

Set `CLAUDE_PATH` only when `claude` is not available on `PATH`. Authentication remains in the local Claude Code installation; the app does not store an Anthropic API key.

```dotenv
CLAUDE_PATH=
CLAUDE_MODEL=
CLAUDE_MAX_BUDGET_USD=1.00
CLAUDE_MAX_TURNS=5
CLAUDE_TIMEOUT_MS=120000
```

The application accepts any number of CSV/XLSX files subject to a 10 MB combined limit and 25,000 parsed rows. Raw uploads and generated state stay unchanged under ignored `.data/`.

## Demo seeds

```powershell
# Offline synthetic fallback
bun run seed:fallback

# Generic directory analysis; accepts Windows or POSIX absolute paths
bun run seed:aurelia -- "D:\path\to\dataset"
```

The Aurelia command contains no hard-coded filenames, headers, joins, or metrics. It enumerates supported files and runs the same analysis path as upload.

## Verify

```powershell
bun run test
bun run lint
bun run build
```

See [docs/demo-runbook.md](docs/demo-runbook.md) for the pitch flow and recovery steps.

## Safety model

- Claude receives project context plus structural profiles and aggregate ranges—not raw uploads or sample rows.
- Claude proposes a constrained semantic plan; the app never executes generated code, SQL, formulas, or chart configuration.
- Values, coverage, warnings, and evidence are computed deterministically.
- Framework output is labelled **Candidate alignment**, never certification or compliance.
- Missing values remain missing and are never replaced with zero.
