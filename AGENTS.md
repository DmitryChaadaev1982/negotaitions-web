# NegotAItions Agent Router

NegotAItions is a Next.js App Router negotiation-training product with PostgreSQL
via Prisma, provider-backed room/media services, and post-session materials/AI
workflows. This file routes Native Agent work. It is not a second engineering
lifecycle, worktree, validation, or deploy engine.

## Native vs Engineering Orchestrator

Cursor Native Agent is the normal interactive engineering interface.

- Normal reads, search, edits, and focused tests are Native.
- Tracked `.eo/repository-profile.json` is the Product-specific EO contract.
- `.eo/deployment-targets/negotaitions-production.json` is the standard
  production target, including canary `canaryHttpPath`.
- Machine-local paths and env source references live in the EO overlay, not
  in Git.
- EO owns durable Change Unit identity, sibling worktree/bootstrap, TYPED_IMPORT
  environment, test-instance/UAT, formal validation after UAT, and
  commit/release/deploy/canary.
- For an existing Change Unit, use public `CONTINUE_CHANGE_UNIT` /
  `eo change-unit continue`.
- `stage-start` is only a thin convenience wrapper to that EO entry point.
- Chat transcript is not lifecycle authority. After Open Folder, resume from
  the durable CU and tracked Product EO contract.

Do not use this file to create worktrees, copy `.env`, sequence L1–L4, pick
models, run formal validation, or progress a release. EO owns those.

## Start every task

1. Determine the affected domain(s).
2. Read only the authoritative documents for those domains in
   [`docs/architecture/README.md`](docs/architecture/README.md), plus the
   relevant scoped Cursor rule.
3. Read [`docs/architecture/code-map.md`](docs/architecture/code-map.md), then
   inspect the mapped source and existing tests before proposing or changing
   behavior.
4. Do not load unrelated stage, audit, or implementation history unless the
   current document links to it for a specific question.
5. Keep Product domain, privacy, database, and exceptional production safety
   rules. Do not invent a parallel CU/bootstrap/UAT/release sequencer.

Read the relevant guide under `node_modules/next/dist/docs/` before changing
Next.js code; this repository uses a version with breaking changes.

## Universal guardrails

- **Git:** verify the current branch and worktree before changing files.
  Never validate one worktree against another worktree's server. Do not
  commit, push, reset, or discard work without explicit user authorization.
  Do not create sibling Product worktrees as an EO substitute.
- **Environment:** never print, commit, or modify secret env values. Do not
  wholesale-copy `.env`. Use EO TYPED_IMPORT and the machine-local overlay
  source reference.
- **Database:** inspect `prisma/schema.prisma` and generated Prisma types before
  SQL or schema work. Do not guess columns. Migrations are deliberate,
  reviewable changes; do not rewrite migration history. See the scoped database
  rule and [`docs/architecture/10-data-storage-and-retention.md`](docs/architecture/10-data-storage-and-retention.md).
- **Architecture:** preserve canonical state authorities, server-side
  authorization, narrow CAS/control ownership, and role-specific privacy
  projections. Domain details live in the linked architecture documents.
- **Documentation:** when mapped runtime code changes, update its mapped
  current-state architecture document. New major flows also require updates to
  `docs/architecture/README.md` and `docs/architecture/code-map.md`. Historical
  documents remain historical; redirect conflicts to current-state truth.

## Native checks vs EO formal validation

Native Agent may run focused tests and bounded diagnostic checks during
implementation. Product owns commands such as `validate:fast`,
`validate:deploy`, `test:e2e:smoke`, and `test:e2e:smoke:browser`.

EO owns **when** canonical formal validation and release gates run. UAT
precedes formal validation. `validate-wave` is a thin wrapper to EO formal
validation for a durable CU; it is not a nested Agent validation state
machine.

Use [`docs/testing/validation-checklist.md`](docs/testing/validation-checklist.md)
for what Product commands check. Use
[`docs/testing/e2e-strategy.md`](docs/testing/e2e-strategy.md) for E2E
selection, database isolation, and managed/live modes. Use
[`docs/testing/observer-test-execution-policy.md`](docs/testing/observer-test-execution-policy.md)
for the observer smoke/layout trigger matrix. Do not run overlapping managed
Playwright servers. Tunnel and live-provider suites are opt-in.

## Production safety

Standard through-production release uses the exact accepted candidate, committed
SHA, resolved Product deployment target, valid StandingReleaseGrant, and typed
PREPARE/PREFLIGHT/DEPLOY/CANARY operations. It does not require repeated
low-level approvals for internal ssh/git/systemctl on that path.

Exceptional operations still need explicit authority. Raw Native production SSH
mutation remains prohibited. See
`.cursor/rules/deployment-production-safety.mdc` and
[`docs/operations/deployment-runbook.md`](docs/operations/deployment-runbook.md).

## Model routing

Actual provider/model identity comes from EO resolved binding. Product docs are
not the executable router. `freshContext` is not M4. M3 does not automatically
escalate to M4. Maximum automatic root-cause escalation is one M2→M3.
See [`docs/testing/agent-model-routing.md`](docs/testing/agent-model-routing.md).

Use `.cursor/agents/codebase-explorer.md` for codebase exploration and
`.cursor/agents/test-explorer.md` for test discovery when delegation reduces
discovery cost. Use `.cursor/agents/requirements-evidence-collector.md` for
factual requirement evidence. Use `.cursor/skills/verify-requirements/SKILL.md`
for Product requirement completeness. Skills do not override scoped safety
rules or EO hard execution safety.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
