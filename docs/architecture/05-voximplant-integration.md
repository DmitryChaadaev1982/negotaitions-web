# 05 Voximplant Integration

## Integration Role

Voximplant is the video/voice provider when `VIDEO_PROVIDER=voximplant` and is used for:

- Room and event-lobby media transport.
- Conference messaging bridge for recording control relay.
- Scenario-driven recording completion callback via webhook.

## Key Components

- Room page: `components/voximplant-negotiation-room-page.tsx`.
- Room control bar: `components/voximplant-media-controls.tsx` renders the
  provider mic/camera controls; shared room notification controls are injected
  immediately after camera so session audio cues remain provider-neutral.
- Room hook: `lib/voximplant/use-voximplant-room.ts`.
- Access APIs:
  - `app/api/sessions/[sessionId]/voximplant/access/route.ts`
  - `app/api/events/[id]/voximplant-access/route.ts`

Event-lobby browser copy actions use the active page origin plus canonical
relative invitation paths. This UI concern does not alter Voximplant access
URLs, credentials, or server-generated invitation origins.
- Recording dispatch adapter: `lib/voximplant/recording-dispatch.ts`.

## Control Channel

- Server builds typed recording command payload.
- Browser relays payload with `conference.sendMessage(...)`.
- Vox scenario executes recording operation and posts status webhook back to app.

### Recording Attempt Fencing (Stage 3.13E)

- Recording control supports dual protocol versions:
  - legacy `rc2-hmac-sha256-v1` for historical callbacks/messages;
  - fenced `rc3-hmac-sha256-recording-attempt-v1` for durable attempt identity.
- A stable `recordingAttemptId` is persisted by app backend before START dispatch
  and is carried through START/STOP commands, scenario callbacks, and server-stop
  callbacks.
- Scenario-side command admission is attempt-aware:
  - START for attempt `B` is rejected while active attempt `A` is in
    any non-terminal state, including `resuming`;
  - STOP, PAUSE, RESUME, and STATUS must match the active attempt identity;
  - legacy mutating/status commands are rejected when the active recorder is
    fenced.
- Recorder event handlers capture one immutable per-instance attempt context.
  Late `Started`, `Stopped`, or `Error` from recorder `A` always reports attempt
  `A` and cannot clear or mutate current recorder/context `B`.
- STARTING/STOPPING watchdog failures retain the concrete timed-out recorder,
  issue best-effort provider cleanup, and keep its event handlers alive until
  its own terminal event. A newer attempt can replace only the mutable current
  pointer, not the old recorder's captured identity. `Started` received after
  cleanup was requested captures provider metadata but cannot publish
  `RECORDING` or mutate current state; it retries stop for that exact instance
  once (two total cleanup attempts) and then waits for its own `Stopped`/`Error`.
- Recording-status webhooks use Promise-based bounded retries for fenced callbacks
  only (transient Vox transport codes `-4`, `-6`, `-7`, `-8`, plus HTTP `408`,
  `429`, and `5xx`), while legacy callbacks keep one-shot send. Unknown negative
  provider result codes are not retried.
- Server-stop callback payloads now include `recordingAttemptId` when present, so
  app-side terminal mutations remain CAS-fenced to one attempt.
- A fenced server-stop command fails with `409` when the scenario has no current
  attempt context; only the separate legacy path may reconstruct context.
- If server-stop falls back to browser relay, the relay claim reloads the
  current Recording attempt and re-signs STOP as RC3 with the same
  `recordingAttemptId`. Facilitator reassignment or a stale former facilitator
  lease may change which eligible room client transports the fallback, but
  cannot downgrade the command to legacy RC2.

### Exact-Attempt Reconciliation (RC4)

- RC4 retains the RC3 signed attempt identity and adds server-originated
  `get_recording_status` for one exact `recordingAttemptId`.
- The scenario answers from the current matching recorder context or an
  immutable bounded terminal cache (maximum 8 attempts, 60-minute TTL).
  Unknown/evicted attempts return `recording_attempt_unknown`; an obsolete
  query never falls through to the current attempt.
- App reconciliation is triggered by existing control-state/materials polling,
  but admission is CAS-claimed and throttled to at most one query per attempt
  per 30 seconds. It applies only to stale `STARTING`, durable stopping, and the
  narrow recoverable callback-loss failure.
- Provider-confirmed `recording` restores canonical `RECORDING`; confirmed
  terminal error remains `FAILED`; confirmed `stopped` uses the normal
  attempt-fenced callback application path, including S3 HEAD verification
  outside the DB transaction and a second CAS fence before final mutation.
