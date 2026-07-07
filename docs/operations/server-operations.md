# Server Operations

## Runtime Topology (Current)

- App host: Yandex VM deployment model.
- Service: `negotaitions-poc`.
- Reverse proxy: nginx to Node.js app process.
- Canonical app path: `/var/www/negotaitions/app-git`.
- Runtime path: `/var/www/negotaitions/app` (symlink).

## Domain Topology

- `negotaitions.ru`
- `app.negotaitions.ru`
- `local.negotaitions.ru` (local/tunnel test context)

## Operational Boundaries

- Do not store runtime secrets in repo.
- Keep `.env.production` and equivalent runtime config outside git.
- Keep generated server artifacts in server-local or external artifact storage, not repository root.

## Daily/Pre-Release Checks

- Service state and restart behavior.
- Storage and transcription provider connectivity.
- Recording webhook path reachability and signature validation.
- Admin diagnostics endpoint health.

## Notes On Scale Behavior

- Current connection-lease logic has in-memory characteristics; validate single-instance assumptions before scaling runtime replicas.

## Source Notes

- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/operations/project-hygiene.md`
