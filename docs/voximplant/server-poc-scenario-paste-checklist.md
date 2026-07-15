# Server POC — VoxEngine Scenario Paste Checklist

Use this checklist when deploying the recording webhook scenario to Voximplant Console for the production server POC at `https://negotaitions.ru`.

---

## 1. File to copy

Copy the **entire contents** of one of these files into the Voximplant Console scenario editor for `neg-conf-main-room`:

| Path | Notes |
|------|-------|
| `docs/voximplant/neg-conf.main-room.scenario.js` | Canonical source (edit here first) |
| `.voxengine-ci/scenarios/src/neg-conf-main-room.voxengine.js` | Same content, paste-ready copy |

Do **not** upload via CI for this manual paste workflow unless you intentionally use `npm run vox:scenario:upload`.

---

## 2. Required manual replacement (secret)

Before saving in Voximplant Console, find this line near the top of the scenario:

```javascript
var WEBHOOK_SECRET = "__PASTE_VOXIMPLANT_RECORDING_WEBHOOK_SECRET_HERE__";
```

Replace `__PASTE_VOXIMPLANT_RECORDING_WEBHOOK_SECRET_HERE__` with the value of **`VOXIMPLANT_RECORDING_WEBHOOK_SECRET`** from the server `.env.production` file.

- Do **not** paste the secret into git, docs, chat, or this checklist.
- Do **not** commit the scenario file after replacing the secret.
- The scenario logs `WEBHOOK_SECRET_configured=true/false` and `WEBHOOK_SECRET_length=<n>` — never the secret itself.

`WEBHOOK_BASE_URL` defaults to `https://negotaitions.ru` and does not need changing for server POC.

---

## 3. After paste — smoke test

Before smoke:

1. Export/backup currently deployed scenario source/version.
2. Record current build marker from provider logs.
3. Paste updated source and save as a new scenario version when provider workflow allows.
4. Verify rule binding points to `neg-conf-main-room`.

Then smoke:

1. Save the scenario in Voximplant Console.
2. Start a **new** negotiation room session at `https://negotaitions.ru/room/<sessionId>`.
3. Record for **30–60 seconds**, then stop recording.
4. Wait a few seconds for Voximplant to finalize the recording file.

---

## 4. Voximplant log search strings

In Voximplant Console → Scenarios → Logs, search for:

| Search string | Expected meaning |
|---------------|------------------|
| `server-poc-webhook-fix-2026-07-13-a7` | Correct Stage 3.10 A7 build is running |
| `webhook config` | Startup config summary (base URL, secret configured, HMAC provider) |
| `recording_control received` | Browser sent start/stop commands |
| `Recorder.Stopped handler entered` | Recording finished in VoxEngine |
| `webhook POST attempted` | Scenario attempted HTTP POST to Next.js |
| `webhook response status` | Server responded (look for 2xx) |
| `scenario shutdown stop requested reason=ConferenceEvents.Stopped` | Shutdown hardening triggered on conference stop |
| `scenario shutdown stop requested reason=AppEvents.Terminating` | Shutdown hardening triggered on app termination |

If you see `webhook skipped: WEBHOOK_SECRET not configured`, the secret placeholder was not replaced.

If you see `webhook skipped: missing effectiveWebhookBaseUrl`, check `WEBHOOK_BASE_URL` or browser `webhookBaseUrl`.

---

## 5. Server nginx check

On the server:

```bash
sudo grep -R "voximplant/recording-status" /var/log/nginx/access.log /var/log/nginx/error.log | tail -50
```

You should see `POST /api/sessions/<sessionId>/voximplant/recording-status` with HTTP 2xx after a successful recording stop.

---

## 6. Database check

Replace `<new_session_id>` with the session ID from your smoke test:

```sql
select id, "sessionId", status, provider, "fileKey", "fileUrl", "mimeType", "originalSizeBytes", "errorMessage", "startedAt", "endedAt", "updatedAt"
from "Recording"
where "sessionId"='<new_session_id>';
```

After a successful webhook:

- `status` should be `STOPPED` (or progressed further if transcription started).
- `fileKey`, `fileUrl`, `mimeType`, `originalSizeBytes` should be populated when Voximplant provided a recording URL.

---

## 7. Local tunnel testing (optional)

`ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE = true` is preserved. When testing against a local tunnel, the browser may send `webhookBaseUrl` in `recording_control` messages to override the default. Server POC does **not** require this — the default `https://negotaitions.ru` is sufficient.

---

## 8. Conference name prefix

The scenario uses `negotiation-{sessionId}`, matching `lib/voximplant/conference-name.ts`. Session ID is taken from `recording_control.message.sessionId` first; parsing `conferenceName` is fallback only.

---

## 9. Rollback

If canary fails:

1. Restore previous scenario version/source.
2. Re-verify rule binding.
3. Re-run basic join/start/stop canary.
4. Confirm webhook receipt and recording transition on rollback version.