- When an exact query proves that the same attempt is still active and its
  durable stop operation is due in `FAILED`/timed-out `DELIVERING`, the app
  re-drives that exact-attempt STOP through the existing bounded delivery
  policy.
- If an old STARTING attempt cannot be confirmed, the app records
  `RECORDING_STARTING_TIMEOUT_RECONCILED`. This is a bounded, recoverable
  uncertainty state, not proof that Vox never created a physical recorder.
- Exact RC3 STOP is permitted for canonical `STARTING` without `egressId` and
  for only the narrow recoverable failure above. It still requires a persisted
  `recordingAttemptId`; legacy NULL-attempt rows remain excluded.

### RC4 compatibility boundary

The active scenario marker is
`main-room-recording-reconciliation-2026-08-12-rc4`. Its exported source
SHA256 is
`040e7c5557c3156133a48556da1a6b86976f058fb969f111d9c673c9a2368553`,
which matches `docs/voximplant/neg-conf.main-room.scenario.js`.

Application `601704bafde7da219fe1f1e37737e7769a09a6f9` sends RC2 recording
control and attempt-less server-stop commands. RC4 remains backward-compatible
for a recording created by that application:

- room join/conference/media handling is outside the RC4 recording-control
  changes;
- legacy START, STOP, PAUSE, RESUME, and STATUS use the unchanged RC2 canonical
  signature field order and create a null-attempt recorder context;
- recording-status payloads add protocol/attempt fields only for fenced
  callbacks, so RC2 callback payloads remain accepted by the old route;
- provider registration and legacy server-stop callbacks remain attempt-less,
  and RC4 accepts the old signed `stop_recording` payload when the active
  recorder context is legacy.

An old application cannot mutate a fenced RC3 attempt started by the new
application. This is intentional fail-closed behavior, not a backward
compatibility failure for old-app-created work. Deployment and rollback
preflight must therefore require zero active recording/stop operations before
switching application versions.

## Presence And Media Status Model (Stage 3.1)

- Session room and event lobby both normalize participant media state via `lib/voximplant/participant-presence-media-model.ts`.
- Normalized model fields:
  - `connectionStatus`: `connected | disconnected | unknown`
  - `micStatus`: `on | off | unknown`
  - `cameraStatus`: `on | off | unknown`
  - `shouldRenderActiveTile`: gate for active video-tile rendering.
- Active tiles in `components/voximplant-video-layout.tsx` are rendered only for participants with real connected endpoint/media state (`shouldRenderActiveTile=true`), not just DB assignment.
- Assigned but not connected users remain visible in roster/sidebar data, but no longer appear as active room tiles.
- Mic/camera indicators in room/lobby tiles are icon-based and use a shared semantic mapping:
  - Connected + ON = green
  - Connected + OFF = red
  - Disconnected/unknown = gray
- Event-lobby device warnings are presentation-only and render only recognized
  existing media/device/permission failures. Credential/bootstrap/lease state
  and normal provider connection/retry status do not become device warnings;
  provider-specific retry/error surfaces remain their own authority. The lobby
  video-area header (title + local display name) stays empty of media copy when
  camera and microphone are working; it does not show a precautionary
  single-device hint. Recognized acquisition failures occupy that same header
  slot via `event-lobby-device-warning`.
- After local microphone and camera streams are known, the lobby reconciles the
  warning from those streams (`lib/voximplant/lobby-device-warning.ts`). A stale
  recoverable StreamManager error is cleared only when both tracks exist. One
  healthy device does not hide a real failure of the other. The header warning
  is published from live local tracks (`readyState !== "ended"`), not from a
  one-shot catch during connect: a later SDK/device-busy log or reconnect
  attempt must not keep the warning while the local tile still has live
  camera and microphone tracks. Playwright cannot attach live Voximplant
  hardware; the healthy-media fault mode still calls `getUserMedia` and then
  the same reconciliation helper.

## Room Tile Metadata Contract (Stage 3.2)

- Session room tile body text avoids duplicating section headings (`Participant A/B`, `Facilitator`) inside each tile.
- Participant A/B tiles show:
  - title: participant display name (`(you)` marker for local participant)
  - subtitle: case role name only when present
- Facilitator tiles show title-only identity (no duplicated facilitator role text in subtitle).
- Textual video connection labels are removed from room tile subtitles; mic/camera status remains icon-based with unchanged color semantics.

## Pause Semantics (Stage 3.4)

