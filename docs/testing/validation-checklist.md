# Validation Checklist

Use this checklist for architecture/documentation-affecting changes and release readiness checks.

## Recommended Validation Commands

- `git status`
- `git diff --stat`
- `git diff --name-status`
- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:list` (inventory only)
- `npm run test:e2e:install` (explicit browser setup when needed)
- `npm run test:e2e:smoke` (curated deterministic Chromium subset)
- `npm run test:e2e:full` (broad regression; manual/nightly until stabilized)

## Validation Gate Intent

- `validate:fast` is the routine local gate:
  - lint
  - `prisma validate`
  - `prisma generate`
  - unit tests
  - Playwright listing only (`--list`)
- `validate:deploy` runs `validate:fast` and then production build.
- `test:e2e:smoke` runs critical browser/API smoke checks only (`@smoke`, Chromium).
- `test:e2e:full` is environment-sensitive and DB-mutating; it is not currently the default deploy gate.
- `test:all` remains a broad legacy/full-suite command for compatibility, not the recommended routine deploy gate.

## Smoke Suite Guardrails (Phase 2)

- Chromium-only, curated tests tagged with `@smoke`.
- No reverse tunnel requirement.
- No real external providers (Voximplant/Yandex live flows excluded).
- DB-mutating tests are allowed; use a dedicated non-production test DB.
- Smoke is deploy-adjacent validation only after repeat-run stability is demonstrated.
- Tunnel-specific classification/preflight is deferred to Phase 3.

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
