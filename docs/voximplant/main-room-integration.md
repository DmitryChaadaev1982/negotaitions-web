# Voximplant integration: negotiation room (Stage 1)

## Scope of Stage 1

Stage 1 adds only additive infrastructure:

- video provider switch helper (`VIDEO_PROVIDER`);
- server-side Voximplant config readers;
- documentation of the chosen Stage 4 identity model.

Stage 1 intentionally does **not** change runtime behavior in the negotiation room (`/room/[sessionId]`), does not touch event lobby behavior, and does not modify existing LiveKit flows.

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

## Rollback / fallback

Operational rollback is provider-level:

- set `VIDEO_PROVIDER=livekit`.

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