- Session `PAUSED` does not disconnect participants from Vox rooms and does not forcibly toggle local microphone state.
- Vox room tile mic icons continue to use explicit backend media-status sync (`micEnabled`/`cameraEnabled`) during pause, instead of coercing remote mic state to off.
- Pause remains visible through negotiation/timer state UI, while media toggles continue to reflect user-selected device state.
- In `PAUSED`, speaking-policy (`micAllowed`) is true for `PARTICIPANT`, `FACILITATOR`, and `OBSERVER`.
- Recording continuity hotfix: Vox recording remains physically continuous from negotiation `START` until `FINISH`; pause/resume is represented by `SessionPauseInterval` rows only (no per-pause recording stop/start chunking).

## Single-Active Connection Lease (Stage 3.3 Hotfix)

- Room and lobby client `connectionId` values are generated client-side with runtime entropy (UUID/random), not React `useId`.
- IDs are unique per mounted page instance (different across tabs/devices/reloads) and are not persisted to storage.
- Session room and event lobby bootstrap calls claim the same-login lease with this connection ID; newest connection replaces the previous active connection.
- Stale clients receive `409 STALE_CONNECTION` from polling and media-status APIs, stop publishing, and transition to stale UI state.
- Vox room stale state triggers best-effort media disconnect (`leave`) so stale clients do not remain active video participants after takeover.
- Session Vox access now validates/claims lease when `connectionId` is provided and rejects stale tabs before issuing fresh credentials.

## Remote Toggle Propagation Fallback

- Vox SDK endpoint events are still primary (`EndpointAdded/Removed`, `RemoteMediaAdded/Removed`).
- Remote mic/camera state now uses an explicit app-level contract:
  - Local client publishes status to backend:
    - `POST /api/sessions/[sessionId]/media-status`
    - `POST /api/events/[id]/media-status`
  - Payload includes `connectionId`, `micEnabled`, `cameraEnabled` plus room identity (`participantId` or token/cookie access).
  - Server validates access and same-login lease before persisting.
- State distribution reuses existing polling surfaces:
  - Session room clients consume status through `GET /api/livekit/sidebar` roster fields.
  - Event lobby clients consume status through `GET /api/events/[id]/state` participant fields.
- Storage uses `AppSetting` JSON records keyed per session/event, avoiding Prisma schema changes while keeping shared durable status across tabs/participants.
- SDK stream polling fallback still runs for endpoint/media attachment, but icon/border media state for remote participants is rendered from explicit backend status instead of inferred remote `MediaStreamTrack.enabled`.

## Event Lobby Media-Control Commands

- Event owner remote controls do not reuse the Vox recording scenario message
  channel and do not alter the Voximplant scenario.
- Owner disable and enable-request commands use `POST /api/events/[id]/media-control`
  and are stored in `AppSetting` through `lib/voximplant/event-media-control-store.ts`.
- Delivery reuses the existing Event-state polling payload. The target client
  executes only commands addressed to its current Event participant and then
  acknowledges the command through the same API.
- Event lobby media commands are actionable only while the target participant's
  authoritative Event presence state is `IN_LOBBY`. `IN_SESSION`,
  `TEMPORARILY_AWAY`, `OFFLINE`, `INVITED_NOT_CONNECTED`, and unknown locations
  are neutral, non-actionable states for lobby controls.
- Event-state invalidates pending lobby media commands when a target leaves the
  lobby surface, including entering a Session or becoming temporarily away, so a
  stale enable request cannot later apply to Session media.
- Remote disable is idempotent. Remote enable is a participant confirmation
  request; the target's local browser action is the only code path that can
  enable camera or microphone.
- Confirmed media state still propagates through the existing
  `/api/events/[id]/media-status` publish path.

## Operational Constraints

- Recording start remains browser-relayed. Terminal recording stop is
  server-canonical when a server-stop mode is enabled; browser stop relay is
  fallback only in `prefer_server_with_relay_fallback` and remains the legacy
  path only when mode is `disabled`.
- Scenario webhook base URL is resolved from env/runtime override logic.
- Keep scenario changes in dedicated Vox docs/scripts; application docs only describe current app-side contract.

## Stage 3.10 Server-side Stop

- Browser-side recording start remains unchanged and still uses `recording_control` relay.
- Canonical completion (`completeSessionCanonical`) now keeps one durable `SessionRecordingStopOperation` and attempts server-side Vox stop first when enabled.
- Server-side control channel is stored in server-only `SessionVoximplantControlChannel` (`sessionId` + `providerSessionId` unique) with private URL fingerprint logging only.
- Stop transport/result evidence stays additive on `SessionRecordingStopOperation` (`transportAcceptedAt`, `commandAcceptedAt`, `providerTerminalAt`, provider failure fields) without new operation state strings.
- Feature modes are controlled by `VOXIMPLANT_SERVER_STOP_MODE`: `disabled`, `prefer_server_with_relay_fallback`, `prefer_server_no_relay_fallback`.
- Provider terminal callback evidence is required for normal server path promotion to `DELIVERED`; transport 2xx alone is non-terminal.
- Browser relay remains bounded fallback only for `prefer_server_with_relay_fallback` mode; disabled mode preserves existing behavior.

