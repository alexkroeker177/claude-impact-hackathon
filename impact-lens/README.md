# ImpactLens

Next.js foundation for the Claude Impact Lab hackathon project.

## Requirements

- Bun 1.3+
- Claude Code installed and authenticated for the later interpretation step

## Run locally

```powershell
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verify

```powershell
bun run test
bun run lint
bun run build
```

## Local configuration

Copy `.env.example` to `.env.local` when Claude Code integration begins. Raw uploads, generated analysis workspaces, and local SQLite state belong under `.data/`, which is excluded from git.

## Current boundary

This scaffold intentionally contains no ingestion pipeline, database schema, upload API, or Claude runner yet. Those modules can be added independently without replacing the application shell.
