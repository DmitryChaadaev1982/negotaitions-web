<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Architecture documentation rule

- Before changing any feature area, inspect `docs/architecture/code-map.md`.
- If changed files map to an architecture doc, update that doc in the same change.
- If no doc change is needed, explain why in final response.
- For new feature areas, create or update a corresponding architecture doc.
- Do not add new major flows without updating `docs/architecture/README.md` and `docs/architecture/code-map.md`.

## Mandatory validation gates

For implementation changes (code/config/tests/runtime), run and report:

- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

Rules:

- All four gates are mandatory unless the task is strictly audit-only or docs-only.
- If any gate cannot run, report the blocker explicitly; do not silently skip.
- `npm run test:e2e:full` is manual/nightly unless explicitly requested.
- Tunnel/live-provider suites are opt-in (`test:e2e:tunnel*`, `test:e2e:live*`) and are not default gates.

## Observer suite execution policy

Authoritative trigger matrix, suite scope, durations and limitations:
`docs/testing/observer-test-execution-policy.md`. Update that document rather
than duplicating its rules here.

- Do not run the full observer layout matrix (`npm run test:e2e:observer:layout`)
  unless the change can affect Session room screen structure or geometry:
  `components/voximplant-video-layout.tsx`, observer rail/tile dimensions,
  participant stage geometry, room grid/flex layout, room CSS affecting width,
  height, overflow or scroll, `lib/voximplant/room-layout-model.ts`, room
  responsive breakpoints, rail scrolling controls, roster rendering structure
  that changes tile count or geometry, or the room shell dimensions.
- Ordinary UI and functional changes must never trigger it automatically. A
  shared generic component being imported by room code is not a trigger.
- Use `npm run test:e2e:observer:smoke` for observer membership, explicit leave,
  reconnect, provider ownership/lifecycle, media-state representation, Session
  lifecycle and room navigation changes.
- If shared provider lifecycle code changes, run observer smoke only, unless
  room geometry also changed.
- Dashboard, Event lobby layout outside the Session room, notes, speaker
  mapping, transcription, AI analysis, materials, administrative pages and
  documentation require neither suite unless a shared room runtime file
  actually changed.
- Run the full layout suite once before deploying a release that contains
  Session room layout changes since the last successful full run.
- `npm run test:stage310` includes observer smoke and excludes the full layout
  matrix via `--grep-invert @observer-layout`.

## Heavy-gate repetition policy

- Run heavy suites once, after runtime code has stabilized.
- Do not repeat a successful heavy command (`validate:deploy`, smoke suites,
  `test:stage310`, full observer layout) for a follow-up change that only edits
  tests or documentation. Rerun only the affected tests.
- Record the runtime SHA whose heavy gates passed separately from the final
  test/docs SHA, and state both in the completion report.
- Use one managed server lifecycle at a time. Never run a standalone
  `npm run dev` and managed Playwright at the same time; managed mode requires
  port 3000 to be free and binds port 3100 itself.
- Do not edit files in the working tree while a managed Playwright run is in
  progress. The managed Next.js dev server watches the tree, and a recompile
  triggered mid-run makes API routes transiently return 404, which surfaces as
  unrelated room-entry failures.
- Investigate before increasing a timeout. A test that exceeds the 60 s
  repository timeout is usually doing too much in one test; split it into
  independent cases instead of raising the limit.

## Stage Tests Phase 4 fixture policy

- Execute mandatory gates sequentially. `test:e2e:smoke:browser` binds localhost port `3100`, so overlapping runs are not supported.
- DB-mutating e2e tests must use test-only DB safety guards from `tests/e2e/helpers/db.ts` and `tests/e2e/helpers/e2e-database.ts`.
- `E2E_DATABASE_URL` is mandatory for Playwright tests and dedicated E2E helpers.
- Development database: `DATABASE_URL` -> `localhost:5432/negotiations`.
- Automated E2E database: `E2E_DATABASE_URL` -> `localhost:5433/negotiations_e2e`.
- Playwright-managed `webServer` sets `DATABASE_URL` to the resolved `E2E_DATABASE_URL`; manual `npm run dev` remains on the development database.
- Run read-only E2E database preflight with `npm run test:e2e:db:check` before browser suites.
- Docker E2E service: `postgres_e2e` (container `negotiations_postgres_e2e`, exposed port `5433`).
- E2E fixtures must be run-scoped through `E2E_RUN_ID` (or auto-generated run IDs) using helper functions (`getE2eRunId`, `e2eName`, `e2eEmail`, `e2eId`).
- Cleanup must be ownership-based: only rows from the current run namespace and current run-owned users may be deleted.
- New tests must not introduce broad cleanup patterns like `LIKE '%E2E%'` across shared data.
- Legacy broad cleanup remains technical debt and should be migrated gradually; do not expand it.
- Keep `workers=1` while DB fixture ownership remains shared across suites.
- `test:e2e:full`, tunnel, and live-provider suites remain opt-in/manual for routine validation.

## Agent execution workflow (local tooling)

Use this deterministic sequence for fast local iteration:

1. `npm run agent:preflight`
2. Choose one Playwright mode once:
   - Managed: `npm run test:e2e:focused:managed -- tests/e2e/event-completion.spec.ts --project=chromium`
   - Live: `npm run test:e2e:focused:live -- tests/e2e/session-finish-canonical.spec.ts --project=chromium`
3. During implementation, run focused lint/unit/API checks only for changed scope.
4. Run focused Stage 3.10 suite:
   - Auto mode from preflight snapshot: `npm run test:stage310:focused`
   - Explicit managed mode: `npm run test:stage310:focused:managed`
   - Explicit live mode: `npm run test:stage310:focused:live`
5. Run a manual canary.
6. Run full mandatory gate once before commit/deploy.
7. Record a local green baseline:
   - `npm run agent:baseline:record -- --confirm-green --command "npm run validate:fast" --note "Local pre-commit gate"`

PowerShell examples:

- `npm run agent:baseline:show`
- `npm run agent:baseline:check`
- `npm run agent:baseline:clear`

Operational guardrails:

- Never guess Prisma columns; inspect Prisma schema and generated client types first.
- Inspect schema before writing SQL.
- Do not rerun unchanged failures repeatedly; fix or classify first.
- Distinguish environment failures from code failures before re-running tests.
- Do not repeat full gates for docs-only, style-only, label-only, or equivalent narrow changes when risk is already classified.
- Local baseline files are ignored and are execution records, not cryptographic proof.
- Full Stage 3.10 suite remains the final gate.
- LIVE mode safety: localhost:3000 is eligible only when the healthy server belongs to the exact current worktree.
- A healthy server from a sibling worktree in the same repository is a conflict, not LIVE.
- Do not validate one worktree against another worktree's running app instance.
- Baseline recommendation is deliberately conservative and does not replace engineering judgment.
- `components/**/*.tsx` changes are treated as application logic by default and normally require the full final gate.
- Copy/docs/style/test-only changes may use focused validation when classification remains low risk.
