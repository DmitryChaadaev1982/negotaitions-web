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
- Host-local `/var/www/negotaitions-secure-backups` is the secure backup root
  for non-secret deployment metadata and, at most, a temporary plaintext env
  copy during an unvalidated env change. See
  `docs/operations/deployment-runbook.md`.
- Recording debug is fail-closed in production: `isRecordingDebugEnabled()`
  always returns false when `NODE_ENV=production`, so neither
  `RECORDING_DEBUG_PANEL=true` nor `NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true`
  can expose `/api/debug/recording/[sessionId]` (including smoke
  start/stop). Keep `RECORDING_DEBUG_PANEL=false` in the application
  EnvironmentFile (`/var/www/negotaitions/app/.env.production`) as
  defense in depth. The endpoint is for controlled non-production
  diagnostics only.
- Keep nginx access logging enabled, but never persist query strings, raw
  token-bearing pathname segments, `$request`, `$request_uri`, or Referer.
  Use `deploy/nginx/sanitized-access-log.conf` from the nginx `http`
  context. Do not change logrotate retention when rotating this format.

## Nginx Access-Log Sanitization

Effective production files:

- `/etc/nginx/snippets/negotaitions-sanitized-access-log.conf`
  (`map` + `log_format negotaitions_sanitized`; http context only)
- `/etc/nginx/nginx.conf` includes that snippet and writes
  `/var/log/nginx/access.log` with the sanitized format
- `/etc/nginx/sites-available/negotaitions-local-dev` uses the same
  format for `/var/log/nginx/negotaitions-local-dev.access.log`

Pathname families redacted: `/join/:joinToken` and
`/events/join/:publicJoinCode`. Query-borne secrets are dropped because
the logged path is query-free `$uri` after sanitization. Existing
`/etc/logrotate.d/nginx` retention stays unchanged.

## Daily/Pre-Release Checks

- Service state and restart behavior.
- Storage and transcription provider connectivity.
- Recording webhook path reachability and signature validation.
- Admin diagnostics endpoint health.

## Transcript Enhancement Flags (Stage 3.9F)

- Keep SpeechKit runtime parameters unchanged (`general:rc`, `ru-RU`, normalization,
  literature text, speaker labeling).
- Automatic enhancement is controlled by:
  - `YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED`
  - `TRANSCRIPT_ENHANCEMENT_AUTO_RUN`
- Safe rollout order:
  1. Deploy with `TRANSCRIPT_ENHANCEMENT_AUTO_RUN=false`.
  2. Verify transcription health and materials/status responses.
  3. Enable `TRANSCRIPT_ENHANCEMENT_AUTO_RUN=true` for canary.
  4. Roll back to `false` on instability.

### Operator-Safe Env Update Commands

Authoritative production policy is in `docs/operations/deployment-runbook.md`
(**Production env backup retention**). `CODE ROLLBACK != ENV ROLLBACK`.

Any plaintext env copy is **temporary**, tied to one unvalidated change,
restricted (`700` parent / `600` file), and deleted immediately after
successful validation. Hard cap: `TEMP_ENV_BACKUP_RETENTION_MAX=24h`. Do not
accumulate generations. `$HOME/.env-backups` or `$HOME/negotiations-env-backups`
may exist on a host, but must not become a permanent plaintext secret archive.

Local PowerShell (developer `.env` / `.env.local`; `.env.local` overrides `.env`
when present). Keep the copy only until local restart/health validation passes,
then delete it:

```powershell
$repo = "C:\Projects\Negotiations AI\negotiations-web"
$changeId = "transcript-enhancement-autorun-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$backupDir = Join-Path $HOME "negotiations-env-backups\temp-env\$changeId"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Copy-Item (Join-Path $repo ".env") (Join-Path $backupDir ".env")
if (Test-Path (Join-Path $repo ".env.local")) {
  Copy-Item (Join-Path $repo ".env.local") (Join-Path $backupDir ".env.local")
}

# Remove duplicate AUTO_RUN entries, then set one effective value.
$envPath = Join-Path $repo ".env"
$lines = Get-Content $envPath | Where-Object { $_ -notmatch '^TRANSCRIPT_ENHANCEMENT_AUTO_RUN=' }
$lines + 'TRANSCRIPT_ENHANCEMENT_AUTO_RUN=false' | Set-Content $envPath

$envLocalPath = Join-Path $repo ".env.local"
if (Test-Path $envLocalPath) {
  $localLines = Get-Content $envLocalPath | Where-Object { $_ -notmatch '^TRANSCRIPT_ENHANCEMENT_AUTO_RUN=' }
  $localLines | Set-Content $envLocalPath
}

# After local validation PASS: Remove-Item -Recurse -Force $backupDir
# Copies older than 24h are security debt; inventory then delete.
```

Server bash (authoritative `.env.production`). Create the copy only if a
pre-change rollback artifact is genuinely required. Do not write
`.env.production.bak-*` next to the live app env:

```bash
set -euo pipefail
ENV_FILE="/var/www/negotaitions/app/.env.production"
SECURE_BACKUP_ROOT="/var/www/negotaitions-secure-backups"
CHANGE_ID="transcript-enhancement-autorun-$(date +%Y%m%d-%H%M%S)"
TEMP_ENV_DIR="$SECURE_BACKUP_ROOT/temp-env/$CHANGE_ID"

mkdir -p "$TEMP_ENV_DIR"
chmod 700 "$SECURE_BACKUP_ROOT" "$SECURE_BACKUP_ROOT/temp-env" "$TEMP_ENV_DIR"
cp "$ENV_FILE" "$TEMP_ENV_DIR/app.env.production"
chmod 600 "$TEMP_ENV_DIR/app.env.production"

# Check duplicate key count without printing secret values.
grep -c '^TRANSCRIPT_ENHANCEMENT_AUTO_RUN=' "$ENV_FILE"

# Keep one effective AUTO_RUN definition (start with false).
tmp="$(mktemp)"
grep -v '^TRANSCRIPT_ENHANCEMENT_AUTO_RUN=' "$ENV_FILE" > "$tmp"
printf '\nTRANSCRIPT_ENHANCEMENT_AUTO_RUN=false\n' >> "$tmp"
mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# After env parse + service start + relevant connectivity + public health PASS:
#   rm -f "$TEMP_ENV_DIR/app.env.production"
#   rmdir "$TEMP_ENV_DIR" 2>/dev/null || true
# TEMP_ENV_BACKUP_RETENTION_MAX=24h. Older copies are security debt;
# inventory before deletion if the role is unclear. Do not accumulate.
```

## Notes On Scale Behavior

- Current connection-lease logic has in-memory characteristics; validate single-instance assumptions before scaling runtime replicas.

## Source Notes

- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/operations/project-hygiene.md`
- `docs/operations/deployment-runbook.md`
