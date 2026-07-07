# Project Hygiene Policy

This document defines durable repository hygiene rules for NegotAItions.

## Repo Contents Policy

Commit only durable source and documentation:
- Application source code, tests, Prisma schema/migrations, and configuration under version control.
- Durable docs under `docs/*`.
- Sanitized templates (for example, `.env.example`).

Do not commit generated, temporary, or one-off forensic outputs.

## External Project Artifacts Structure

Raw outputs must live outside this repository under a sibling storage area:

`project-artifacts/`
- `audit/` - raw audit bundles, traces, and one-off investigation outputs.
- `forensics/` - deep-dive incident/debug exports.
- `e2e/` - Playwright videos, traces, screenshots, and html reports.
- `tmp/` - short-lived local scratch outputs.

Each artifact set should be in a dated folder (for example, `2026-07-07-<topic>/`) with a short README describing origin and retention.

## Server Artifact Policy

Server-local runtime/debug files must stay outside git-managed paths:
- Place service logs, dumps, and capture artifacts in server-local directories.
- Never copy server logs/secrets/debug captures into the repository.
- If evidence must be shared, sanitize and store it in `project-artifacts/*` outside repo.

## Branch Naming

Use predictable prefixes:
- `feature/<scope>`
- `fix/<scope>`
- `chore/<scope>`
- `docs/<scope>`
- `deploy/<scope>`

Prefer short lowercase kebab-case scope names.

## Artifact Naming

Use:
- `YYYY-MM-DD-<topic>-<type>.<ext>`

Examples:
- `2026-07-07-auth-flow-audit.zip`
- `2026-07-07-livekit-e2e-trace.json`

## What To Commit

- Source code and tests.
- Durable docs under `docs/*`.
- Sanitized templates and stable config required for onboarding.

## What Never To Commit

- Secrets (`.env`, API keys, private credentials).
- Archive bundles (`*.zip`, `*.tar*`, backups like `*.bak`, `*.old`).
- Generated reports and caches (`playwright-report`, `test-results`, `coverage`, `.debug`, `tmp`).
- One-off local/server forensic outputs.

## Cleanup Cadence

- Before each PR: run `git status` and remove accidental artifacts.
- Weekly: quick hygiene sweep for ignored outputs and stale one-off files.
- Before release/deploy branches: confirm no non-source artifacts are tracked.

## Deletion Approval Rule

Deleting potentially valuable forensic/audit artifacts requires explicit approval from a responsible engineer (feature owner, incident lead, or repository maintainer).  
When approved, record who approved and where the replacement storage location is.
