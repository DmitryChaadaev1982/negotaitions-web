# Validation Checklist

This is the validation **command catalog** and **L1–L4 mapping** for meaningful
engineering changes and for release readiness where those gates apply.

How to decompose work, select eval classes, write a Validation Plan before
implementation, and execute it afterward is defined in
[`engineering-workflow.md`](./engineering-workflow.md). Do not treat every
small change or every docs-only commit as an automatic product L4 run.

## Validation ladder

Select a level for the **current checkpoint**. Lower levels delay broad
validation; they never waive required final/deploy gates for code that
repository policy still gates.

| Level | Purpose | Typical evidence |
| --- | --- | --- |
| **L1 — Focused** | Fast proof for the current Change Unit. | Targeted unit test, single static guard, single component/helper/domain test. |
| **L2 — Relevant / coupled** | Completed coupled cluster, High-Risk Kernel, or important transition group. | Relevant integration group, Lab subset, focused E2E, historical cohort tests, migration verifier. |
| **L3 — Checkpoint** | Meaningful accumulated engineering checkpoint. | Existing `npm run validate:fast`, **plus** the focused/relevant evals selected for the changed area. |
| **L4 — Final / deploy-level** | Final code/config/test/runtime package boundary where repository policy requires broad gates, **or** a material high-risk / deploy-readiness boundary. Not every commit. | Existing `validate:fast` then `validate:build` (standalone `validate:deploy` remains fast + build) and the required smoke/browser/deploy gates below. |

L3 accuracy: `validate:fast` is the current cheap project checkpoint gate
(native-dialog guard, lint, Prisma validate/generate, unit tests, Playwright
`--list`). It is **not** universally exhaustive. The unit glob covers
deterministic `lib/**`, `app/**`, `components/**`, and `scripts/__tests__/**`
tests. Playwright specs, live/provider suites, and tests that require a real
database to do more than skip remain outside this gate. Always run the
focused/relevant evals for the changed area in addition to whatever L3 covers.

### Safety rule

A lower level may be selected only because the **current checkpoint** does not
yet justify broad validation. It is not permission to skip required FINAL
validation before commit/deploy for code that requires it.

For high-risk areas (DB, auth, privacy, access, publication, concurrency,
migration, deployment), preserve existing scoped safety requirements in
`.cursor/rules/` and the mapped architecture/operations documents. The ladder
does not relax those rules.

Do not interpret “this Change Unit is LOW risk” as “operator may skip L4 on
the later code/config/test/runtime package of that change.”

The actual implementation/diff may **raise** the planned level or add evals.
It must **not** silently lower an approved Validation Plan because the diff
looks small.

### When L4 should not run yet

Staged validation is allowed. Examples:

- Trivial docs-only / audit-only change: no product suite for ritual. Docs-only
  commits do not mechanically run product L4.
- Presentation/UI change awaiting visual acceptance: focused test/render
  first; operator acceptance before expensive broad rerun.
- Several small related Change Units: L1 per unit, L2/L3 after an accumulated
  checkpoint, L4 at the meaningful final boundary.

This is an optimization of **when** broad validation runs, not an elimination
of final gates.

### Validation evidence

The stage/change plan should record:

- required eval classes / later eval IDs
- validation level required for the current checkpoint
- commands/evidence actually run
- unresolved findings

Use the checkpoint evidence template in
[`engineering-workflow.md`](./engineering-workflow.md) at STOP/review
boundaries. Do not add telemetry, dashboards, or a checkpoint platform.

## Recommended Validation Commands

- `git status`
- `git diff --stat`
- `git diff --name-status`
- `git diff --check`
- `npm run eval:registry:check` (Eval Registry structural validator)
- `npm run check:native-dialogs` (static production-source native-dialog guard)
- `npm run validate:fast`
- `npm run validate:build` (production build only; use after a known-green `validate:fast`)
- `npm run validate:deploy` (standalone complete deploy validation: fast + build)
- `npm run test:e2e:list` (inventory only)
- `npm run test:e2e:local:list` (deterministic local inventory)
- `npm run test:e2e:install` (explicit browser setup when needed)
- `npm run test:e2e:smoke` (curated deterministic Chromium subset)
- `npm run test:e2e:smoke:browser` (browser-first deterministic localhost smoke)
- `npm run test:stage313c` (account-security email unit and managed browser flow)
- `npm run test:stage313c:proxy` (trusted-proxy unit + managed browser/API checks)
- `npm run test:stage313c:email-journal` (journal unit + managed browser/API checks)
- `npm run verify:stage313c:proxy`
- `npm run verify:stage313c:email-journal`
- `npm run test:stage313c:provider-events` (provider-event unit, PostgreSQL
  advisory-lock, and DB-backed verifier checks against `E2E_DATABASE_URL`)
