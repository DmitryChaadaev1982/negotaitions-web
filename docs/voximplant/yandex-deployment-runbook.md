# Yandex Deployment Runbook (Voximplant Stack)

> **CURRENT POLICY (supersedes env-backup and env-snapshot steps below).**
> This file is a historical Voximplant/Yandex stage runbook. For production
> env backup, retention, and rollback, follow
> `docs/operations/deployment-runbook.md`.
>
> - Do not create long-lived app-adjacent `.env.production.bak-*` files.
> - Do not restore a historical env snapshot merely because code/SHA is rolled
>   back (`CODE ROLLBACK != ENV ROLLBACK`).
> - Temporary plaintext env copies, if required at all, live only under
>   `/var/www/negotaitions-secure-backups`, mode `600`, and are deleted after
>   successful validation (hard cap 24 hours).
> - `.next-pre-deploy` snapshots are not a current durable rollback mechanism.

## 1) Local validation before deploy

```bash
git status --short
npm run lint
npm run build
npx prisma validate
npx prisma generate
```

Playwright baseline (DB required):

```powershell
$env:DATABASE_URL="postgresql://negotiations:negotiations_password@localhost:5432/negotiations_vox_test"
npx playwright test tests/e2e/voximplant-room-parity.spec.ts
npx playwright test tests/e2e/voximplant-event-lobby.spec.ts
```

If `3100` is busy:

```powershell
$env:PLAYWRIGHT_PORT="3000"
```

## 2) Build and runtime commands

```bash
npm ci
npx prisma generate
npm run build
npm run ops:runtime-permissions:apply
npm run ops:runtime-permissions:check
npm run start
```

## 3) Database migration commands

Current Stage 3: no new migration required.

Standard production procedure:

```bash
npx prisma migrate deploy
npx prisma generate
npm run ops:runtime-permissions:apply
npm run ops:runtime-permissions:check
```

## 4) Safe env template (no secrets)

```env
VIDEO_PROVIDER=voximplant
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<db>
NEXTAUTH_URL=https://<domain>
NEXTAUTH_SECRET=<secret>

VOXIMPLANT_ACCOUNT_NAME=<account>
VOXIMPLANT_APPLICATION_NAME=<app>
VOXIMPLANT_USER_DOMAIN=<app>.<account>.voximplant.com
VOXIMPLANT_SCENARIO_NAME=<scenario>
VOXIMPLANT_RULE_NAME=<rule>
VOXIMPLANT_API_KEY_PATH=/secure/path/to/voximplant-key.json

VOXIMPLANT_RECORDING_ENABLED=true
VOXIMPLANT_RECORDING_VIDEO=false
VOXIMPLANT_RECORDING_AUDIO_ONLY=true
VOXIMPLANT_RECORDING_AUDIO_MODE=lossless
VOXIMPLANT_RECORDING_PAUSE_ENABLED=false
VOXIMPLANT_RECORDING_WEBHOOK_SECRET=<secret>
VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL=https://<public-domain>

S3_ENDPOINT=https://storage.yandexcloud.net
S3_REGION=ru-central1
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>

TRANSCRIPTION_PROVIDER=yandex_speechkit
YANDEX_FOLDER_ID=<folder-id>
YANDEX_API_KEY=<api-key>
YANDEX_SPEECHKIT_MODEL=general:rc
YANDEX_SPEECHKIT_LANGUAGE=ru-RU
YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING=true
YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED=true
YANDEX_SPEECHKIT_LITERATURE_TEXT=true
YANDEX_SPEECHKIT_PROFANITY_FILTER=false
YANDEX_SPEECHKIT_PHONE_FORMATTING=false

YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED=true
TRANSCRIPT_ENHANCEMENT_AUTO_RUN=false
YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL=deepseek-v4-flash
YANDEX_TRANSCRIPT_ENHANCEMENT_MAX_OUTPUT_TOKENS=6000
TRANSCRIPT_ENHANCEMENT_MODE=single
TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE=json_schema
TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS=6
TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS=700
TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY=4
TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS=120000
TRANSCRIPT_ENHANCEMENT_MAX_RETRIES=1
TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL=

AUDIO_RECORDING_TARGET_BITRATE_KBPS=128
AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS=96
AUDIO_TRANSCRIPTION_SAMPLE_RATE=48000
AUDIO_TRANSCRIPTION_CHANNELS=1
AUDIO_TRANSCRIPTION_MAX_FILE_MB=24

RECORDING_DEBUG_PANEL=false
NEXT_PUBLIC_RECORDING_DEBUG_PANEL=false
```

## 5) Voximplant console checklist

- App/rule/scenario names match env.
- Recording is enabled in scenario flow where expected.
- Scenario webhook calls route:
  - `POST /api/sessions/{sessionId}/voximplant/recording-status`
- HMAC header is sent: `X-Voximplant-Signature: hmac-sha256=<hex>`.

## 6) Webhook URL setup

- Use public HTTPS URL in `VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL`.
- Do not hard-code local tunnel URL in source.
- For local smoke, temporary tunnel is acceptable via env/admin override only.

## 7) Recording storage setup

- Ensure bucket exists and app credentials have read/write permissions.
- Validate upload/download with admin health endpoint or a test recording.

## 8) Yandex SpeechKit setup

- Verify API key and folder permissions.
- Confirm selected model/language are valid.
- Validate one known sample through transcription endpoint.

## 9) Yandex AI / DeepSeek setup

