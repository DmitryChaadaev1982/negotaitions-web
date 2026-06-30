# Voximplant integration: negotiation room (Stages 1-4.1)

## Scope of Stage 1

Stage 1 adds only additive infrastructure:

- video provider switch helper (`VIDEO_PROVIDER`);
- server-side Voximplant config readers;
- documentation of the chosen Stage 4 identity model.

Stage 1 intentionally does **not** change runtime behavior in the negotiation room (`/room/[sessionId]`), does not touch event lobby behavior, and does not modify existing LiveKit flows.

## Scope of Stage 2

Stage 2 adds a shared typed browser <-> VoxEngine scenario message contract:

- `lib/voximplant/scenario-messages.ts`;
- typed `recording_control` and `recording_status` messages;
- small parse/validation/helper functions.

Stage 2 is additive only and intentionally does **not** change runtime behavior.
There is no routing switch for the negotiation room yet.

## Scope of Stage 3

Stage 3 adds a production-oriented VoxEngine scenario artifact for later manual deployment:

- `docs/voximplant/neg-conf.main-room.scenario.js`

This is a source/documentation artifact only. It is not wired into app runtime in this stage.

## Scope of Stage 4

Stage 4 adds backend foundation for durable provider identity and session-scoped access:

- `VideoProviderIdentity` Prisma model;
- additive migration for provider identity storage;
- on-demand identity provisioning service boundary;
- session-scoped endpoint: `POST /api/sessions/[sessionId]/voximplant/access`.

Stage 4 still does not switch the negotiation room UI runtime from LiveKit to Voximplant.

## Scope of Stage 4.1

Stage 4.1 hardens provider identity and adds secure browser auth handoff primitives:

- hash-based provider usernames (`ng_u_<sha256(userId).slice(0, 16)>`);
- server-side one-time key token exchange flow for browser login;
- Management API-backed remote user provisioning and password rotation boundary.

This stage still does not change negotiation room UI runtime and does not modify LiveKit behavior.

## Scope of Stage 5.4 / 5.4.1

Stage 5.4 implements the Voximplant recording completion handoff to the canonical `Recording.fileKey` and the existing Yandex SpeechKit pipeline.

Stage 5.4.1 fixes wiring blockers: canonical conference naming (`negotiation-{sessionId}`), reliable sessionId in scenario/webhook messages, DB-backed refresh, consent gating, and accurate handoff flags.

### Canonical conference naming

The negotiation room Voximplant conference name is:

```
negotiation-{sessionId}
```

Helpers in `lib/voximplant/conference-name.ts`:

- `buildVoximplantConferenceName(sessionId)` — used by access route and recording dispatch
- `parseSessionIdFromVoximplantConferenceName(conferenceName)` — used by scenario artifact

Do **not** use `ng-session-{sessionId}` or `VoxEngine.applicationName()` for sessionId resolution.

### Recording start/stop relay flow

1. Facilitator clicks "Начать запись" (Start recording) in the room.
2. Browser shows the shared recording consent modal; user must confirm explicitly.
3. Browser calls `POST /api/sessions/{sessionId}/recording-control` with `{ action: "start", recordingConsentConfirmed: true, participantId/joinToken }`.
4. Server validates facilitator permission, builds a typed `RecordingControlMessage` with `sessionId`, `conferenceName`, and `requestId`, and returns it in `{ scenarioMessage }`.
5. Browser relays `JSON.stringify(scenarioMessage)` unchanged to the Voximplant conference via `conference.sendMessage()`.
6. VoxEngine scenario resolves `sessionId` from the message (not from `applicationName`), validates authorization, and calls `VoxEngine.createRecorder(...)` with audio-only options.
7. When `RecorderEvents.Started` fires, the scenario sends a `recording_status` message back to the browser AND sends a signed webhook to the server.
8. Stop recording follows the same relay flow with `action: "stop"`.

### Scenario message fields (recording_control)

Server-built `scenarioMessage` includes:

