# Local Voximplant Smoke PoC

This document describes the first standalone Voximplant smoke test in this repository.

## Scope and safety

- The smoke UI is isolated at `/voximplant-test`.
- Existing `room/[sessionId]` LiveKit flow is unchanged.
- This flow is local/dev only and intentionally not production-safe.
- Static browser credentials are used only for local PoC validation.

## Voximplant Console setup used

- **Application:** `negotaitions-video-poc`
- **Users:** `participant-a`, `participant-b`, `facilitator`
- **Scenario:** `neg-conf`
- **Routing rule:** `negotaitions-conference-rule` (bound to `neg-conf`)
- **Service account:** `negotaitions-video-poc-api` (JSON key is local, outside repo)
- **Recording storage:** Yandex Object Storage configured as S3-compatible storage
  - Endpoint: `https://storage.yandexcloud.net`
  - Bucket is configured in Voximplant Console, not hardcoded in app

## Required env variables

Set these in local env (for example, `.env.local`, but do not commit it):

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
VOXIMPLANT_API_KEY_PATH=...

VOXIMPLANT_RECORDING_ENABLED=true
VOXIMPLANT_RECORDING_VIDEO=true
VOXIMPLANT_RECORDING_STORAGE=s3
```

Additional optional local vars used by this PoC:

```env
VOXIMPLANT_CONNECTION_NODE=NODE_1
VOXIMPLANT_TEST_CONFERENCE_NAME=negotiations-smoke-poc
```

## Paste scenario into Voximplant Console

1. Open Voximplant Console.
2. Go to **Applications -> negotaitions-video-poc -> Scenarios**.
3. Open scenario `neg-conf` (or create it if missing).
4. Copy-paste content from:
   - `docs/voximplant/neg-conf.scenario.js`
5. Save scenario.
6. Ensure routing rule `negotaitions-conference-rule` points to `neg-conf`.

## Run local smoke test

1. Install deps:
   - `npm install`
2. Start app:
   - `npm run dev`
3. Open:
   - `http://localhost:3000/voximplant-test`
4. Pick role and click **Join conference**.

## 3-window role validation

Open three separate browser windows (or separate browser profiles):

1. Window 1: select **Participant A**, join.
2. Window 2: select **Participant B**, join.
3. Window 3: select **Facilitator**, join.

Expected smoke behavior:

- All three users can join the same conference name.
- Local video renders in each window.
- Remote participant videos appear as they join.
- Audio mute/unmute works.
- Camera on/off works by adding/removing local video stream.
- Facilitator joins with muted microphone request by default.
- Status/error panel provides actionable diagnostics.

## Recording status in this PoC

- Dedicated start/stop recording API routes are **not** implemented in this initial smoke pass.
- Recording should be handled in VoxEngine scenario logic or a later server-side Management API integration once exact API behavior is confirmed.
- Current `docs/voximplant/neg-conf.scenario.js` includes TODOs for safe recording enablement.

## Known limitations

- Static browser credentials are returned by local API route for PoC convenience.
- This is not production-safe authentication.
- `VOXIMPLANT_CONNECTION_NODE` must match your account routing; wrong value causes connect/login failures.
- No automated role provisioning in Voximplant (uses pre-created test users).
- No production room/session integration yet.

## Production blockers checklist

- RF media routing confirmation
- RF recording storage confirmation
- 152-FZ compliance confirmation
- Recording file retrieval flow
- Separate audio tracks or speaker metadata support
- Replace static login with one-time key login flow
