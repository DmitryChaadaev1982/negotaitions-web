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
5. Before implementing a meaningful change, follow
   [`docs/testing/engineering-workflow.md`](docs/testing/engineering-workflow.md)
   for Change Impact Analysis, change-unit decomposition, high-risk kernel,
   eval selection, and a Validation Plan. Execute that plan after
   implementation using the validation ladder. Existing scoped rules remain
   authoritative for database, privacy, access, and deploy safety.

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

Select validation using the L1–L4 ladder in
[`docs/testing/validation-checklist.md`](docs/testing/validation-checklist.md).
Intermediate checkpoints may stop at L1–L3. That is timing, not a waiver.

L4 is a final **code / configuration / test / runtime** package or
deploy/high-risk boundary, not every commit. Docs-only and audit-only work
does not require product L4 suites. When L4 applies, run and report in order:
`npm run validate:fast`, `npm run validate:build`,
`npm run test:e2e:smoke`, and `npm run test:e2e:smoke:browser`.
`npm run validate:deploy` remains the complete standalone deploy validation
(`validate:fast` then `validate:build`). Low current
Change Unit risk does not authorize skipping those final gates later.
Canonical `validate:fast`, `validate:build`, and `validate:deploy` are
executed by the primary/orchestrating agent or, as fallback, by the operator
in PowerShell. Do not delegate those commands to a Cursor subagent. See
[`docs/testing/validation-checklist.md`](docs/testing/validation-checklist.md).

For **meaningful** work, capture approved product requirements in the existing
`docs/requirements/` manifest style, then produce the planning material needed
to drive Change Impact Analysis, Change Units, Eval Selection, and the
Validation Plan **before** implementation begins. Trivial typo or isolated
comment work does not require that bureaucracy. Run `verify-requirements` as
the completeness gate before `validate-wave`, expensive targeted high-risk
review, and packaging; it must not rely solely on the implementing model's
completion report. Run `validate-wave` separately as the correctness/regression
gate.

Use [`docs/testing/validation-checklist.md`](docs/testing/validation-checklist.md)
for ladder selection and L4 gate commands/ordering, and
[`docs/testing/e2e-strategy.md`](docs/testing/e2e-strategy.md) for test
selection, E2E database isolation, and managed/live modes.
Use [`docs/testing/observer-test-execution-policy.md`](docs/testing/observer-test-execution-policy.md)
for the observer smoke/layout trigger matrix. Do not run overlapping managed
Playwright servers. Tunnel and live-provider suites are opt-in; the full
Playwright suite is manual/nightly unless requested.

Deployment work must follow
[`docs/operations/deployment-runbook.md`](docs/operations/deployment-runbook.md);
never infer production commands from historical stage notes.

## Model routing (temporary)

Current model identities, effort modes, escalation, and return-to-OpenAI policy
are owned by
[`docs/testing/agent-model-routing.md`](docs/testing/agent-model-routing.md).
Do not maintain a second matrix here.

Durable role split only:

- The parent/orchestrator owns implementation, remediation, requirements
  judgment, architecture, the engineering report, and **direct execution** of
  canonical `validate:fast` / `validate:build` / `validate:deploy`.
- `.cursor/agents/validation-runner.md` is a focused-test evidence profile
  only. It must not run those canonical long gates. Do not move engineering
  judgment into that profile.
- Escalation models are not defaults; use them only when the routing document's
  evidence-based criteria are met.

Use `.cursor/agents/codebase-explorer.md` for codebase exploration and
`.cursor/agents/test-explorer.md` for test discovery when delegation reduces
discovery cost. Use `.cursor/agents/requirements-evidence-collector.md` for
factual requirement evidence. Use `.cursor/skills/validate-wave/SKILL.md` to
reconcile and execute the Validation Plan in the **primary** context. Use
`.cursor/skills/stage-start/SKILL.md` for a new stage/worktree
and `.cursor/skills/verify-requirements/SKILL.md` for independent completeness
verification. Skills reuse these subagent profiles and do not override scoped
safety rules or authoritative documents.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