| Field | Purpose |
|---|---|
| `type` | `"recording_control"` |
| `action` | `"start"` \| `"stop"` \| `"status"` |
| `requestId` | Correlation id (nanoid) |
| `sessionId` | Application session id (from URL/route; not used alone for webhook auth) |
| `conferenceName` | Canonical `negotiation-{sessionId}` for scenario-side parsing |
| `participantId` | Optional facilitator participant id |
| `role` | Optional VoxRoomRole hint (untrusted; scenario auth is separate) |

Scenario sessionId resolution order:

1. `recording_control.message.sessionId`
2. parse from `recording_control.message.conferenceName`
3. fail closed with `SESSION_ID_UNRESOLVED` error status

### Refresh behavior (Voximplant)

`POST /api/sessions/{sessionId}/recording-control` with `action: "refresh"`:

- Does **not** dispatch a scenario message
- Reads the canonical `Recording` DB row for the session
- Returns `{ ok: true, provider: "voximplant", recording: { status, errorMessage } }`
- Returns `{ status: "NOT_STARTED", errorMessage: null }` when no row exists yet
- Sets `fileKeyHandoff: "webhook"` and `fileKeyHandoffDeferred: false`

LiveKit refresh behavior is unchanged (reads DB + calls `refreshRecordingStatus`).

### Webhook endpoint

```
POST /api/sessions/{sessionId}/voximplant/recording-status
```

Authentication: `X-Voximplant-Signature: hmac-sha256={hex_signature}`
- HMAC is computed over the raw JSON request body using `VOXIMPLANT_RECORDING_WEBHOOK_SECRET`.
- Requests without a valid signature are rejected with HTTP 401.
- Requests when the secret is not configured are rejected with HTTP 503.

### Webhook secret environment variable

```
VOXIMPLANT_RECORDING_WEBHOOK_SECRET=<random-secret-min-32-chars>
```

- **Server-side only** — never exposed to browser code.
- Required on the Next.js server and as a VoxEngine scenario environment variable (`WEBHOOK_SECRET`).
- Set the same value in both places.
- Example local `.env.local` value: `VOXIMPLANT_RECORDING_WEBHOOK_SECRET=changeme_replace_with_32char_secret`
- Do not commit the real secret.

### Scenario webhook environment variables (Voximplant Console)

Set these as VoxEngine application environment variables in the Voximplant Console:

| Variable | Value |
|---|---|
| `WEBHOOK_BASE_URL` | Public URL of your Next.js app (e.g. `https://yourapp.example.com`) |
| `WEBHOOK_SECRET` | Same value as `VOXIMPLANT_RECORDING_WEBHOOK_SECRET` on the server (alias: `VOXIMPLANT_RECORDING_WEBHOOK_SECRET`) |

### Status mapping

| Voximplant scenario status | Canonical `RecordingStatus` in DB |
|---|---|
| `starting` | `STARTING` |
| `recording` | `RECORDING` |
| `paused` | `RECORDING` |
| `resuming` | `RECORDING` |
| `stopping` | `STOPPED` |
| `stopped` (no fileKey) | `STOPPED` |
| `stopped` (with fileKey) | `COMPLETED` |
| `error` | `FAILED` |
| `idle` / `not_recording` | `NOT_STARTED` (no row created) |

### objectKey → Recording.fileKey mapping

Yandex Object Storage recording URL format:
```
https://storage.yandexcloud.net/{bucket}/{objectPath}
```

The VoxEngine scenario's `normalizeObjectKeyFromUrl()` extracts everything after `.net/`:
```
{bucket}/{objectPath}
```

The webhook handler strips the configured `S3_BUCKET` prefix to derive the `fileKey`:
```
{objectPath}   ← stored as Recording.fileKey
```

The resulting `fileKey` matches the format used by LiveKit recordings (`recordings/{sessionId}/{timestamp}-audio.mp4`) and is compatible with:
- `downloadObjectToBuffer(fileKey)` — used by Yandex SpeechKit transcription
- `getSignedDownloadUrl(fileKey)` — used by `/materials/status` to generate download links
- `headObject(fileKey)` — used for storage validation

If `S3_BUCKET` is not configured or the objectKey does not start with the bucket prefix, the objectKey is used as-is.

### Idempotency strategy

