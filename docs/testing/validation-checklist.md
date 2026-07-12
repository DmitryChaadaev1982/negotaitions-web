# Validation Checklist

Use this checklist for architecture/documentation-affecting changes and release readiness checks.

## Recommended Validation Commands

- `git status`
- `git diff --stat`
- `git diff --name-status`
- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:list` (inventory only)
- `npm run test:e2e:local:list` (deterministic local inventory)
- `npm run test:e2e:install` (explicit browser setup when needed)
- `npm run test:e2e:smoke` (curated deterministic Chromium subset)
- `npm run test:e2e:smoke:browser` (browser-first deterministic localhost smoke)
- `npm run test:e2e:tunnel:check` (reverse tunnel fail-fast preflight; read-only)
- `npm run test:e2e:tunnel:list` (inventory of `@requires-tunnel` tests)
- `npm run test:e2e:tunnel` (opt-in tunnel-only suite, excludes `@live-provider`)
- `npm run test:e2e:live:list` (inventory of `@live-provider` tests)
- `npm run test:e2e:live` (opt-in live-provider suite)
- `npm run test:e2e:full` (broad regression; manual/nightly until stabilized)

## Mandatory validation gates

For all non-audit, non-doc-only implementation phases, run and report:

- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

Rules:

- All four commands are mandatory unless the task is strictly audit-only or docs-only.
- If any gate cannot run, document the exact blocker and do not silently skip it.
- Do not hide failures with retries or skipped tests.
- `npm run test:e2e:full` is manual/nightly and is not mandatory unless explicitly requested.
- Tunnel/live-provider suites are opt-in and not part of default gates.
- Changes are not merge-ready until applicable gates pass or a user-approved exception is documented.

## Validation Gate Intent

- `validate:fast` is the routine local gate:
  - lint
  - `prisma validate`
  - `prisma generate`
  - unit tests
  - Playwright listing only (`--list`)
- `validate:deploy` runs `validate:fast` and then production build.
- `test:e2e:smoke` runs critical browser/API smoke checks only (`@smoke`, Chromium).
- `test:e2e:smoke:browser` runs critical browser-first smoke checks only (`@browser-smoke`) under deterministic local config.
- `test:e2e:full` is environment-sensitive and DB-mutating; it is not currently the default deploy gate.
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

## Architecture Documentation Guardrails

- Check `docs/architecture/code-map.md` before code changes.
- Update mapped architecture doc when changing mapped code area.
- Update `docs/architecture/README.md` and `code-map.md` for new major flows.

## Historical Report Handling

- Preserve historical reports by moving to archive, not deleting.
- Keep new canonical summaries in `docs/architecture`, `docs/operations`, or `docs/testing`.

## Source Notes

- `tests/e2e/**`
- `docs/testing/yandex-poc-smoke-regression-plan.md`
