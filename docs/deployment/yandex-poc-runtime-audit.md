# Yandex POC Runtime Audit

**Date:** 2026-07-03  
**Purpose:** Document server/runtime assumptions for the NegotAItions POC on Yandex Cloud  
**Rules:** Read-only audit; no env/secrets modified; infrastructure spelling **negotaitions** preserved

---

## 1. Known POC infrastructure

From operator context and `docs/deployment/yandex-poc-server-parameters.md`:

| Parameter | Value |
|---|---|
| Environment | `poc` |
| Public IP | `130.193.62.91` |
| Primary domain | `negotaitions.ru` |
| App subdomain | `app.negotaitions.ru` |
| App path | `/var/www/negotaitions/app` |
| systemd service | `negotaitions-poc` |
| SSH user | `deploy` |
| DB host | `rc1b-mldqrukdd2ubmfuc.mdb.yandexcloud.net` |
| DB name | `negotaitions_poc` |
| DB user | `negotaitions_poc_user` |
| DB port | `6432` (Yandex Managed PostgreSQL, likely PgBouncer) |
| Vox private key path | `/etc/negotaitions/secrets/voximplant_private.json` |
| Vox CI root | `/var/www/negotaitions/app/.voxengine-ci` |

**Note:** systemd unit files and nginx configs are **not in this repository**; assumptions below are inferred from app code and deployment docs.

---

## 2. Process model assumptions

### 2.1 Node.js application

| Assumption | Evidence |
|---|---|
| Start command | `npm run start` → `next start` (`package.json`) |
| Build required before start | `npm run build` produces `.next/` |
| Prisma client generated at build | `npx prisma generate` in runbook |
| Runtime | `export const runtime = "nodejs"` on most API routes |
| Default port | Next.js default `3000` unless `PORT` set |

### 2.2 Single-process coupling (HIGH RISK)

These modules use **in-memory `globalThis` stores** (per Node process):

| Module | Symbol | Purpose |
|---|---|---|
| `lib/session-room-connection-lease.ts` | `negotaitions.sessionRoomConnectionLeases` | Same-user multi-tab room takeover |
| `lib/event-lobby-connection-lease.ts` | `negotaitions.eventLobbyConnectionLeases` | Lobby tab takeover |

**Implication:** If `negotaitions-poc` ever runs **multiple workers** (PM2 cluster, multiple systemd instances, K8s replicas), lease enforcement becomes **best-effort per instance** — stale tabs may both appear active; 409 responses inconsistent.

**POC assumption:** Single Node process behind nginx is **required** for correct duplicate-tab behavior unless leases are externalized.

---

## 3. Environment variables used by code

### 3.1 Provider selection (required)

| Variable | Used in | Default / notes |
|---|---|---|
| `VIDEO_PROVIDER` | `lib/env.ts` | `livekit`; POC must be `voximplant` |
| `TRANSCRIPTION_PROVIDER` | `lib/env.ts` | `openai`; POC `yandex_speechkit` |
| `AI_ANALYSIS_PROVIDER` | `lib/env.ts` | `openai`; POC `yandex` |

### 3.2 Database (required)

| Variable | Used in | POC value pattern |
|---|---|---|
| `DATABASE_URL` | `lib/prisma.ts` | `postgresql://negotaitions_poc_user:***@rc1b-mldqrukdd2ubmfuc.mdb.yandexcloud.net:6432/negotaitions_poc?...` |

Prisma 7 with `@prisma/adapter-pg` — requires valid PostgreSQL connection at runtime for all session/event APIs.

**Local-only:** None for DB; all environments need network reachability to Yandex MDB from app host.

### 3.3 Application URL / auth

| Variable | Code reference | Status |
|---|---|---|
| `APP_URL` | `lib/config.ts` → `getAppUrl()` | **Active** — used for invite/materials absolute URLs |
| `APP_NAME` | `lib/config.ts` | Optional branding |
| `ADMIN_EMAILS` | `lib/auth/admin.ts` | Comma-separated admin bootstrap |
| `NODE_ENV` | Many | `production` on POC |

**Documentation mismatch:**

| Documented (runbooks) | Actual code |
|---|---|
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | **Not used** — no NextAuth in codebase |
| `NEXT_PUBLIC_APP_URL` | Listed in admin diagnostics only; **`APP_URL` is authoritative** |

Cookie auth uses `auth_session`; no OAuth env vars in application code.

### 3.4 Voximplant (required when `VIDEO_PROVIDER=voximplant`)