- `Recording.sessionId` is unique in the schema — one recording per session.
- The webhook handler uses upsert semantics: `findUnique` + `create` or `update`.
- Duplicate webhooks for the same status are handled by the state machine:
  - `COMPLETED` cannot be overwritten by any non-COMPLETED status.
  - `FAILED` can only be updated to another `FAILED` or `COMPLETED`.
  - `STOPPED` can only be updated to `STOPPED` or `COMPLETED`.
- A `stopped` webhook with `objectKey` that arrives after a `stopped` webhook without `objectKey` will upgrade the status from `STOPPED` to `COMPLETED` and set `fileKey`.
- `idle` / `not_recording` webhooks do not create a Recording row if none exists.

### Conference name → sessionId mapping

The VoxEngine conference name is `negotiation-{sessionId}` (see `lib/voximplant/conference-name.ts`).

The scenario resolves `sessionId` from the server-built `recording_control` message:

```js
// Priority: message.sessionId → parse message.conferenceName → fail closed
resolvedSessionId = resolveSessionId(payload);
```

`VoxEngine.applicationName()` is **not** used — it returns the static Voximplant application name, not the per-session conference name.

### Manual smoke-test steps

**Prerequisites:**
1. `VIDEO_PROVIDER=voximplant` in env.
2. `VOXIMPLANT_RECORDING_WEBHOOK_SECRET` set to a non-empty value on both server and in Voximplant Console (`WEBHOOK_SECRET`).
3. `WEBHOOK_BASE_URL` set to your app's public URL in Voximplant Console.
4. VoxEngine scenario updated with Stage 5.4 artifact and deployed.
5. `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` configured.

**Steps:**
1. Facilitator joins room via `VIDEO_PROVIDER=voximplant`.
2. Navigate to `/room/{sessionId}`.
3. Confirm `RecordingIndicator` shows no status (no Recording row yet).
4. Facilitator clicks "Начать запись".
5. Confirm browser calls `POST /api/sessions/{id}/recording-control` → `{ ok: true, provider: "voximplant", scenarioMessage: {...} }`.
6. Confirm `conference.sendMessage()` relay does not throw an error.
7. Confirm VoxEngine logs show `recording_control action=start` received.
8. Confirm VoxEngine sends webhook; server logs show `[vox-recording-webhook] ... action: created`.
9. Confirm `RecordingIndicator` updates to `STARTING` → `RECORDING` within polling interval (~1s).
10. Facilitator clicks "Остановить запись".
11. Confirm VoxEngine sends `stopped` webhook with `objectKey`.
12. Confirm server logs show `action: updated status: COMPLETED`.
13. Confirm `Recording.fileKey` is populated (visible in `/materials/{sessionId}` for facilitator).
14. Confirm `/materials/status` response shows `canStart: true` for transcription.
15. Optionally start Yandex SpeechKit transcription — should succeed using `fileKey`.

**LiveKit regression (run separately with `VIDEO_PROVIDER=livekit`):**
1. Start/finish negotiation with LiveKit provider.
2. Verify recording behavior unchanged (controlled via negotiation lifecycle).
3. Verify `materials/status` still enables transcription after completed LiveKit recording.
4. Verify Yandex SpeechKit flow unchanged.

### Security checklist

- Non-facilitator cannot start/stop recording: `recording-control` validates `ParticipantType.FACILITATOR`.
- Webhook without secret → HTTP 401.
- Webhook with wrong secret → HTTP 401 (constant-time comparison via `timingSafeEqual`).
- Browser responses do not include `VOXIMPLANT_RECORDING_WEBHOOK_SECRET`.
- `scenarioMessage` does not include Management API secrets.
- `fileKey` is only returned to facilitators in `/materials/status`.

### Limitations (as of Stage 5.4.1)

