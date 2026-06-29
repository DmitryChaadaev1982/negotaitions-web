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