| Variable | Purpose |
|---|---|
| `VOXIMPLANT_ACCOUNT_NAME` | Account identifier |
| `VOXIMPLANT_APPLICATION_NAME` | Application name |
| `VOXIMPLANT_USER_DOMAIN` | SDK login domain |
| `VOXIMPLANT_SCENARIO_NAME` | Scenario bound to rule |
| `VOXIMPLANT_RULE_NAME` | Inbound rule name |
| `VOXIMPLANT_API_KEY_PATH` | **POC:** `/etc/negotaitions/secrets/voximplant_private.json` |
| `VOXIMPLANT_RECORDING_ENABLED` | Recording feature flag |
| `VOXIMPLANT_RECORDING_AUDIO_ONLY` | Default true |
| `VOXIMPLANT_RECORDING_AUDIO_MODE` | `lossless` (default) or `hd_mp3` |
| `VOXIMPLANT_RECORDING_PAUSE_ENABLED` | Internal pause support |
| `VOXIMPLANT_RECORDING_STORAGE` | Scenario storage hint |
| `VOXIMPLANT_RECORDING_WEBHOOK_SECRET` | HMAC validation (required) |
| `VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL` | **Must be** `https://app.negotaitions.ru` (or override via AppSetting) |
| `VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED` | Admin tunnel override gate |
| `VOXIMPLANT_AUDIO_PROCESSING_PROFILE` | `speech` (default) or `raw_diagnostic` |
| `VOXIMPLANT_MANAGEMENT_API_KEY` | Optional if key file used |
| `VOXIMPLANT_MANAGEMENT_ACCOUNT_ID` | Management API |
| `VOXIMPLANT_MANAGEMENT_APPLICATION_ID` | User provisioning |
| `VOX_CI_ROOT_PATH` | Default `.voxengine-ci`; **POC:** `/var/www/negotaitions/app/.voxengine-ci` |
| `VOX_CI_CREDENTIALS` | Scenario upload scripts |

Management API resolution order (`lib/voximplant/management-api.ts`):

1. Env vars (`VOXIMPLANT_MANAGEMENT_*`)
2. Key file at `VOXIMPLANT_API_KEY_PATH`

### 3.5 Object storage (required for recording pipeline)

| Variable | Default | POC |
|---|---|---|
| `S3_ENDPOINT` | `https://storage.yandexcloud.net` | Yandex Object Storage |
| `S3_REGION` | `ru-central1` | |
| `S3_BUCKET` | required | POC bucket |
| `S3_ACCESS_KEY_ID` | required | |
| `S3_SECRET_ACCESS_KEY` | required | |
| `S3_FORCE_PATH_STYLE` | `false` unless `true` | |

Used by: webhook handler, transcription download, admin storage check, signed URLs in materials.

### 3.6 Yandex SpeechKit

| Variable | Default |
|---|---|
| `YANDEX_FOLDER_ID` | required |
| `YANDEX_API_KEY` | required |
| `YANDEX_SPEECHKIT_BASE_URL` | `https://stt.api.cloud.yandex.net` |
| `YANDEX_OPERATION_BASE_URL` | async operation polling |
| `YANDEX_SPEECHKIT_MODEL` | `general:rc` |
| `YANDEX_SPEECHKIT_LANGUAGE` | `ru-RU` |
| `YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED` | true |
| `YANDEX_SPEECHKIT_LITERATURE_TEXT` | true |
| `YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING` | true |
| `YANDEX_SPEECHKIT_AUDIO_CONTAINER` | optional MP3/WAV/OGG_OPUS |
| `YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED` | false |
| `YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL` | `deepseek-v4-flash` |

### 3.7 Yandex AI / analysis

| Variable | Default |
|---|---|
| `YANDEX_AI_MODEL` | `deepseek-v4-flash` |
| `YANDEX_AI_BASE_URL` | `https://ai.api.yandex.net/v1` |
| `YANDEX_AI_MAX_OUTPUT_TOKENS` | `6000` |
| `YANDEX_DATA_LOGGING_ENABLED` | header for compliance |
| `OPENAI_API_KEY` | fallback if providers set to openai |

### 3.8 Audio / ffmpeg

| Variable | Purpose |
|---|---|
| `FFMPEG_BIN` | Override ffmpeg path |
| `FFPROBE_BIN` | `scripts/inspect-audio-recording.ts` |
| `AUDIO_RECORDING_TARGET_BITRATE_KBPS` | default 32 in code, 128 in runbook |
| `AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS` | default 32, runbook 96 |
| `AUDIO_TRANSCRIPTION_SAMPLE_RATE` | 48000 |
| `AUDIO_TRANSCRIPTION_CHANNELS` | 1 |
| `AUDIO_TRANSCRIPTION_MAX_FILE_MB` | compression threshold (24 in runbook) |
| `AUDIO_TRANSCRIPTION_QUALITY_PROFILE` | quality preset |

