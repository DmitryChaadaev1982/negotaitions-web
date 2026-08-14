# NegotAItions Agent Router

NegotAItions is a Next.js App Router negotiation-training product with PostgreSQL
via Prisma, provider-backed room/media services, and post-session materials/AI
workflows. This file is deliberately a router, not a project history.

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

Read the relevant guide under `node_modules/next/dist/docs/` before changing
Next.js code; this repository uses a version with breaking changes.

## Universal guardrails

- **Git/worktrees:** verify the current branch and worktree before changing
  files. Never validate one worktree against another worktree's server. Do not
  commit, push, reset, or discard work without explicit user authorization.
- **Environment and production:** never print, commit, or modify secret env
  values. Use the named-variable and copy policy in
  [`docs/operations/deployment-runbook.md`](docs/operations/deployment-runbook.md).
  Production access, deploys, provider changes, and infrastructure actions
  require explicit authorization and the runbook.
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

## Testing and release safety

For code, configuration, test, or runtime behavior changes, run and report in
order: `npm run validate:fast`, `npm run validate:deploy`,
`npm run test:e2e:smoke`, and `npm run test:e2e:smoke:browser`. Docs-only and
audit-only work does not require these gates.

Use [`docs/testing/validation-checklist.md`](docs/testing/validation-checklist.md)
for mandatory gate commands and ordering, and
[`docs/testing/e2e-strategy.md`](docs/testing/e2e-strategy.md) for test
selection, E2E database isolation, and managed/live modes.
Use [`docs/testing/observer-test-execution-policy.md`](docs/testing/observer-test-execution-policy.md)
for the observer smoke/layout trigger matrix. Do not run overlapping managed
Playwright servers. Tunnel and live-provider suites are opt-in; the full
Playwright suite is manual/nightly unless requested.

Deployment work must follow
[`docs/operations/deployment-runbook.md`](docs/operations/deployment-runbook.md);
never infer production commands from historical stage notes.

## Delegation and model economy

- **Luna:** repository exploration, test discovery, mechanical work, and
  deterministic validation/test execution.
- **Terra:** default production implementation and normal architecture or
  root-cause work.
- **Sol / stronger expensive review:** only for a justified high-risk
  privacy, authorization, database, or deployment review.

Use `.cursor/agents/codebase-explorer.md` for codebase exploration and
`.cursor/agents/test-explorer.md` for test discovery when delegation reduces
discovery cost. Use `.cursor/agents/validation-runner.md` for parent-delegated
deterministic validation/test execution; keep raw validation logs in that
subagent context whenever practical. Terra remains responsible for
implementation, failure-remediation decisions, and the final engineering
report. The validation-runner workflow is the candidate underpinning for a
future `validate-wave` Skill after a successful real product wave.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
