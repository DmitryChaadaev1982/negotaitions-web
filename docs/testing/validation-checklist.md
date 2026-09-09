# Validation Checklist

This is the Product validation **command catalog**. It describes what
NegotAItions-owned commands check, their prerequisites, and which ones are
canonical release gates.

It is not a lifecycle sequencer. Native Agent may run focused tests during
implementation. EO owns formal validation timing after UAT and release
validation. Do not invent another L1–L4 ladder.

How humans think about change impact and eval classes is in
[`engineering-workflow.md`](./engineering-workflow.md). That document is
descriptive. EO is the executable authority.

## Ownership split

| Owner | Role |
| --- | --- |
| Native Agent | Focused/bounded diagnostic checks while implementing. |
| Product | Command implementations listed below. |
| EO | When canonical/release gates run for a durable CU after UAT. |

Canonical Product gates declared in `.eo/repository-profile.json`:

- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

`validate:deploy` is complete standalone deploy validation
(`validate:fast` then `validate:build`). Do not redefine it as build-only.

## What each Product command checks

### `validate:fast`

Routine cheap project checkpoint (not universally exhaustive):

- native-dialog guard (`check:native-dialogs`)
- lint
- `prisma validate`
- `prisma generate` (materializes gitignored `app/generated/prisma`)
- unit tests
- Playwright listing only (`--list`; inventory does not start a browser)

The unit glob covers deterministic `lib/**`, `app/**`, `components/**`, and
`scripts/__tests__/**`. Canonical `test:unit` sets `--test-timeout=180000`
(180 seconds per test). The validation-runner `test:unit` watchdog is 10
minutes for the whole unit process. Playwright specs, live/provider suites,
and tests that require a real database to do more than skip remain outside
this gate.

PostgreSQL coordination tests (`lib/ai/analysis-operation.pg.test.ts`,
`lib/session-lifecycle-finalizer.pg.test.ts`) must not wait forever for a
barrier that can no longer occur. A waiter is released by the expected lock
signal, by the upstream mutation/finalization rejection, or by a bounded
coordination timeout. Opened `pg.Client` / `pg.Pool` instances are closed in
an outer `try/finally` via `Promise.allSettled`. Test-only connection timeout
is 5 seconds; setup/cleanup may set `statement_timeout≈10s`; intentional
`FOR UPDATE` blockers must not use a tiny `lock_timeout`. See
`EVAL-WF-PG-LOCK-TEST-NO-HANG`.

### `validate:build`

Production `next build` only. Use after a known-green `validate:fast` when a
build proof is required.

### `validate:deploy`

Standalone complete deploy validation: `validate:fast` then `validate:build`
under one lock.

### `test:e2e:smoke`

Critical browser/API smoke (`@smoke`, Chromium). Requires Playwright browsers
resolved via EO overlay `PLAYWRIGHT_BROWSERS_PATH` for EO-run canonical
gates. Do not overlap another managed Playwright server.

### `test:e2e:smoke:browser`

Critical browser-first smoke (`@browser-smoke`) under deterministic local
config. Same Playwright overlay requirement. Localhost port `3100` is shared.

### Other useful Product commands

- `git status` / `git diff --stat` / `git diff --name-status` / `git diff --check`
- `npm run eval:registry:check`
- `npm run check:native-dialogs`
- `npm run test:e2e:list` / `test:e2e:local:list` (inventory only)
- `npm run test:e2e:install` (explicit browser setup when needed)
- `npm run prisma:generate` (guarded generate; also inside `validate:fast`)
- `npm run test:e2e:db:check` (read-only E2E database preflight)
- `npm run test:e2e:tunnel:check` (reverse tunnel fail-fast; read-only)
- `npm run test:e2e:tunnel:list` / `test:e2e:tunnel` (opt-in)
- `npm run test:e2e:live:list` / `test:e2e:live` (opt-in)
- `npm run test:e2e:full` (manual/nightly; not a default deploy gate)
- Focused examples:
  - `node --import ./scripts/test-unit-env-bootstrap.mjs --import tsx --test lib/env.ts`
  - `node --import tsx --test lib/services/admin-env-display.test.ts`

