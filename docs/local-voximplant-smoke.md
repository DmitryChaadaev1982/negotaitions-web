# Local Voximplant Smoke PoC

This document describes the standalone Voximplant video-only smoke PoC and the
experimental recording feature that is layered on top of it.

**Current state: stable video-only baseline + experimental flag-gated recording.**

---

## Scope and safety

- The smoke UI is isolated at `/voximplant-test`.
- Existing `room/[sessionId]` LiveKit flow is **unchanged**.
- This flow is local/dev only and intentionally not production-safe.
- Static browser credentials are used only for local PoC validation.

---

## Stable video-only baseline

The baseline scenario is:

```
docs/voximplant/neg-conf.video-only.baseline.js
```

This file is the source of truth for the working 3-user conference.
It was tagged in git as `checkpoint/voximplant-video-only-stable`.

**To restore the baseline at any time:**

### Option A — paste the file

1. Open [Voximplant Console](https://manage.voximplant.com).
2. Go to **Applications → negotaitions-video-poc → Scenarios → neg-conf**.
3. Replace the ENTIRE content with `docs/voximplant/neg-conf.video-only.baseline.js`.
4. Save.

### Option B — git checkout

```bash
git show checkpoint/voximplant-video-only-stable:docs/voximplant/neg-conf.scenario.js
```

This prints the exact scenario text. Paste it into Voximplant Console.

---

## Recording — experimental and flag-gated

Recording is **disabled by default**. The baseline video-only flow is never affected
by recording flags.

| Flag | Default | Effect when true |
|---|---|---|
| `VOXIMPLANT_RECORDING_PANEL_ENABLED` | `false` | Shows recording panel in UI (facilitator only) |
| `VOXIMPLANT_RECORDING_ENABLED` | `false` | Guards recording runtime flag |
| `VOXIMPLANT_RECORDING_STORAGE` | unset | Determines storage hint in backend status API |

When both flags are `false` (the default):
- No recording panel is rendered.
- No recording API calls are made.
- No recording messages are sent or listened for.
- Join flow is identical to the video-only baseline.

---

## How to enable the recording panel for local testing

Set in `.env.local` (do **not** commit):

```env
VOXIMPLANT_RECORDING_PANEL_ENABLED=true
VOXIMPLANT_RECORDING_ENABLED=true
VOXIMPLANT_RECORDING_STORAGE=s3
```

These flags alone do not start recording. They only:
1. Show the recording panel in the UI for the Facilitator role.
2. Allow the backend recording status routes to respond with diagnostics.

Recording itself is controlled by the VoxEngine scenario running in Voximplant Console
(see "Which scenario to paste" below).

---

## Which scenario file to paste

| Situation | Paste this file |
|---|---|
| Normal video-only smoke test | `docs/voximplant/neg-conf.video-only.baseline.js` |
| Recording test | `docs/voximplant/neg-conf.recording.scenario.js` |

**The recording scenario must not be left in Voximplant Console** when you are not
actively testing recording. Revert to the baseline when done.

Steps to paste the recording scenario:

1. Open [Voximplant Console](https://manage.voximplant.com).
2. Go to **Applications → negotaitions-video-poc → Scenarios → neg-conf**.
3. Replace ENTIRE content with `docs/voximplant/neg-conf.recording.scenario.js`.
4. Save.
5. Confirm routing rule `negotaitions-conference-rule` still points to `neg-conf`.
6. Restart or rejoin the local UI.

---

## How to revert to video-only after a recording test

1. Open Voximplant Console → **Scenarios → neg-conf**.
2. Replace ENTIRE content with `docs/voximplant/neg-conf.video-only.baseline.js`.
3. Save.
4. In `.env.local`, set or leave:
   ```env
   VOXIMPLANT_RECORDING_PANEL_ENABLED=false
   ```
5. Restart the dev server.
6. Rejoin — no recording panel should appear, conference works as before.

---

## Voximplant Console setup

- **Application:** `negotaitions-video-poc`
- **Users:** `participant-a`, `participant-b`, `facilitator`
- **Scenario:** `neg-conf`
- **Routing rule:** `negotaitions-conference-rule` (must point to `neg-conf`)
- **Service account:** `negotaitions-video-poc-api` (JSON key is local, outside repo)

## Required env variables

Set these in local env (`.env.local`, do not commit):

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

Optional (leave unset unless you have a specific reason to override):

```env
# Leave unset — the SDK will auto-select the correct node for your account.
# Only set this if Voximplant Support explicitly tells you which node to use.
# Wrong node is the #1 cause of 502 Bad Gateway.
# VOXIMPLANT_CONNECTION_NODE=NODE_1

# Override the conference name used for the smoke test (default: negotiations-smoke-poc)
# VOXIMPLANT_TEST_CONFERENCE_NAME=negotiations-smoke-poc

# Minimal join mode is true by default. Set false only to test advanced features.
# VOXIMPLANT_MINIMAL_JOIN_MODE=true
```

---

## Run local smoke test

```bash
npm install
npm run dev
```

Open: `http://localhost:3000/voximplant-test`

---

## 3-window role validation

Open three separate browser windows (or separate browser profiles):

1. Window 1: select **Participant A** → **Join conference**
2. Window 2: select **Participant B** → **Join conference**
3. Window 3: select **Facilitator** → **Join conference**

Expected behavior:

- All three users join the same conference name (`negotiations-smoke-poc` by default).
- Local video renders in each window.
- Remote participant videos appear as they join.
- Audio mute/unmute works.
- Camera on/off works.
- Facilitator joins with muted microphone by default.
- **Diagnostics** panel (expandable, below controls) shows:
  - role, username, domain, application name, conference name
  - configured node (`auto (unset)` if VOXIMPLANT_CONNECTION_NODE is not set)
  - connected node, connection state, last SDK event, last error code/reason
  - **scenario in use** (baseline vs recording)
  - **recording panel** (enabled/disabled)
  - **error phase** (before-conference-join vs after-conference-join, if error occurred)
- No recording panel is visible when `VOXIMPLANT_RECORDING_PANEL_ENABLED=false`.

---

## How to check Voximplant Call History logs

1. Open [Voximplant Console](https://manage.voximplant.com).
2. Go to **Applications → negotaitions-video-poc → Logs** (or **Call History**).
3. Trigger a join attempt and refresh the logs.
4. Look for the log prefix `[neg-conf]` (baseline) or `[neg-conf-rec]` (recording scenario).

For the baseline, the expected log sequence is:

```
[neg-conf] ... Scenario started
[neg-conf] ... Conference started
[neg-conf] ... Incoming call. callId=... destination=... scheme=...
[neg-conf] ... Participant joined. callId=... endpointId=...
```

For the recording scenario, additionally look for:

```
[neg-conf-rec] ... Recording scenario started.
[neg-conf-rec] ... Recording start requested.
[neg-conf-rec] ... Recording started. url=https://...
[neg-conf-rec] ... Recording stopped.
```

If you see `Conference failed` or a JS exception in the logs, the scenario in Console
is wrong — repaste the correct file.

---

## How to check Yandex Object Storage

After a recording session ends (facilitator stops recording or the conference closes):

1. Open [Yandex Cloud Console](https://console.yandex.cloud).
2. Go to **Object Storage → `negotaitions-recordings-dev-bucket`**.
3. Look for a new file with a `.mp4` or `.webm` extension.
4. The file path or URL should match what appeared in VoxEngine logs as `url=...`
   from the `RecorderEvents.Started` event.

If no file appears:
- Recording destination may be Voximplant cloud, not S3.
  Check **Voximplant Console → Applications → negotaitions-video-poc → Recording storage**.
- If S3 is not configured there, recording goes to Voximplant cloud.
  Use **Call History → Recordings** to find the file.
- Document as temporary fallback; do not claim S3 is working until a file appears
  in the Yandex Object Storage bucket.

---

## 502 Bad Gateway — root cause checklist

When you see "502 Bad Gateway" in the UI or in browser console, work through this list
in order. The Diagnostics panel now shows **Scenario in use**, **Recording panel**,
**Configured node**, and **Error phase** to help isolate the cause.

### Step 1 — Check which scenario is in Voximplant Console

The scenario in Console must match what you are testing:

- **Normal video-only test** → paste `docs/voximplant/neg-conf.video-only.baseline.js`
- **Recording test** → paste `docs/voximplant/neg-conf.recording.scenario.js`

A mismatch (e.g., an old recording scenario with `ConferenceEvents.Failed`) will crash
the scenario and cause 502.

1. Open Voximplant Console → **Scenarios → neg-conf**.
2. Verify the content.
3. Save the correct file.
4. Retry.

### Step 2 — Verify the routing rule

1. In Voximplant Console, go to **Applications → negotaitions-video-poc → Routing rules**.
2. Confirm rule `negotaitions-conference-rule` exists and is bound to scenario `neg-conf`.
3. If the rule is missing or points to a different scenario, update it.
4. Retry.

### Step 3 — Remove VOXIMPLANT_CONNECTION_NODE

Wrong node = immediate 502 or failed login. The SDK auto-selects the correct node
when no node is forced.

1. Open `.env.local`.
2. Remove or comment out `VOXIMPLANT_CONNECTION_NODE`.
3. Restart the dev server (`npm run dev`).
4. Retry.
5. Diagnostics panel should show **Configured node: auto (unset)**.

Only add `VOXIMPLANT_CONNECTION_NODE` back if Voximplant Support explicitly tells you
which node your account is on.

### Step 4 — Check VoxEngine scenario logs

1. In Voximplant Console, go to **Applications → negotaitions-video-poc → Logs**.
2. Trigger a join attempt and refresh the logs.
3. If you see `Conference failed` or a JS exception, the scenario is wrong — repaste.
4. If there are no logs at all, the routing rule is not bound to the scenario.

**Known crash: `conferenceEvent is undefined`**

This means the scenario tried to register `ConferenceEvents.Failed`, which is undefined
in VoxEngine 7.50.0. Fix: repaste the correct baseline or recording scenario — both are
written to never register `ConferenceEvents.Failed`.

### Step 5 — Check recording scenario is not left in Console by mistake

If you previously tested recording and left `neg-conf.recording.scenario.js` in Console,
but are now running with `VOXIMPLANT_RECORDING_PANEL_ENABLED=false`, the scenario will
still try to run recording. Revert to the baseline scenario.

### Step 6 — Verify user accounts and application membership

1. In Voximplant Console, go to **Applications → negotaitions-video-poc → Users**.
2. Confirm all three users exist: `participant-a`, `participant-b`, `facilitator`.
3. Verify the full username format used by the SDK:

   ```
   participant-a@negotaitions-video-poc.<account>.voximplant.com
   ```

4. Verify `VOXIMPLANT_USER_DOMAIN` in `.env.local` matches the domain shown in Console.

### Step 7 — Verify all roles use the same conference name

1. Join as Participant A — note conference name in Diagnostics.
2. Join as Participant B — note conference name in Diagnostics.
3. Join as Facilitator — note conference name in Diagnostics.
4. All three must be identical (e.g. `negotiations-smoke-poc`).
5. If they differ, check `VOXIMPLANT_TEST_CONFERENCE_NAME` in `.env.local` or remove it
   to use the default.

### Step 8 — If 502 persists despite all steps above

Use the Diagnostics panel to collect:

| Field | What to report |
|---|---|
| Scenario in use | baseline vs recording |
| Recording panel | enabled vs disabled |
| Configured node | value or "auto (unset)" |
| Connected node | value or "—" |
| Error phase | before-conference-join vs after-conference-join |
| Last error | full error code and reason |
| VoxEngine logs | full log output for the session |

Provide all of the above to Voximplant Support.

---

## Known blockers and assumptions

### Recording API

- `conference.record(options)` is documented in VoxEngine, but the exact parameter
  signature and behavior in VoxEngine 7.50.0 has not been validated in this PoC.
  Both `singleFile` and `video` options are included but marked with TODO comments
  in the recording scenario.
- `RecorderEvents.Error` existence is uncertain. The recording scenario wraps it in
  a nested try/catch so that a missing constant does not affect the conference.
- `recorder.stop()` is used to stop recording. The alternative `recorder.stopRecord()`
  may be the correct method name depending on VoxEngine version.
- **Action required:** Test the recording scenario in Voximplant Console, observe
  VoxEngine logs for `Recording started. url=...` and confirm the API works.

### Browser-to-scenario messaging

- `CallEvents.MessageReceived` is a standard VoxEngine event. The recording scenario
  adds it per-call, guarded with try/catch.
- The browser-side send API (`conference.sendMessage()` or similar) is not confirmed
  in the current `@voximplant/websdk` conference module.
- The recording panel currently calls backend API routes that return scenario-controlled
  status (not live Management API calls). The actual recording start/stop happens inside
  the VoxEngine scenario via autostart or manual paste.

### Storage

- S3-compatible storage (Yandex Object Storage) must be configured in Voximplant Console
  under **Application → Recording storage** before recording files go to S3.
- If not configured, recording files go to Voximplant cloud. Treat this as a temporary
  fallback — do not claim S3 is working until a file appears in the bucket.

### Production blockers

- RF media routing confirmation
- RF recording storage confirmation  
- 152-FZ compliance confirmation
- Recording file retrieval flow
- Separate audio tracks or speaker metadata support
- Replace static login with one-time key login flow

---

## Known limitations

- Static browser credentials are returned by local API route for PoC convenience.
- This is not production-safe authentication.
- `VOXIMPLANT_CONNECTION_NODE` should remain **unset** — wrong value causes 502.
- No automated role provisioning in Voximplant (uses pre-created test users).
- No production room/session integration yet.
- Recording start/stop from the browser-side recording panel posts to local backend
  routes which return diagnostics only — they do not yet call the Management API.
