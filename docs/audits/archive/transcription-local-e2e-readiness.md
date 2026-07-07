# Transcription Local E2E Readiness Audit

## 1) Local URL verdict

- Detected from local `.env`:
  - `APP_URL="https://local.negotaitions.ru"`
  - `VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL=https://local.negotaitions.ru`
- Confirmed spelling for local domain is `local.negotaitions.ru` (same root spelling as production `negotaitions.ru`).

## 2) Safe env checklist (non-secret)

Expected for local Vox/transcription audit:

- `APP_URL=https://local.negotaitions.ru`
- `VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL=https://local.negotaitions.ru`
- `VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED=false`
- `VIDEO_PROVIDER=voximplant`
- `DATABASE_URL` targets local DB host (`localhost`/`127.0.0.1`/docker service), not production host

PowerShell quick check (no secret print):

```powershell
$envPath = ".env"
$keys = "APP_URL","VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL","VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED","VIDEO_PROVIDER","DATABASE_URL"
$raw = Get-Content $envPath
$map = @{}
foreach ($line in $raw) {
  $line = $line.Trim()
  if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { continue }
  $idx = $line.IndexOf("=")
  $map[$line.Substring(0,$idx)] = $line.Substring($idx+1)
}
foreach ($k in $keys) {
  if ($k -eq "DATABASE_URL") {
    $v = ($map[$k] ?? "").ToLower()
    $local = $v.Contains("localhost") -or $v.Contains("127.0.0.1") -or $v.Contains("@db:")
    Write-Host "$k=<present:$([string]::Join('',@($(if($local){'local'}else{'non-local'}))))>"
  } else {
    Write-Host "$k=$($map[$k])"
  }
}
```

## 3) Playwright base URL resolution

`playwright.config.ts` now resolves in this order:

1. `PLAYWRIGHT_BASE_URL`
2. `BASE_URL`
3. `APP_URL`
4. fallback `http://127.0.0.1:${PLAYWRIGHT_PORT|3100}`

Behavior:

- If one of env URLs is provided, Playwright uses it directly and does **not** auto-start `next dev`.
- If none is provided, Playwright starts local webServer as before.

### Commands

POSIX:

```bash
PLAYWRIGHT_BASE_URL="https://local.negotaitions.ru" \
BASE_URL="https://local.negotaitions.ru" \
APP_URL="https://local.negotaitions.ru" \
npx playwright test
```

PowerShell:

```powershell
$env:PLAYWRIGHT_BASE_URL="https://local.negotaitions.ru"
$env:BASE_URL="https://local.negotaitions.ru"
$env:APP_URL="https://local.negotaitions.ru"
npx playwright test
```

## 4) Vox local smoke readiness

1. Start local DB (Docker PostgreSQL).
2. Start local app: `npm run dev` on `127.0.0.1:3000`.
3. Keep tunnel running:
   - `ssh -N -R 127.0.0.1:3300:127.0.0.1:3000 deploy@172.29.172.1`
4. Open `https://local.negotaitions.ru` in browser.
5. Create standalone session.
6. Open room with `?debugRecording=1`.
7. Check debug endpoint:
   - `GET /api/debug/recording/{sessionId}`
   - verify `env.webhookBaseUrl === "https://local.negotaitions.ru"`
   - inspect `env.webhookBaseUrlSource`, `overrideEnabled`, `savedOverridePresent`.
8. Start/stop recording and verify webhook reaches local app.
9. Confirm rows and transcript artifacts are written only to local DB.

## 5) Recording debug API (for smoke)

Endpoint:

- `GET /api/debug/recording/{sessionId}`

Expected fields:

- `env.webhookBaseUrl`
- `env.webhookBaseUrlSource`
- `env.overrideEnabled`
- `env.savedOverridePresent`
- `env.envWebhookBaseUrlPresent`
- `db.recording.status`
- `db.recording.fileKeyPresent`
- `events[]`

## 6) Production transcription audit (read-only)

Use script on server:

- `scripts/audit/transcription/export-production-transcription-audit.sh`

Default session set:

- `cmr6mmnse0009llm1ibevs2cl`
- `cmr6nd1ob0012llm15xcsv1xy`
- `cmr6nll0r001rllm1fqevbcz3`
- `cmr6nw0ro002ellm1dtqlesq1`
- `cmr6obf9n0032llm1i2nve1ob`

Output structure:

```text
<OUT_ROOT>/run-<timestamp>/
  session-ids.txt
  README.md
  <sessionId>/
    db/
      recording.txt
      transcript.txt
      transcript-segments.txt
      session-participants.txt
      processing-metadata.json
      speaker-mapping.json
      ai-raw-model-output.json
      transcript-status-summary.txt
    logs/
      session-transcription.log
    reports/
      materials-status-api.json
      transcript-api.json
      notes.md
```

## 7) Variant comparison plan (file outputs only)

Per session, create:

```text
audit/transcription/<sessionId>/
  recording.json
  ffprobe.json
  current.raw.json
  current.transcript.txt
  variant-normalize.json
  variant-normalize.txt
  variant-mono-stereo.json
  variant-mono-stereo.txt
  variant-sample-rate.json
  variant-sample-rate.txt
  variant-noise-silence.json
  variant-noise-silence.txt
  variant-diarization.json
  variant-diarization.txt
  variant-post-process.json
  variant-post-process.txt
  variant-speaker-mapping.json
  comparison.md
```

No variant output should be persisted to production `Transcript` rows.

## 8) Mandatory backlog (do not fix in this audit)

1. Remote active speaker highlight missing (only local participant highlights reliably).
2. Join/leave race can temporarily duplicate participant on quick exit/re-enter.
3. Session/room title stale state can reuse prior/default title.
4. Local tunnel/domain setup must stay documented and e2e-friendly.