- `node --import tsx --test lib/services/yandex-transcript-enhancement.test.ts` (targeted chunked enhancement unit coverage)
- `node --import tsx --test lib/services/transcript-enhancement-persistence.test.ts` (targeted enhancement/ingestion persistence safety)
- `node --import tsx --test lib/env.transcript-enhancement.test.ts` (transcript enhancement env parsing, including output mode)
- `node --import tsx --test lib/services/transcript-enhancement-orchestration.test.ts` (idempotency identity hashing invariants)
- `node --import tsx --test lib/services/admin-env-display.test.ts` (admin env diagnostics include enhancement auto-run flag)
- `node --import tsx --test lib/transcription/transcript-timing.test.ts` (UI-only transcript timestamp/duration readability formatter and grouped-turn ordering)
- `node --import tsx --test lib/transcription/mapping-ui-presentation.test.ts` (speaker-mapping reason-priority and status-copy presentation rules)
- `npm run test:e2e:db:check` (read-only E2E database preflight)
- `npm run test:e2e:tunnel:check` (reverse tunnel fail-fast preflight; read-only)
- `npm run test:e2e:tunnel:list` (inventory of `@requires-tunnel` tests)
- `npm run test:e2e:tunnel` (opt-in tunnel-only suite, excludes `@live-provider`)
- `npm run test:e2e:live:list` (inventory of `@live-provider` tests)
- `npm run test:e2e:live` (opt-in live-provider suite)
- `npm run test:e2e:full` (broad regression; manual/nightly until stabilized)

## L4 / final validation gates

L4 is a **final CODE / CONFIGURATION / TEST / RUNTIME package** boundary where
existing repository policy requires broad final gates, **or** a material
high-risk boundary, **or** deploy readiness.

It is **not** every commit. Docs-only and audit-only changes use applicable
documentation/focused evidence. Presentation/UI work can reach operator visual
acceptance before expensive L4. Code/config/test/runtime changes still receive
applicable L4 gates at their final package/deploy boundary.

When L4 applies, these four commands remain that boundary:

- `npm run validate:fast`
- `npm run validate:build`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

`npm run validate:deploy` remains the complete standalone deploy validation
(`validate:fast` then `validate:build`). Do not redefine it as build-only.

Rules:

- Intermediate checkpoints may stop at L1–L3 when the current approved
  Validation Plan does not yet justify L4.
- When L4 applies, all four commands are mandatory unless the task is
  strictly audit-only or docs-only.
- Docs-only and audit-only work still does not require these product gates.
- If any required gate cannot run, document the exact blocker and do not
  silently skip it.
- Do not hide failures with retries or skipped tests.
- `npm run test:e2e:full` is manual/nightly and is not mandatory unless
  explicitly requested.
- Tunnel/live-provider suites are opt-in and not part of default gates.
- Changes are not merge-ready until applicable L4 gates pass or a
  user-approved exception is documented.

Sequential requirement (when L4 runs):

- Run L4 gates in strict order: `validate:fast` -> `validate:build` ->
  `test:e2e:smoke` -> `test:e2e:smoke:browser`.
- Do not overlap browser smoke with other local Playwright runs because
  localhost port `3100` is shared.

## Validation Gate Intent

- `validate:fast` is the routine L3 checkpoint gate (subject to the coverage
  note in the ladder above):
  - native-dialog guard (`check:native-dialogs`)
  - lint
  - `prisma validate`
  - `prisma generate`
  - unit tests
  - Playwright listing only (`--list`; inventory does not start a browser)
- `validate:build` runs the production build only. Use it as the L4 build
  proof after a known-green `validate:fast`.
- `validate:deploy` remains complete standalone deploy validation:
  `validate:fast` and then `validate:build`.
- `test:e2e:smoke` runs critical browser/API smoke checks only (`@smoke`, Chromium).
- `test:e2e:smoke:browser` runs critical browser-first smoke checks only (`@browser-smoke`) under deterministic local config.
- `test:e2e:observer:smoke` is the routine observer regression suite and is also
  included in `test:stage310`.
- `test:e2e:observer:layout` is the full observer geometry matrix. It is opt-in
  and is excluded from every aggregate gate. Run it only when Session room
  structure or geometry can change, and once before deploying a release that
  contains such changes. Trigger matrix:
  [Observer test execution policy](./observer-test-execution-policy.md).
- `test:e2e:full` is environment-sensitive and DB-mutating; it is not currently the default deploy gate.
- `test:stage313c` uses the same managed Playwright mode and must not overlap
  another managed browser suite.
