# Voximplant integration: negotiation room (Stages 1-3)

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

## Explicit non-goals for Stages 1-3

- no runtime switch in negotiation room (`/room/[sessionId]`);
- no changes to event lobby / lobby behavior;
- no changes to existing LiveKit behavior;
- no changes to Yandex SpeechKit / DeepSeek transcript cleanup / DeepSeek negotiation analysis pipelines;
- no Prisma schema or migration changes;
- no Voximplant user provisioning or `VideoProviderIdentity` implementation in these stages.

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
- deterministic technical username format: `ng_u_<safeUserIdOrHash>`;
- no static PoC credentials;
- no permanent provider secrets in browser responses.

Important:

- Prisma model/migration for `VideoProviderIdentity` is deferred to Stage 4.
- Prisma schema and migrations are intentionally unchanged in Stage 1.
- Any future migration step must be proposed and approved separately before applying.
