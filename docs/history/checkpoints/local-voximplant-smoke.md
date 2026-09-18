# Local Voximplant Smoke PoC

This document describes the Voximplant video-only smoke PoC and the experimental
manual facilitator-controlled recording layered on top of it.

**Current state: stable video-only baseline + experimental flag-gated recording.**

---

## Scope and safety

- Smoke UI is isolated at `/voximplant-test`.
- Existing `room/[sessionId]` LiveKit flow is **unchanged**.
- Local/dev only. Static test credentials. Not production-safe.

---

## Stable video-only baseline

File: `docs/voximplant/neg-conf.video-only.baseline.js`

This is the source of truth for the working 3-user conference.
Git tag: `checkpoint/voximplant-video-only-stable`.

To restore the baseline at any time:
1. Open [Voximplant Console](https://manage.voximplant.com) → Applications → negotaitions-video-poc → Scenarios → neg-conf.
2. Replace entire content with `docs/voximplant/neg-conf.video-only.baseline.js`.
3. Save.

---

## Recording — experimental and flag-gated

Recording is **disabled by default**.

| Flag | Default | Effect when `true` |
|---|---|---|
| `VOXIMPLANT_RECORDING_PANEL_ENABLED` | `false` | Shows Recording panel (facilitator only) |
| `VOXIMPLANT_RECORDING_ENABLED` | `false` | Runtime recording guard |
| `VOXIMPLANT_RECORDING_STORAGE` | unset | Storage hint (`s3` / `voximplant_cloud`) |

When all flags are `false` (default):
- No recording panel is rendered.
- `conference.sendMessage()` is never called.
- `MessageReceived` listener is never registered.
- Join flow is **identical** to the video-only baseline.

---

## How recording control works

The recording uses **scenario message control** — the browser sends JSON commands
to the VoxEngine scenario over the active conference call.

```
Browser (Facilitator)
  │
  │  conference.sendMessage({"type":"recording_control","action":"start","requestId":"abc"})
  ▼
VoxEngine scenario  ──►  VoxEngine.createRecorder({video:false, lossless:true})
                    ──►  conference.sendMediaTo(recorder)   ← audio-only pipe
  │
  │  call.sendMessage({"type":"recording_status","status":"starting","requestId":"abc"})
  ▼
Browser (Recording Panel updates: status=starting)
  │
  │  RecorderEvents.Started fires in VoxEngine
  ▼
  call.sendMessage({"type":"recording_status","status":"recording","recordingUrl":"..."})
  ▼
Browser (Recording Panel updates: status=recording, shows URL)
```

The backend routes `/api/voximplant-test/recording/*` return **501** — they are not used
for actual recording control. All control flows through the VoxEngine scenario.

---

## How to test recording locally

### Step 1 — Set env flags

In `.env.local` (do **not** commit):

```env
VOXIMPLANT_RECORDING_PANEL_ENABLED=true
VOXIMPLANT_RECORDING_ENABLED=true
VOXIMPLANT_RECORDING_STORAGE=s3
```

### Step 2 — Paste the recording scenario into Voximplant Console

> **This step is required before testing recording.**

1. Open [Voximplant Console](https://manage.voximplant.com).
2. Go to **Applications → negotaitions-video-poc → Scenarios → neg-conf**.
3. Replace ENTIRE content with `docs/voximplant/neg-conf.recording.scenario.js`.
4. Save.
5. Confirm routing rule `negotaitions-conference-rule` → `neg-conf`.

The recording scenario uses the prefix `[neg-conf-rec]` in VoxEngine logs to distinguish
it from the baseline. If you still see `[neg-conf]` in logs, the baseline is still active.

### Step 3 — Start the dev server

```bash
npm run dev
```

### Step 4 — Test

1. Open `http://localhost:3000/voximplant-test`.
2. **Window 1:** Participant A → Join conference.
3. **Window 2:** Participant B → Join conference.
4. **Window 3:** Facilitator → Join conference.
5. In the Facilitator window, a purple **Recording panel** appears below Diagnostics.
6. Click **Start recording**.

Expected behavior if `conference.sendMessage()` is available:
- Panel shows `status: starting`.
- VoxEngine logs show `recording_control received. action=start`.
- VoxEngine logs show `Recording started. url=https://...` (if storage is configured).
- Panel updates to `status: recording` and shows recording URL.

If `sendMessage` is unavailable:
- Panel shows `status: api_not_confirmed` with a clear error.
- See "Known blockers" section below.

---

## How to revert to video-only after a recording test

1. Open Voximplant Console → **Scenarios → neg-conf**.
2. Replace entire content with `docs/voximplant/neg-conf.video-only.baseline.js`.
3. Save.
4. In `.env.local`:
   ```env
   VOXIMPLANT_RECORDING_PANEL_ENABLED=false
   ```
5. Restart `npm run dev`.
6. Rejoin — no recording panel, conference works as before.

---

## Voximplant Console setup

- **Application:** `negotaitions-video-poc`
- **Users:** `participant-a`, `participant-b`, `facilitator`
- **Scenario:** `neg-conf`
- **Routing rule:** `negotaitions-conference-rule` → `neg-conf`
- **Service account:** `negotaitions-video-poc-api` (JSON key local, outside repo)

## Required env variables

```env
VIDEO_PROVIDER=voximplant
VOXIMPLANT_ACCOUNT_NAME=...
VOXIMPLANT_APPLICATION_NAME=negotaitions-video-poc
VOXIMPLANT_USER_DOMAIN=...
VOXIMPLANT_PARTICIPANT_A_USER=participant-a
VOXIMPLANT_PARTICIPANT_A_PASSWORD=...
VOXIMPLANT_PARTICIPANT_B_USER=participant-b
VOXIMPLANT_PARTICIPANT_B_PASSWORD=...
VOXIMPLANT_FACILITATOR_USER=facilitator
VOXIMPLANT_FACILITATOR_PASSWORD=...
VOXIMPLANT_SCENARIO_NAME=neg-conf
VOXIMPLANT_RULE_NAME=negotaitions-conference-rule
```

Optional:
```env
# VOXIMPLANT_CONNECTION_NODE=NODE_1   ← leave unset (auto) — wrong node = 502
# VOXIMPLANT_TEST_CONFERENCE_NAME=...  ← leave unset to use default
```

---

## How to check Voximplant Call History logs

1. Open Voximplant Console → **Applications → negotaitions-video-poc → Logs**.
2. Trigger a join or recording action, then refresh logs.
3. Log prefix for baseline scenario: `[neg-conf]`
4. Log prefix for recording scenario: `[neg-conf-rec]`

For a successful recording start, look for this sequence:

```
[neg-conf-rec] ... Recording scenario started.
[neg-conf-rec] ... Conference started.
[neg-conf-rec] ... Participant joined. callId=...
[neg-conf-rec] ... recording_control received. action=start requestId=...
[neg-conf-rec] ... Reply sent. status=starting requestId=...
[neg-conf-rec] ... createRecorder options: mode=lossless video=false lossless=true hd_audio=false
[neg-conf-rec] ... VoxEngine.createRecorder() created recorder
[neg-conf-rec] ... VoxEngine.createRecorder() created recorder; conference.sendMediaTo(recorder) called.
[neg-conf-rec] ... Recording started. url=https://...
[neg-conf-rec] ... Reply sent. status=recording requestId=...
```

If the logs show `recording_control received` but no `Recording started`:
- The `VoxEngine.createRecorder()` or `conference.sendMediaTo()` call failed — check for an exception log line.
- Storage may not be configured in Voximplant Console
  (Application → Recording storage).

If no `recording_control received` log appears after clicking Start:
- `conference.sendMessage()` is not supported by the SDK version in use.
  See "Known blockers — SDK message sending" below.

---

## How to check Yandex Object Storage

After recording stops:

1. Open [Yandex Cloud Console](https://console.yandex.cloud).
2. Go to **Object Storage → `negotaitions-recordings-dev-bucket`**.
3. Look under the `voximplant/audio/` prefix for a new audio file.
   - `RECORDING_AUDIO_MODE=lossless` → `.flac` file
   - `RECORDING_AUDIO_MODE=hd_mp3` → `.mp3` file
4. The URL should match the `recordingUrl` shown in the Recording panel
   and in VoxEngine logs (`Recording started. url=...`).

If no file appears:
- Recording storage may not be configured as S3 in Voximplant Console.
  Check **Application → Recording storage** — set to Yandex Object Storage
  (S3-compatible) with endpoint `https://storage.yandexcloud.net`.
- If storage is Voximplant cloud instead, use **Call History → Recordings** to find the file.

---

## 502 Bad Gateway — root cause checklist

### Step 1 — Check which scenario is active

The Diagnostics panel (expandable on the page) shows:
- **Scenario in use** — baseline vs recording
- **Recording panel** — enabled/disabled
- **Configured node** — `auto (unset)` if `VOXIMPLANT_CONNECTION_NODE` is not set
- **Error phase** — `before-conference-join` or `after-conference-join`

The scenario log prefix tells you which file is running:
- `[neg-conf]` → baseline scenario
- `[neg-conf-rec]` → recording scenario

If you are testing video-only, ensure the baseline is pasted. If testing recording,
ensure the recording scenario is pasted.

### Step 2 — Verify ConferenceEvents.Failed is not in the active scenario

The previous root cause: the scenario registered `ConferenceEvents.Failed`, which is
**undefined in VoxEngine 7.50.0**. This caused:
```
JS error: conferenceEvent is undefined
```
and terminated the scenario, producing 502 Bad Gateway in the browser.

Both `neg-conf.video-only.baseline.js` and `neg-conf.recording.scenario.js` never
reference `ConferenceEvents.Failed`. If an old version is pasted, repaste the correct file.

### Step 3 — Remove VOXIMPLANT_CONNECTION_NODE

Wrong node = immediate 502 or failed login. Leave unset for auto selection.
Diagnostics should show **Configured node: auto (unset)**.

### Step 4 — Check routing rule

Applications → negotaitions-video-poc → Routing rules → `negotaitions-conference-rule`
must point to `neg-conf`.

### Step 5 — Verify users

Applications → negotaitions-video-poc → Users: all three users must exist.
Full username: `participant-a@negotaitions-video-poc.<account>.voximplant.com`.

---

## Known blockers and assumptions

### SDK message sending (`conference.sendMessage`)

The Voximplant WebSDK conference module (`@voximplant/websdk/modules/conference-manager`)
may or may not expose `sendMessage()` on the conference object.

- If `sendMessage` is available: buttons work; status updates from scenario replies.
- If `sendMessage` is unavailable: the panel shows `status: api_not_confirmed` with a
  clear error. Check the Diagnostics panel → **Last SDK event** field for the exact message.

**If `sendMessage` is not available:** Alternatives are:
1. Enable autostart in the scenario: change `RECORDING_AUTOSTART = false` → `true`
   at the top of `neg-conf.recording.scenario.js`. Recording will start automatically
   when ≥ 2 participants join.
2. Use the Voximplant Management API from the backend (requires implementing
   `/api/voximplant-test/recording/start` with real Management API calls).

### `MessageReceived` reply delivery

When VoxEngine calls `call.sendMessage(reply)`, the browser receives it via
`conference.addEventListener('MessageReceived', ...)`. If this event is not emitted
by the conference module, the Recording panel status will not auto-update, but the
command is still sent and VoxEngine logs will confirm recording started.

### Recording API (`VoxEngine.createRecorder` / `conference.sendMediaTo`)

`VoxEngine.createRecorder(options)` and `conference.sendMediaTo(recorder)` are used in the
scenario. If either is not available in the target VoxEngine version, the scenario logs:
```
[neg-conf-rec] VoxEngine.createRecorder not a function — recording unavailable.
```
or
```
[neg-conf-rec] conference.sendMediaTo not a function — recording unavailable.
```
and sends `status: error` back to the browser. The video conference is **not affected**.

Recording is audio-only. The file format depends on `RECORDING_AUDIO_MODE` at the top of
`neg-conf.recording.scenario.js`:
- `"lossless"` → FLAC (preferred for SpeechKit ASR transcription)
- `"hd_mp3"` → MP3 at high bitrate

### Client audio capture (`voximplant-test-client.tsx`)

The Voximplant WebSDK's `streamManager.createAudioStream({ audioProcessing: true })`
already enables the browser's built-in WebRTC audio processing pipeline, which includes:
- **Echo cancellation** — removes speaker playback from the microphone signal
- **Noise suppression** — filters background noise
- **Auto gain control** — normalizes microphone input level

Individual WebRTC `MediaTrackConstraints` (e.g. `echoCancellation`, `noiseSuppression`,
`autoGainControl`) cannot be passed through the Voximplant SDK's `createAudioStream` API —
the type only accepts `{ audioProcessing: boolean }`. Bypassing it with a direct
`getUserMedia()` call would create an unmanaged track outside the SDK lifecycle and is
not safe. `audioProcessing: true` is the recommended setting.

---

### Storage

S3-compatible storage (Yandex Object Storage) must be configured in Voximplant Console
under **Application → Recording storage** before recording files go to S3.
If not configured, files go to Voximplant cloud — check Call History → Recordings.

### Production blockers

- RF media routing confirmation
- RF recording storage confirmation
- 152-FZ compliance confirmation
- Recording file retrieval flow
- Facilitator identity verification in VoxEngine scenario
- Replace static login with one-time key login flow

---

## Audio-only recording test matrix

Set `RECORDING_AUDIO_MODE` at the top of `neg-conf.recording.scenario.js`, repaste into
Voximplant Console, then run each test below.
Fill in the results after each recording.

### Test A — audio-only lossless FLAC (`RECORDING_AUDIO_MODE = "lossless"`)

| Field | Result |
|---|---|
| File format | `.flac` (expected) |
| File size | _fill after test_ |
| Duration | _fill after test_ |
| Participant A audible? | _fill after test_ |
| Participant B audible? | _fill after test_ |
| SpeechKit transcription quality | _fill after test_ |
| Notes | |

**VoxEngine options used:**
```js
{ video: false, lossless: true, name: "negotaitions-audio-only", recordNamePrefix: "voximplant/audio/" }
```

### Test B — audio-only HD MP3 (`RECORDING_AUDIO_MODE = "hd_mp3"`)

| Field | Result |
|---|---|
| File format | `.mp3` (expected) |
| File size | _fill after test_ |
| Duration | _fill after test_ |
| Participant A audible? | _fill after test_ |
| Participant B audible? | _fill after test_ |
| SpeechKit transcription quality | _fill after test_ |
| Notes | |

**VoxEngine options used:**
```js
{ video: false, hd_audio: true, name: "negotaitions-audio-only", recordNamePrefix: "voximplant/audio/" }
```

### Mode comparison

| | lossless FLAC | hd MP3 |
|---|---|---|
| Expected format | `.flac` | `.mp3` |
| Audio quality | Lossless (best for ASR) | High-quality lossy |
| File size (relative) | Larger | Smaller |
| SpeechKit WER | _fill_ | _fill_ |
| Preferred for transcription? | **Yes** | Fallback |
