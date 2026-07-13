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

Local PowerShell (`.env.local` can be missing; it overrides `.env` when present):

```powershell
$repo = "C:\Projects\Negotiations AI\negotiations-web"
$backupDir = Join-Path $HOME "negotiations-env-backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item (Join-Path $repo ".env") (Join-Path $backupDir ".env.$ts.bak")
if (Test-Path (Join-Path $repo ".env.local")) {
  Copy-Item (Join-Path $repo ".env.local") (Join-Path $backupDir ".env.local.$ts.bak")
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
```

Server bash (`.env.production`):

```bash
set -euo pipefail
ENV_FILE="/var/www/negotaitions/app/.env.production"
BACKUP_DIR="$HOME/.env-backups"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp "$ENV_FILE" "$BACKUP_DIR/.env.production.$(date +%Y%m%d-%H%M%S).bak"
chmod 600 "$BACKUP_DIR"/.env.production.*.bak

# Check duplicate key count without printing secret values.
grep -c '^TRANSCRIPT_ENHANCEMENT_AUTO_RUN=' "$ENV_FILE"

# Keep one effective AUTO_RUN definition (start with false).
tmp="$(mktemp)"
grep -v '^TRANSCRIPT_ENHANCEMENT_AUTO_RUN=' "$ENV_FILE" > "$tmp"
printf '\nTRANSCRIPT_ENHANCEMENT_AUTO_RUN=false\n' >> "$tmp"
mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"
```

## Notes On Scale Behavior

- Current connection-lease logic has in-memory characteristics; validate single-instance assumptions before scaling runtime replicas.

## Source Notes

- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/operations/project-hygiene.md`
