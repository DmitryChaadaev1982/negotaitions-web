# Voximplant Recording Diagnostics Panel

Stage 5.4.8 — Temporary dev-only diagnostics for the Voximplant recording lifecycle.

---

## 1. How to enable

Add to `.env.local` (never commit):

```env
RECORDING_DEBUG_PANEL=true
NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true
```

Restart the Next.js dev server after changing `.env.local`.

`RECORDING_DEBUG_PANEL=true` enables the server-side API endpoint and smoke
recording-control endpoint.  
`NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true` enables the in-browser panel and
client-side debug POST calls.

Both must be `true` for the full experience. In production (or when these
variables are absent/false) the API returns `404` and the panel is not rendered.

---

## 2. How to open the panel

In the facilitator room URL, append `?debugRecording=1`:

```
/room/[sessionId]?debugRecording=1
```

Example:

```
http://localhost:3000/room/cm123abc?debugRecording=1
```

The panel appears below the audio diagnostics panel (if visible) and is
**collapsed by default**. Click the "Диагностика записи (Voximplant)" header
to expand it.

The panel is only visible to the **facilitator** and only when
`NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true`.

---

## 3. What each pipeline step means

| Step | Meaning |
|------|---------|
| Session exists in DB | The `Session` row was found — correct `sessionId` |
| Recording row created | A `Recording` row exists for this session |
| Start API called | Browser called `POST /recording-control` with `action=start` |
| Start scenarioMessage returned | Server returned a typed `RecordingControlMessage` |
| Start message sent to VoxEngine | `conference.sendMessage()` succeeded |
| Recording status STARTING/RECORDING | DB row reflects VoxEngine started recording |
| Stop API called | Browser called `POST /recording-control` with `action=stop` |
| Stop scenarioMessage returned | Server returned a stop `RecordingControlMessage` |
| Stop message sent to VoxEngine | `conference.sendMessage()` stop succeeded |
| Recording status STOPPED | DB row was set to STOPPED after stop relay |
| Webhook hit | `/voximplant/recording-status` received a request |
| Webhook signature valid | HMAC-SHA256 signature matched `VOXIMPLANT_RECORDING_WEBHOOK_SECRET` |
| fileKey received | VoxEngine included `objectKey` (S3 path) in the webhook payload |
| Recording COMPLETED | DB row is `COMPLETED` with a non-null `fileKey` |

---

## 4. How to run the smoke test

Requirements:
- Dev server running at `http://localhost:3000`
- `.env.local` has `RECORDING_DEBUG_PANEL=true`, `VOXIMPLANT_RECORDING_WEBHOOK_SECRET`, `S3_BUCKET`
- A real `Session` row exists in the DB (you can use an existing test session ID)

```bash
npm run smoke:vox-recording -- --sessionId <SESSION_ID>
```

With options:

```bash
npm run smoke:vox-recording -- \
  --sessionId cm123abc \
  --baseUrl http://localhost:3000 \
  --verbose
```

All CLI options:

| Option | Default | Description |
|--------|---------|-------------|
| `--sessionId` | required | Session to test against |
| `--baseUrl` | `http://localhost:3000` | Dev server base URL |
| `--participantId` | `smoke-facilitator` | Participant identity for smoke actions |
| `--simulateWebhook` | `true` | Whether to simulate the VoxEngine webhook |
| `--verbose` | `false` | Print raw HTTP request/response details |

---

## 5. What PASS looks like

A successful run prints:

```
═══ Voximplant Recording Smoke Test ═══

Steps:
  ✓ PASS  [session-exists]              Session <ID> exists in DB
  ✓ PASS  [start-api]                   recording-control start ok
  ✓ PASS  [status-starting]             Recording status after start: STARTING ...
  ✓ PASS  [filekey-null-after-start]    fileKey is null after start ...
  ✓ PASS  [stop-api]                    recording-control stop ok
  ✓ PASS  [status-stopped]              Recording status after stop: STOPPED ...
  ✓ PASS  [filekey-null-after-stop]     fileKey is null after stop ...
  ✓ PASS  [webhook-sent]                Webhook response: HTTP 200 action=updated
  ✓ PASS  [status-completed]            Recording status after webhook: COMPLETED ...
  ✓ PASS  [filekey-present-after-webhook] fileKey present after webhook: fileKeyPresent=true
  ✓ PASS  [no-error-message]            errorMessage is null

═══ Summary ═══
ALL 11 STEPS PASSED
```

Key assertions:
- After `start`: status is `STARTING` (or `RECORDING`), `fileKey` is null
- After `stop`: status is `STOPPED`, `fileKey` is null
- After simulated webhook: status is `COMPLETED`, `fileKey` is present

---

## 6. Limitations

**Smoke script does not prove VoxEngine scenario is updated.**  
The script bypasses the Voximplant SDK entirely. It only validates the server-side
HTTP pipeline: recording-control API → DB → webhook → DB → COMPLETED.

**Real VoxEngine runtime must be confirmed separately.**  
To verify the scenario runtime sees the new code, check server logs for the
scenario prefix, e.g. `[neg-conf-prod]`, after a real negotiation session.

**Real external webhook requires Cloudflare tunnel.**  
Real VoxEngine calls `POST <webhookBaseUrl>/api/sessions/<sessionId>/voximplant/recording-status`.  
The `webhookBaseUrl` must be publicly reachable. Use the Cloudflare tunnel URL from
`VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL` or the admin override in the settings page.  
The tunnel URL changes on each restart — ensure it matches what VoxEngine has.

**Real webhook requires matching `VOXIMPLANT_RECORDING_WEBHOOK_SECRET`.**  
If the secret in `.env.local` does not match what the VoxEngine scenario was deployed
with, signatures will fail and the webhook will be rejected with `401`.

**In-memory ring buffer is lost on server restart.**  
Debug events are stored in `globalThis` — they survive HMR hot-reloads but not
a full `next dev` restart. This is by design (no DB persistence, no secrets at rest).

**Max 200 events per session.** Older events are dropped when the ring buffer is full.