- VoxEngine scenario artifact (`docs/voximplant/neg-conf.main-room.scenario.js`) must be **manually deployed** to Voximplant Console for runtime testing.
- No real-time push from server to browser — recording state updates via 1-second polling of `/control-state`.
- Browser `sendMessage` availability depends on the Voximplant WebSDK version; if unavailable, a UI error is shown and recording is blocked.
- VoxEngine `crypto.createHmac()` availability depends on VoxEngine runtime version — if unavailable, webhooks are silently skipped and recording still works (server won't receive status updates in that case).
- No automatic retry for failed webhooks — transient network errors may cause missed status updates (recording still works on Voximplant side).
- No visible pause/resume recording UI (pause/resume may exist internally in scenario only).
- Remote active speaker mapping deferred to Stage 5.5+.
- Duplicate-user lock deferred to Stage 5.5+.
- `STRICT_RECORDING_CONTROLLER_AUTH` may remain `false` in development; production requires trusted identity wiring.

## Scope of Stage 5

Stage 5 wires the Voximplant client into the negotiation room (`/room/[sessionId]`) behind the provider flag while preserving the existing LiveKit path.

### Provider switch location

The provider boundary is implemented in:

- `app/room/[sessionId]/page.tsx`

Flow:

- resolve authenticated participant exactly as before;
- render `VideoRoomPage` for `VIDEO_PROVIDER=livekit` (and fallback values);
- render `VoximplantNegotiationRoomPage` for `VIDEO_PROVIDER=voximplant`.

This keeps lobby behavior unchanged and avoids touching existing LiveKit internals.

### One-time-key browser auth flow (implemented)

In `VIDEO_PROVIDER=voximplant` negotiation room runtime:

1. browser calls `POST /api/sessions/[sessionId]/voximplant/access` with empty body;
2. backend returns `credentials.status = "one_time_key_required"` and exact `user.sdkUsername`;
3. browser initializes Voximplant WebSDK and calls `client.requestOneTimeKey({ username: sdkUsername })`;
4. browser posts `{ oneTimeKey }` to the same endpoint;
5. backend returns `credentials.status = "ready"` with `credentials.oneTimeKeyHash`;
6. browser logs in using `client.loginOneTimeKey({ username: sdkUsername, hash: oneTimeKeyHash })`.

Security notes:

- browser uses the exact backend `sdkUsername` without rebuilding it;
- password login is not used in negotiation room flow;
- one-time-key hash is never rendered in UI diagnostics;
- PoC endpoint `/api/voximplant-test/access` is not used.

### New Stage 5 client files

- `components/voximplant-negotiation-room-page.tsx`
- `components/voximplant-video-layout.tsx`
- `components/voximplant-room-sidebar.tsx`
- `lib/voximplant/use-voximplant-room.ts`

### Conference join behavior

- conference name is always derived from backend `roomNameOrConferenceName`;
- all participants in the same session join that shared conference name;
- participant role is kept in client state (`participant_a`, `participant_b`, `facilitator`, `observer`, `unknown`);
- facilitator joins muted by default.

### Stage 5 media controls

Implemented:

- microphone mute/unmute;
- camera on/off;
- disconnect/leave.

Deferred:

- recording controls and recording asset handoff (Stage 6);
- Yandex transcription / DeepSeek post-processing triggers from Voximplant recordings;
- guest Voximplant browser access.

### Sidebar and privacy behavior

Stage 5 Voximplant page reuses existing room sidebar API data contract:

- sidebar data is loaded from `GET /api/livekit/sidebar` using existing auth path;
- private role briefing visibility remains controlled by existing server-side privacy logic in `lib/room-sidebar.ts`.

### Local enable / rollback

Enable Voximplant negotiation room locally:

- set `VIDEO_PROVIDER=voximplant`;
- ensure required Voximplant env vars are configured (`VOXIMPLANT_ACCOUNT_NAME`, `VOXIMPLANT_APPLICATION_NAME`, `VOXIMPLANT_USER_DOMAIN`, `VOXIMPLANT_SCENARIO_NAME`, `VOXIMPLANT_RULE_NAME`);
- ensure Stage 4 identity migration is already applied in local DB.

Rollback to LiveKit:

- set `VIDEO_PROVIDER=livekit` (or unset `VIDEO_PROVIDER`).

### Known Stage 5 limitations

- recording controls are deferred to Stage 6;
- Yandex SpeechKit pipeline is not triggered by Voximplant Stage 5 wiring;
- DeepSeek transcript cleanup/analysis are not triggered by Voximplant Stage 5 wiring;
- guest Voximplant access is deferred;
- lobby/event lobby remains untouched.

## Provider switch behavior

- `VIDEO_PROVIDER=livekit` is the default/fallback behavior.
- If `VIDEO_PROVIDER` is missing or invalid, the app safely falls back to `livekit`.
- `VIDEO_PROVIDER=voximplant` is accepted as the planned future runtime switch.
- Stage 1 does not route negotiation room traffic to Voximplant yet.

## Negotiation room target

- Production Voximplant integration target: `"/room/[sessionId]"` (переговорная комната).
- `/voximplant-test` remains an isolated PoC page and is not production behavior.
- Event lobby / preliminary event video area is out of scope for this stage.

## Voximplant env variables (future runtime)

Required for Voximplant runtime:

- `VOXIMPLANT_ACCOUNT_NAME`
- `VOXIMPLANT_APPLICATION_NAME`
- `VOXIMPLANT_USER_DOMAIN`
- `VOXIMPLANT_SCENARIO_NAME`
- `VOXIMPLANT_RULE_NAME`

Recording-related flags:

- `VOXIMPLANT_RECORDING_ENABLED`
- `VOXIMPLANT_RECORDING_AUDIO_ONLY` (default: `true`)
- `VOXIMPLANT_RECORDING_AUDIO_MODE` (`lossless` or `hd_mp3`, default: `lossless`)
- `VOXIMPLANT_RECORDING_PAUSE_ENABLED` (defaults to `true` when recording is enabled)

Optional and server-only:

- `VOXIMPLANT_API_KEY_PATH`
- `VOXIMPLANT_RECORDING_STORAGE`

### Management API credential resolution (server-side)

Management API adapter supports two server-only configuration sources.

Resolution order (highest priority first):

1. explicit env vars:
   - `VOXIMPLANT_MANAGEMENT_API_KEY`
   - `VOXIMPLANT_MANAGEMENT_ACCOUNT_ID`
   - `VOXIMPLANT_MANAGEMENT_APPLICATION_ID`
2. fallback JSON from `VOXIMPLANT_API_KEY_PATH` (used only when any required env value is missing).

Supported fallback JSON key aliases:

- API key: `api_key`, `apiKey`, `key`, `token`
- account id: `account_id`, `accountId`, `accountID`
- application id: `application_id`, `applicationId`, `applicationID`

Also supported for service-account JSON keys:

- key id: `key_id`, `keyId`, `keyID`
- private key: `private_key`, `privateKey`

Notes:

- env vars always win over JSON values when both are present;
- `VOXIMPLANT_MANAGEMENT_APPLICATION_ID` from env is valid even if application id is absent in JSON;
- if management application id is missing, backend can resolve it via `GetApplications` using `VOXIMPLANT_APPLICATION_NAME`;
- if fallback JSON contains `account_id + key_id + private_key`, backend uses server-side JWT Bearer auth for Management API requests;
- fallback file is read server-side only and is never exposed to browser responses;
- diagnostics must remain non-secret (no file content, no key values, no raw local file path output).

Security requirements:

- no static PoC credentials in production config;
- no permanent provider secrets returned to browser;
- no service account JSON or Management API secrets exposed to client code.

## Recording defaults and pause/resume

- Recording target format is audio-only by default.
- Default recording mode is `lossless`.
- Planned pause/resume behavior: `ConferenceRecorder.mute(true/false)` unless Voximplant later provides a true pause/resume API.

Stage 2 protocol semantics:

- `pause` maps to `ConferenceRecorder.mute(true)`;
- `resume` maps to `ConferenceRecorder.mute(false)`.

Expected future status state machine:

- `idle` -> `starting` -> `recording` -> `paused` -> `resuming` -> `recording` -> `stopping` -> `stopped`
- failures are represented as `recording_status` with `status=error`.
- message parsing errors must not break the conference session.
- recording failures must not disconnect participants.

## Stage 2 scenario message protocol

Browser -> scenario control messages:

- `type: "recording_control"`
- `action: "start" | "pause" | "resume" | "stop" | "status"`
- `requestId: string`
- optional: `sessionId`, `participantId`, `role`

Scenario -> browser status messages:

- `type: "recording_status"`
- `status: "idle" | "starting" | "recording" | "paused" | "resuming" | "stopping" | "stopped" | "error" | "not_recording"`
- optional: `requestId`, `message`, `recordingUrl`, `recordingId`, `objectKey`, `pausedAt`, `resumedAt`, `errorCode`

Compatibility requirements:

- fully compatible with current PoC shape used by `/voximplant-test`;
- current PoC control payload (`start|stop|status`) remains valid;
- current PoC status payload remains valid.

## Stage 3 scenario artifact

Created file:

- `docs/voximplant/neg-conf.main-room.scenario.js`

How it differs from the PoC scenario:

- keeps the same browser/scenario message compatibility but includes full `start|pause|resume|stop|status`;
- uses an explicit recording state machine with `idle`, `starting`, `recording`, `paused`, `resuming`, `stopping`, `stopped`, `error`;
- includes defensive watchdogs for starting/stopping/resuming;
- isolates recording failures so conference calls continue;
- uses safe event registration helpers to avoid crashes on missing event namespaces/constants;
- adds authorization placeholder flow for recording control with strict mode and development fallback.

Recording behavior in Stage 3 artifact:

- audio-only recording default (`video: false`);
- recording mode supports `lossless` default with `hd_mp3`-style fallback pattern;
- pause/resume implemented via `recorder.mute(true/false)`;
- if `recorder.mute` is unavailable, scenario returns `recording_status` with `status=error` and error code (conference remains active).

Recording URL/object key notes:

- scenario captures `recordingUrl` / `recordingId` when available from recorder events;
- object key extraction in scenario is best effort only;
- reliable `Recording.fileKey` handoff may require later webhook/status integration step.

Facilitator authorization status:

- Stage 3 includes `isAuthorizedRecordingController(...)` placeholder;
- it does **not** claim final production authorization completeness yet;
- payload `role` is treated as untrusted;
- strict auth mode can deny by default without trusted identity evidence.

Production blockers (as of Stage 3):

- finalize trusted facilitator authorization based on Stage 4 identity model (`VideoProviderIdentity` + on-demand provisioning);
- remove or disable development-only fallback before production rollout;
- finalize reliable object-key handoff flow for `Recording.fileKey` persistence.

## Stage 4 identity and access foundation

### VideoProviderIdentity model

Added additive identity storage with:

- provider (`voximplant`);
- local `userId` link;
- durable `providerUsername` and `providerApplicationName`;
- status (`active` | `disabled` | `failed`);
- `lastUsedAt`, `lastProvisioningError`, optional `metadata`.

Uniqueness constraints:

- unique `(provider, userId)`;
- unique `(provider, providerUsername)`.

Migration is additive and safe for later `prisma migrate deploy`.

### On-demand provisioning behavior

When an authenticated active user requests Voximplant access for a negotiation session:

1. backend verifies account auth/status;
2. backend verifies session access using existing access-control rules;
3. backend resolves user participant/role in the negotiation room;
4. backend gets or creates local `VideoProviderIdentity`;
5. remote Voximplant Management API provisioning remains behind a server-only adapter boundary.

No bulk user sync is performed.

### Username strategy

Technical username format:

- `ng_u_<sha256(userId).slice(0, 16)>`

Rules:

- no email in username;
- no raw local userId in username;
- only safe technical characters;
- deterministic per local user.

### Session-scoped endpoint

Added endpoint:

- `POST /api/sessions/[sessionId]/voximplant/access`

Behavior:

- requires authenticated active account;
- rejects unauthorized session access;
- rejects guest-style Voximplant access in this stage;
- resolves role as `participant_a` / `participant_b` / `facilitator` / `observer` / `unknown`;
- returns browser-safe payload only.

Browser-safe payload includes:

- provider/session/user role metadata;
- public connection identifiers (`accountName`, `applicationName`, `userDomain`);
- recording feature flags (`enabled`, `audioOnly`, `audioMode`, `pauseEnabled`).

Stage 4.1 credential handoff format:

- first call returns browser-safe identity/config plus `credentials.status = "one_time_key_required"`;
- browser requests one-time key using Voximplant WebSDK (`client.requestOneTimeKey({ username })`);
- browser calls the same endpoint with `{ oneTimeKey }`;
- backend returns `credentials.status = "ready"` and `credentials.oneTimeKeyHash` for `client.loginOneTimeKey(...)`.

Exact SDK username format:

- `sdkUsername = <providerUsername>@<userDomain>`;
- this exact `sdkUsername` is used for both browser `requestOneTimeKey` and browser `loginOneTimeKey`;
- endpoint returns `user.sdkUsername` and `credentials.sdkUsername` to avoid ambiguity.

One-time hash input note:

- WebSDK login hash formula uses the local user part (`providerUsername`) with `:voximplant.com:` salt;
- backend validates that incoming `sdkUsername` starts with `<providerUsername>@` before hash calculation.

Selected browser auth method:

- one-time key login (`requestOneTimeKey` + backend hash calculation + `loginOneTimeKey`).
- this avoids returning permanent password to browser.

Never returned to browser:

- Management API credentials;
- service account JSON;
- API secrets;
- private role instructions of other users.
- Management API key;
- account/service credentials.

### Remaining Stage 4 blocker

In Stage 4, browser credential/token handoff was intentionally unresolved.

Stage 4.1 update:

- backend one-time key token exchange is implemented;
- remote user provisioning path is implemented via Management API methods (`GetUsers`, `AddUser`, `SetUserInfo`) when management env configuration is present;
- if management API setup is missing, endpoint returns controlled `501` with explicit setup-required code.

### Scenario authorization preparation

Stage 4 identity endpoint provides trusted `providerUsername` mapping foundation.
Future strict scenario authorization should validate recording controllers against trusted identity, not untrusted `payload.role`.

## Yandex pipeline compatibility expectation

Future Voximplant recording integration must keep this provider-agnostic chain intact:

1. Voximplant stores audio in Yandex Object Storage.
2. Recording object key is saved to `Recording.fileKey`.
3. Existing Yandex SpeechKit transcription pipeline runs unchanged.
4. Existing DeepSeek transcript cleanup runs unchanged.
5. Existing DeepSeek negotiation analysis runs unchanged.

## Speaker mapping safety

Future Voximplant implementation must preserve dynamic speaker labels and must not force only Participant A/B labels.

Examples that must remain supported:

- `speaker_1`
- `speaker_2`
- `speaker_3`
- `speaker_4`

Speaker mapping to Participant A / Participant B / Facilitator / Observer / Unknown / Exclude is handled in a later stage and is intentionally unchanged in Stage 2.

## Rollback / fallback

Operational rollback is provider-level:

- set `VIDEO_PROVIDER=livekit`.

## Explicit non-goals for Stages 1-4

- no runtime switch in negotiation room (`/room/[sessionId]`);
- no changes to event lobby / lobby behavior;
- no changes to existing LiveKit behavior;
- no changes to Yandex SpeechKit / DeepSeek transcript cleanup / DeepSeek negotiation analysis pipelines;
- no exposure of provider management secrets to browser code.
- no negotiation room UI switch away from LiveKit in this stage.

## Stage 4 identity provisioning decision (documented, not implemented in Stage 1)

Chosen approach:

- `VideoProviderIdentity` + on-demand Voximplant user provisioning.

Planned Stage 4 behavior:

- backend verifies authenticated user;
- backend verifies user is approved/active/not blocked;
- backend verifies access to the specific negotiation session;
- backend resolves session role (Participant A / Participant B / Facilitator / Observer if supported);
- backend gets or creates Voximplant user for that registered user;
- backend stores durable mapping in `VideoProviderIdentity`;
- backend returns only browser-safe Voximplant access data.

Rules:

- no bulk sync;
- no email as Voximplant username;
- deterministic technical username format: `ng_u_<sha256(userId).slice(0, 16)>`;
- no static PoC credentials;
- no permanent provider secrets in browser responses.

Important:

- Prisma model/migration for `VideoProviderIdentity` is deferred to Stage 4.
- Prisma schema and migrations are intentionally unchanged in Stage 1.
- Any future migration step must be proposed and approved separately before applying.