- Stage 3.13C provider-event PostgreSQL lock tests use the canonical
  `E2E_DATABASE_URL` database and inject `DATABASE_URL=E2E_DATABASE_URL` only
  into the test child process. They refuse the normal development database.
- `test:all` remains a broad legacy/full-suite command for compatibility, not the recommended routine deploy gate.

## Smoke Suite Guardrails (Phase 2)

- Chromium-only, curated tests tagged with `@smoke`.
- No reverse tunnel requirement.
- No real external providers (Voximplant/Yandex live flows excluded).
- DB-mutating tests are allowed; use a dedicated non-production test DB.
- Smoke is deploy-adjacent validation only after repeat-run stability is demonstrated.
- Tunnel-specific classification/preflight is deferred to Phase 3.

## Browser Smoke Guardrails (Phase 3A)

- Localhost routing only (`http://127.0.0.1:3100`).
- Playwright-managed local `webServer` (Next.js dev server).
- Mock provider defaults (`EXTERNAL_SERVICES_MODE=mock`, `RECORDING_MODE=mock`, `TRANSCRIPTION_MODE=mock`).
- No reverse tunnel requirement.
- No external HTTPS callback dependency.
- Local config is isolated from shell URL overrides for test routing.

## Tunnel and Live-provider Guardrails (Phase 3B)

- `@requires-tunnel` marks tests that genuinely require publicly reachable tunnel routing.
- `@live-provider` marks tests that are explicitly live-provider sensitive.
- Tunnel preflight (`test:e2e:tunnel:check`) never starts SSH, never kills processes, and never mutates remote state.
- If tunnel preflight fails, fix prerequisites manually before running tunnel-tagged suites.
- Live-provider suites may create external side effects/cost and require dedicated non-production credentials.
- Manual tunnel baseline:
  - `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=2 -R 127.0.0.1:3300:127.0.0.1:3000 deploy@172.29.172.1`
- Typical tunnel env:
  - `APP_URL=https://local.negotaitions.ru`
  - `BASE_URL=https://local.negotaitions.ru`
  - `NEXT_PUBLIC_APP_URL=https://local.negotaitions.ru`

## Playwright Browser Install Diagnostics (PowerShell)

Use these commands to inspect browser cache behavior in your shell:

```powershell
Get-ChildItem Env:PLAYWRIGHT* -ErrorAction SilentlyContinue
Test-Path "$env:LOCALAPPDATA\ms-playwright"
Get-ChildItem "$env:LOCALAPPDATA\ms-playwright" -ErrorAction SilentlyContinue
Test-Path "$env:PLAYWRIGHT_BROWSERS_PATH"
npx playwright install --dry-run chromium
```

Notes:

- Package install and browser install are different.
- Routine test commands should not intentionally run browser install.
- Do not enforce repository-level `PLAYWRIGHT_BROWSERS_PATH` overrides in Phase 1.

## Functional Guardrails

- No behavior changes unless explicitly intended.
- No Prisma schema/migration edits for docs-only work.
- No env value changes committed.
- No server/nginx/systemd edits in docs-only scope.

## Fixture Guardrails (Phase 4)

- DB mutation safety must run through `tests/e2e/helpers/db.ts` and `tests/e2e/helpers/e2e-database.ts`.
- `E2E_DATABASE_URL` is mandatory for Playwright tests; do not fall back to `DATABASE_URL` or `TEST_DATABASE_URL`.
- Development database: `DATABASE_URL` -> `localhost:5432/negotiations`.
- Automated PostgreSQL, integration, lock, and E2E database:
  `E2E_DATABASE_URL` -> `localhost:5433/negotiations_e2e`.
- Playwright overrides `DATABASE_URL` only for its managed Next.js process; manual `npm run dev` stays on the development database.
- Run read-only preflight: `npm run test:e2e:db:check`.
- Docker E2E service: `postgres_e2e` (`negotiations_postgres_e2e`, port `5433`).
- Use run-scoped namespace helpers (`E2E_RUN_ID`, `getE2eRunId`, `e2eName`, `e2eEmail`, `e2eId`) for new fixture data.
- Cleanup must be ownership-scoped to current run namespace; new broad wildcard cleanup patterns are not allowed.

## Architecture Documentation Guardrails

- Check `docs/architecture/code-map.md` before code changes.
- Update mapped architecture doc when changing mapped code area.
- Update `docs/architecture/README.md` and `code-map.md` for new major flows.

## Historical Report Handling

- Preserve historical reports by moving to archive, not deleting.
- Keep new canonical summaries in `docs/architecture`, `docs/operations`, or `docs/testing`.

## Source Notes

- `tests/e2e/**`
- `docs/testing/engineering-workflow.md`
- `docs/testing/yandex-poc-smoke-regression-plan.md`