`test:all` is a broad legacy/full-suite command, not the recommended routine
deploy gate.

## Canonical execution notes (agents)

Do **not** delegate `validate:fast` / `validate:build` / `validate:deploy` to
a Cursor subagent. Cursor’s subagent-return path has repeatedly stayed on
“Waiting for subagent” after `scripts/validation-runner.mjs` already finished.
The kernel is healthy.

If the primary agent cannot reliably execute or observe a long canonical
command: **STOP** and give the operator this PowerShell recipe. Do not
create a Validation Runner subagent to hold the command.

```powershell
Set-Location '<worktree>'
New-Item -ItemType Directory -Force -Path .agent\validation-logs | Out-Null
$gate = 'validate:deploy'   # or validate:fast / validate:build
$log = Join-Path (Get-Location) (".agent\validation-logs\{0}-{1}.log" -f ($gate -replace ':','-'), (Get-Date -Format 'yyyyMMdd-HHmmss'))
cmd.exe /c "npm run $gate > `"$log`" 2>&1"
$exit = $LASTEXITCODE
Write-Host "EXIT=$exit"
Write-Host "LOG=$log"
Get-Content $log -Tail 60
```

Canonical validation is **PASS** only with reliable evidence (`OUTCOME:
VALIDATION_OK` and native exit `0`). Do not infer PASS because locks
disappeared. Never `taskkill /IM node.exe`.

Public `validate:*` commands route through `scripts/validation-runner.mjs`.
That kernel acquires `.agent/validation.lock`, bounds children, and on
Windows uses `file://` URLs for `--import` specifiers. Canonical
`prisma:generate` uses `scripts/prisma-generate-guarded.mjs` and
`.agent/prisma-generate.lock`. Installed Prisma CLI is 7.10.0 and generate
passes `--no-hints`.

## Smoke / browser / tunnel guardrails

Smoke: Chromium-only, `@smoke`, no reverse tunnel, no real external
providers. DB-mutating tests need a dedicated non-production test DB.

Browser smoke: localhost `http://127.0.0.1:3100`, Playwright-managed
`webServer`, mock provider defaults, no reverse tunnel.

Tunnel/live: `@requires-tunnel` and `@live-provider` are opt-in.
`test:e2e:tunnel:check` never starts SSH, never kills processes, and never
mutates remote. Typical tunnel env uses `APP_URL` /
`EMAIL_CANONICAL_BASE_URL` for `https://local.negotaitions.ru`.

Observer smoke vs layout: see
[Observer test execution policy](./observer-test-execution-policy.md).

## Playwright path diagnostics (PowerShell)

Package install and browser install are different. Routine test commands
should not intentionally run browser install. The machine-local EO overlay
supplies `PLAYWRIGHT_BROWSERS_PATH`; do not commit that path.

```powershell
Get-ChildItem Env:PLAYWRIGHT* -ErrorAction SilentlyContinue
Test-Path "$env:LOCALAPPDATA\ms-playwright"
```

## Fixture guardrails

- DB mutation safety must run through `tests/e2e/helpers/db.ts` and
  `tests/e2e/helpers/e2e-database.ts`.
- `E2E_DATABASE_URL` is mandatory for Playwright tests; do not fall back to
  `DATABASE_URL` or `TEST_DATABASE_URL`.
- Development database: `DATABASE_URL` -> `localhost:5432/negotiations`.
- Automated PostgreSQL/E2E: `E2E_DATABASE_URL` ->
  `localhost:5433/negotiations_e2e`.
- Playwright overrides `DATABASE_URL` only for its managed Next.js process.
- Cleanup must be ownership-scoped to the current run namespace.

## Functional / docs guardrails

- No behavior changes unless explicitly intended.
- No Prisma schema/migration edits for docs-only work.
- No env value changes committed.
- No server/nginx/systemd edits in docs-only scope.
- Check `docs/architecture/code-map.md` before code changes.
- Preserve historical reports by moving to archive, not deleting.
