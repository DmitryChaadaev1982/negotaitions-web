# ADR-2026-07-07: Project Artifact Hygiene

- Status: Accepted
- Date: 2026-07-07
- Decision type: Repository hygiene / governance

## Context

The repository accumulated one-off artifacts (archives, temporary files, duplicate script snapshots) that are not durable source.  
This increases review noise, risks accidental leakage of sensitive runtime data, and makes long-term maintenance harder.

## Decision

1. Keep repository scope limited to durable source, tests, and durable docs.
2. Track a sanitized `.env.example` template while still ignoring real `.env*` files.
3. Ignore common generated/debug/artifact outputs (`.debug`, `tmp`, Playwright/test outputs, coverage, and archive extensions).
4. Store raw audits/forensics/e2e outputs outside the repo under `project-artifacts/*`.
5. Remove tracked one-off artifacts from git history going forward (without touching server state from this branch).

## Repo Contents Policy

- Allowed in repo: source, tests, Prisma assets, durable docs, sanitized templates.
- Disallowed in repo: one-off artifacts, generated outputs, secret-bearing files.

## External Artifact Structure

Use `project-artifacts/{audit|forensics|e2e|tmp}/YYYY-MM-DD-<topic>/` outside this repository.

## Server Artifact Policy

Server-generated logs/debug outputs remain on server-local paths and are never committed.

## Branch Naming

Use prefix-based naming (`feature/`, `fix/`, `chore/`, `docs/`, `deploy/`) with kebab-case scope.

## Artifact Naming

Use `YYYY-MM-DD-<topic>-<type>.<ext>` for clarity and retention tracing.

## What To Commit / Never Commit

- Commit: durable source and docs.
- Never commit: secrets, archives, caches, raw forensic/e2e/debug outputs.

## Cleanup Cadence

- Per PR hygiene check.
- Weekly lightweight artifact sweep.
- Pre-release verification on deploy branches.

## Deletion Approval Rule

Potentially valuable forensic artifacts may be deleted only after explicit maintainer/owner approval, with approval record and storage destination documented.

## Consequences

### Positive

- Cleaner diffs and faster reviews.
- Lower risk of accidental secret/debug data exposure.
- Clearer operational boundaries between code and artifacts.

### Trade-offs

- Teams must maintain an external artifact storage location.
- Slightly more process around artifact retention/deletion approvals.
