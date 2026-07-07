# Validation Checklist

Use this checklist for architecture/documentation-affecting changes and release readiness checks.

## Required Commands

- `git status`
- `git diff --stat`
- `git diff --name-status`
- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npm run test:unit`

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