ffmpeg sources (`lib/audio/compress.ts`): `FFMPEG_BIN` → system PATH → `ffmpeg-static` bundled.

### 3.9 Debug / feature flags

| Variable | Purpose |
|---|---|
| `RECORDING_DEBUG_PANEL` | Server-side debug panel |
| `NEXT_PUBLIC_RECORDING_DEBUG_PANEL` | Client debug in dev |
| `AUTO_TRANSCRIBE_AFTER_RECORDING` | default false |
| `VOXIMPLANT_TEST_CONFERENCE_NAME` | test page only |

### 3.10 LiveKit (legacy path — may still be set)

If `VIDEO_PROVIDER=livekit`, required: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

POC should **not** depend on these but admin health still reports their presence.

---

## 4. Filesystem paths on POC server

| Path | Purpose | Permissions assumption |
|---|---|---|
| `/var/www/negotaitions/app` | Application root, `.next`, `node_modules` | `deploy` user read/execute |
| `/var/www/negotaitions/app/.voxengine-ci` | VoxEngine CI scenario sync | Writable for scenario upload |
| `/etc/negotaitions/secrets/voximplant_private.json` | Vox API private key | Readable by service user only |
| `.env` or systemd `EnvironmentFile` | Runtime secrets | Not in git; not audited here |

**Server-only paths referenced in code:**

- `VOXIMPLANT_API_KEY_PATH` — must exist for Management API user provisioning
- ffmpeg binary — uses bundled static if system ffmpeg absent

**Local-only paths (dev):**

- `DATABASE_URL=localhost` for Playwright / local smoke
- Tunnel URLs for webhook override (admin panel)

---

## 5. Network / DNS / TLS assumptions

| Requirement | Reason |
|---|---|
| `app.negotaitions.ru` → `130.193.62.91` | Public app access |
| Valid TLS certificate | Secure cookies, Vox webhook HTTPS |
| Outbound HTTPS to Voximplant | SDK + Management API |
| Outbound HTTPS to `stt.api.cloud.yandex.net` | SpeechKit |
| Outbound HTTPS to `ai.api.cloud.yandex.net` | Yandex AI |
| Outbound HTTPS to `storage.yandexcloud.net` | S3 recording I/O |
| Inbound POST from Voximplant to `/api/sessions/*/voximplant/recording-status` | Webhook |
| DB port 6432 reachable from app VM | Managed PostgreSQL |

Webhook URL construction (`lib/voximplant/recording-webhook-url.ts`):

```
{VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL}/api/sessions/{sessionId}/voximplant/recording-status
```

Admin can override base URL via `AppSetting` when `VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED=true` (non-production or controlled ops).

---

## 6. nginx / systemd assumptions (inferred)

Not versioned in repo; typical POC layout:

```text
Internet → nginx (443) → proxy_pass http://127.0.0.1:3000
                      → negotaitions-poc.service (User=deploy)
                      → WorkingDirectory=/var/www/negotaitions/app
                      → EnvironmentFile=/etc/negotaitions/app.env (assumed)
```

**nginx requirements:**

- WebSocket not required for main app (Vox WebRTC is client ↔ Vox cloud)
- Large body size for API uploads generally not needed (recordings go to S3 via Vox)
- Proxy headers for HTTPS detection (`X-Forwarded-Proto`) — affects `secure` cookie if misconfigured

**systemd requirements:**

- Restart on failure
- `npm run start` or `node node_modules/.bin/next start`
- Single instance recommended (see §2.2)

**Validation commands (on server, read-only):**

```bash
systemctl status negotaitions-poc
journalctl -u negotaitions-poc -n 100 --no-pager
curl -sS https://app.negotaitions.ru/api/admin/health | head
```

---

## 7. Database assumptions

| Topic | Detail |
|---|---|
| Provider | PostgreSQL via Prisma 7 |
| Migrations | `npx prisma migrate deploy` per runbook |
| Baseline migration | `20260627_production_initial_baseline` |
| Connection pooling | Port 6432 suggests Yandex pooler — use connection string params compatible with Prisma/pg |
| Seed | `npm run db:seed` optional for dev |

**No SQLite / edge runtime** — all Prisma access is server-side Node.

---

## 8. VoxEngine scenario deployment