- Verify transcript enhancement model is reachable.
- If disabled, ensure fallback behavior is acceptable for demo.

## 10) Audio preparation setup

- Keep current Stage 3 POC values:
  - `AUDIO_RECORDING_TARGET_BITRATE_KBPS=128`
  - `AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS=96`
  - `AUDIO_TRANSCRIPTION_SAMPLE_RATE=48000`
  - `AUDIO_TRANSCRIPTION_CHANNELS=1`
  - `AUDIO_TRANSCRIPTION_MAX_FILE_MB=24`
- `AUDIO_TRANSCRIPTION_MAX_FILE_MB` is a compression threshold.
- If source file is below threshold and container is compatible, original file is reused without recompression.
- Compression/transcoding remains enabled for large or incompatible source files.

## 11) Domain and HTTPS requirements

- HTTPS required for webhook callbacks and auth flows.
- Stable DNS + TLS cert required in production.

## 12) Post-deploy smoke test

1. Open event.
2. Join facilitator + participants + observers.
3. Start session and recording.
4. Stop recording and verify webhook completion.
5. Trigger transcription.
6. Verify analysis generation.
7. Verify observer-safe materials visibility.

## 13) Rollback/checkpoint instructions

> **Current policy:** default rollback is Git SHA / build plus the **current**
> valid authoritative runtime env. Do not restore a historical env snapshot as
> a routine companion to code rollback. See
> `docs/operations/deployment-runbook.md`.

- Keep deploy aligned with checkpoint tags:
  - `checkpoint/vox-room-parity-stage-1`
  - `checkpoint/vox-event-lobby-stage-2`
- For regression rollback, redeploy the previous approved stable image, keep
  the current valid production env unless an exceptional env restore is
  explicitly justified, then run runtime-permission apply/check after its final
  checkout/install/Prisma generation and before restarting the runtime. The
  rollback bundle must include the normalizer; do not substitute `chmod -R`.
  The historical “image and env snapshot” pairing below this note is not
  current operational guidance.
- If transcription quality regresses, return to `standard` profile and re-run A/B procedure.
- For transcript enhancement rollout rollback, switch `TRANSCRIPT_ENHANCEMENT_MODE=single` and restart service.
  Single mode prefers one provider request only when the input fits the
  configured segment and character bounds. Oversized input still uses the
  bounded chunked path, so this setting is not an operational switch for
  disabling all chunking on arbitrarily large sessions; that preserves the
  large-input safety guarantee.

## 14) Stage 3.9E JSON Schema rollout (manual env activation)

Do not edit real env files from CI/agent automation. Apply manually after validated deploy.

### Local activation

> Historical local sequence. Adjacent `$path.bak-<timestamp>` copies are not
> current guidance. Treat any local plaintext copy as temporary (delete after
> validation; 24h hard cap). Production policy:
> `docs/operations/deployment-runbook.md`.

Target file:

- `C:\Projects\Negotiations AI\negotiations-web\.env`

Required value:

- `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="json_schema"`

Procedure (PowerShell):

```powershell
$path = "C:\Projects\Negotiations AI\negotiations-web\.env"
$backup = "$path.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $path $backup

$content = Get-Content $path -Raw
$content = [regex]::Replace(
  $content,
  '^\s*TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE\s*=.*$',
  'TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="json_schema"',
  [System.Text.RegularExpressions.RegexOptions]::Multiline
)
if ($content -notmatch 'TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE') {
  $content = $content.TrimEnd() + "`r`nTRANSCRIPT_ENHANCEMENT_OUTPUT_MODE=""json_schema""`r`n"
}
Set-Content -Path $path -Value $content -NoNewline

Get-Content $path | Select-String 'TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE'
```

Duplicate prevention:

- Keep only one `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE=` line.

Restart:

- Restart local Next.js process after update.

Rollback:

- Set `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="legacy"` and restart.

### Server activation

> **Historical procedure.** The adjacent
> `.env.production.bak-<timestamp>` pattern below must **not** be used for new
> deployments. If a temporary plaintext env copy is genuinely required, create
> it only under `/var/www/negotaitions-secure-backups` (mode `600`, restricted
> parent), delete it after validation PASS, and never keep it longer than 24h.
> Authoritative steps: `docs/operations/deployment-runbook.md`.

Target file:

- `/var/www/negotaitions/app/.env.production`

Required value:

- `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="json_schema"`

Procedure (bash) — historical sequence retained for stage traceability; do not
repeat the `BACKUP=...bak-*` copy for new work:

```bash
set -euo pipefail
ENV_FILE="/var/www/negotaitions/app/.env.production"
BACKUP="/var/www/negotaitions/app/.env.production.bak-$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP"

if grep -q '^TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE=' "$ENV_FILE"; then
  sed -i 's/^TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE=.*/TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="json_schema"/' "$ENV_FILE"
else
  printf '\nTRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="json_schema"\n' >> "$ENV_FILE"
fi

awk -F= '/^TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE=/{print $1"="$2}' "$ENV_FILE"
```

Duplicate prevention:

- Ensure exactly one `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE=` line remains.

Safe verification:

- Verify only this key; do not print secrets.

Restart and health:

```bash
sudo systemctl restart negotiations-web
sudo systemctl status negotiations-web --no-pager
journalctl -u negotiations-web -n 120 --no-pager
```

Rollback:

```bash
sed -i 's/^TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE=.*/TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="legacy"/' /var/www/negotaitions/app/.env.production
sudo systemctl restart negotiations-web
```