## ReInvite Conference Scheme Sanitizer

Every conference membership change reaches the browser as a WebSDK
`handleReInvite` message carrying `scheme.reinviteCauses` plus a
`scheme.endpoints` record. `@voximplant/websdk@5.1.0` resolves
`scheme.endpoints[cause.id].mids` with no guard for `vi/conf-info-added` and
`vi/conf-info-updated`, although its own `vi/conf-info-removed` branch tolerates
a cause id that has no `endpoints` entry, and its `ReInviteScheme` type models
only `type: "call"` endpoints.

The VoxEngine audio recorder we attach for session recording is a conference
endpoint of `type: "recorder"`. Once it is fully established the provider
announces it as a `vi/conf-info-added` cause but omits it from the WebSDK
`endpoints` record. The SDK then throws
`TypeError: Cannot read properties of undefined (reading 'mids')` before it
reaches `reInviteQueue.add(...)`, so the SDP offer is never applied and no
`AcceptReInvite` is returned. The affected client keeps no working remote media
for the rest of the call. This is deterministic, not a race: the cause and the
record it fails to resolve arrive in one message.

- `lib/voximplant/reinvite-scheme-sanitizer.ts` subscribes to `handleReInvite`
  through the exported `connectionToken` seam and drops only unresolvable
  `added`/`updated` causes. `endpoints`, `politeIndex`, `sdp`, `headers` and all
  `removed` causes are left untouched.
- Every `Core.init` site must install the sanitizer **before**
  `registerModules([ConferenceLoader()])`, because WebSDK message subscribers run
  in registration order and the sanitizer has to be first.
  `lib/voximplant/reinvite-scheme-sanitizer.test.ts` enforces that ordering.
- The recorder therefore never becomes a WebSDK endpoint and never reaches the
  participant roster, which is the intended presentation.
- Known residual provider issue: Voximplant upstream emits an unbacked recorder
  `vi/conf-info-added` cause. The sanitizer mitigates that provider/WebSDK
  mismatch without changing call endpoints or SDP.
- Removal condition: drop the module only after the installed WebSDK guards
  `endpoints[cause.id]` (or Voximplant stops emitting the unbacked recorder
  cause) and the recorder-rejoin canary passes without sanitization. The test
  harness executes the shipped SDK source and fails when it changes shape,
  which surfaces that on upgrade.

## Stage 3.13E Wave 3 responsive geometry hardening

- Shared room shell now treats the right sidebar as desktop-only at `xl+`
  (`components/shared-room-shell.tsx`) and uses a compact, accessible sidebar
  drawer toggle below `xl` so session/debrief context remains reachable at
  zoom-pressured widths.
- Room header actions and media-control rows explicitly allow wrapping under
  width pressure; this prevents control truncation/collision at 1093/1024/911/853 CSS widths.
- Facilitator controls are now hosted in a bounded scroll container inside the
  room footer so short-height viewports keep all mandatory actions reachable
  without forcing page-level overflow.
- Vox observer rail height is compacted with a `clamp(...)` contract, and the
  desktop stage breakpoint moved from `lg` to `xl`, matching the shared-shell
  sidebar breakpoint to avoid intermediate-width compression.
- Event lobby shell follows the same `xl` desktop split rule and reduced sidebar
  width at `xl`, preserving video + control usability in the browser-zoom matrix
  while keeping sidebar content accessible.
- Geometry verification is codified by
  `tests/e2e/stage-3-13e-responsive-geometry.spec.ts` with viewport-matrix,
  RU/EN pressure, observer-heavy (30/50/100), and lobby assertions.

## Source Notes

- `components/voximplant-negotiation-room-page.tsx`
- `components/event-lobby-view.tsx`
- `components/event-lobby-voximplant-room.tsx`
- `lib/client/connection-id.ts`
- `lib/client/stale-connection.ts`
- `lib/voximplant/use-voximplant-room.ts`
- `lib/voximplant/event-media-control-store.ts`
- `lib/voximplant/recording-dispatch.ts`
- `lib/voximplant/reinvite-scheme-sanitizer.ts`
- `lib/voximplant/websdk-log-filter.ts`
- `docs/voximplant/*.md`