| Script | Purpose |
|---|---|
| `npm run vox:scenario:prepare` | Sync scenario into `.voxengine-ci` |
| `npm run vox:scenario:upload` | Upload to Voximplant account |
| `npm run vox:scenario:check` | Drift detection |

POC must keep scenario name in sync with `VOXIMPLANT_SCENARIO_NAME`. Scenario source copies live under `docs/voximplant/neg-conf.*.scenario.js`.

Webhook contract: scenario POSTs JSON + `X-Voximplant-Signature: hmac-sha256=<hex>`.

---

## 9. Runtime dependency health checks

Admin `/api/admin/health` aggregates:

| Check | Function |
|---|---|
| Env config flags | `getEnvironmentConfigStatus()` |
| S3 | `checkStorageHealth()` |
| ffmpeg | `getFfmpegStatus()` |
| OpenAI | optional |
| LiveKit | optional |
| Vox Management API | `getVoximplantManagementApiDiagnostics()` |

Use admin UI at `/admin` after deploy before demo.

---

## 10. Suspected runtime gaps / misconfigurations

| Risk | Symptom | Check |
|---|---|---|
| Wrong `APP_URL` | Broken invite links, wrong webhook in emails | Set to `https://app.negotaitions.ru` |
| Webhook base URL HTTP or wrong host | Recording stuck STOPPED, no fileKey | Admin health + debug panel |
| Missing key file permissions | Vox identity provisioning fails | `/api/admin/check-voximplant` |
| `VIDEO_PROVIDER` not voximplant | LiveKit errors on room join | Admin env display |
| DB SSL params missing | Prisma connection errors on boot | journalctl |
| ffmpeg unavailable | Transcription fails at COMPRESSING | Admin ffmpeg check |
| SpeechKit quota/auth | Transcript FAILED | ExternalServiceEvent log |
| Multi-instance deploy | Random 409 / duplicate tabs | Process count |
| Stale `.next` after deploy | Old room UI without timer | Rebuild + restart service |
| Scenario drift | Recording messages ignored | `npm run vox:scenario:check` |

---

## 11. High-risk runtime files

| File | Runtime role |
|---|---|
| `lib/prisma.ts` | DB connection |
| `lib/voximplant/management-api.ts` | Key file + user provisioning |
| `lib/voximplant/recording-webhook-url.ts` | Webhook URL resolution |
| `lib/storage/s3.ts` | Recording I/O |
| `lib/audio/compress.ts` | Transcription preprocessing |
| `lib/services/yandex-speechkit-transcription.ts` | STT |
| `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts` | Webhook ingest |
| `lib/session-room-connection-lease.ts` | Tab takeover (in-memory) |

---

## 12. Manual runtime verification (POC)

| Step | Command / action |
|---|---|
| 1 | `curl -I https://app.negotaitions.ru` → 200/307 |
| 2 | Login as admin → `/admin` all green |
| 3 | Verify `VIDEO_PROVIDER=voximplant` in env display |
| 4 | Verify Vox key path configured (not value) |
| 5 | `POST /api/admin/check-voximplant` success |
| 6 | Verify S3 check passes |
| 7 | Verify ffmpeg available |
| 8 | Run short test call; confirm webhook hits server access log |
| 9 | Confirm recording row COMPLETED with fileKey in DB |
| 10 | Trigger transcribe; confirm SpeechKit operation completes |

---

## 13. Recommendations (no changes in this audit)

1. Document actual auth env vars (`APP_URL`, cookie session) in operator runbook; remove NextAuth references.
2. Explicitly document **single-instance requirement** for connection leases on POC.
3. Add nginx/systemd templates to repo (separate ops PR) for reproducibility.
4. Store non-secret POC parameters only in `docs/deployment/yandex-poc-server-parameters.md`; never commit `.env`.
5. After each deploy: admin health + one recording webhook trace in journalctl.
6. Schedule periodic `vox:scenario:check` in deploy pipeline.
7. Capture ffprobe output from first POC recording; attach to Stage 3 audio audit.

---

## 14. Safe read-only commands on POC

```bash
# Service status
systemctl status negotaitions-poc

# Recent logs (no secrets if log level sane)
journalctl -u negotaitions-poc -n 200 --no-pager

# Health endpoint
curl -sS https://app.negotaitions.ru/api/admin/health | jq '.config.videoProvider,.config.voximplant.recordingWebhookBaseUrlValue'

# Scenario drift (from app dir, needs credentials)
cd /var/www/negotaitions/app && npm run vox:scenario:check
```

Do **not** run `prisma migrate dev`, scenario upload, or env edits as part of this audit phase.
