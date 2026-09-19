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
- Post-processing Facilitator Lab (`POST_TRANSCRIPTION_LAB=1`) passes
  `skipRealtimeConnect` so the room hook does not open a Vox gateway. That
  seam is test-runtime only. It fails closed in production: `lib/test-mode.ts`
  ignores `POST_TRANSCRIPTION_LAB` whenever `NODE_ENV=production`, so
  `shouldConnectBrowserRealtimeTransport()` is `true` in production even if the
  flag leaks into the runtime environment. Materials, transcript, mapping, and
  AI APIs stay real in every runtime.
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

### Recording Attempt Fencing

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

## Presence And Media Status Model

- Session room and event lobby both normalize participant media state via `lib/voximplant/participant-presence-media-model.ts`.
- Normalized model fields:
  - `connectionStatus`: `connected | disconnected | unknown`
  - `micStatus`: `on | off | unknown`
  - `cameraStatus`: `on | off | unknown`
  - `shouldRenderActiveTile`: gate for active video-tile rendering.
- Active tiles in `components/voximplant-video-layout.tsx` are rendered only for participants with real connected endpoint/media state (`shouldRenderActiveTile=true`), not just DB assignment. When multiple Vox endpoints map to the same normalized username, the session-room hook owns **one** selected endpoint id per logical participant (`lib/voximplant/peer-media-selection-runtime.ts`). Layout consumes that id set through `selectedRemotesByLogicalIdentity`; it does not rank candidates independently. Quality is live-track-first; stale stream objects do not win. Remote HTMLAudioElement playback uses that selected endpoint's current projected audio stream only.
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

## Room Tile Metadata Contract

- Session room tile body text avoids duplicating section headings (`Participant A/B`, `Facilitator`) inside each tile.
- Participant A/B tiles show:
  - title: participant display name (`(you)` marker for local participant)
  - subtitle: case role name only when present
- Facilitator tiles show title-only identity (no duplicated facilitator role text in subtitle).
- Textual video connection labels are removed from room tile subtitles; mic/camera status remains icon-based with unchanged color semantics.

## Pause Semantics

- Session `PAUSED` does not disconnect participants from Vox rooms and does not forcibly toggle local microphone state.
- Vox room tile mic icons continue to use explicit backend media-status sync (`micEnabled`/`cameraEnabled`) during pause, instead of coercing remote mic state to off.
- Pause remains visible through negotiation/timer state UI, while media toggles continue to reflect user-selected device state.
- In `PAUSED`, speaking-policy (`micAllowed`) is true for `PARTICIPANT`, `FACILITATOR`, and `OBSERVER`.
- Recording continuity: Vox recording remains physically continuous from negotiation `START` until `FINISH`; pause/resume is represented by `SessionPauseInterval` rows only (no per-pause recording stop/start chunking).

## Single-Active Connection Lease

- Room and lobby client `connectionId` values are generated client-side with runtime entropy (UUID/random), not React `useId`.
- IDs are unique per mounted page instance (different across tabs/devices/reloads) and are not persisted to storage.
- Session room and event lobby bootstrap calls claim the same-login lease with this connection ID; newest connection replaces the previous active connection.
- Stale clients receive `409 STALE_CONNECTION` from polling and media-status APIs, stop publishing, and transition to stale UI state.
- Vox room stale state triggers best-effort media disconnect (`leave`) so stale clients do not remain active video participants after takeover.
- Session Vox access now validates/claims lease when `connectionId` is provided and rejects stale tabs before issuing fresh credentials.

## Event Lobby Join Authority

- Authoritative Event-lobby conference membership is successful `conference.join()` for this mount's conference instance. SDK `Connected` is not independently sufficient; it may be retained as a signal and used only for idempotent remote reconciliation after join has already succeeded.
- On the false→true join edge, `joined` and `lobbyConferenceConnectedRef` converge together. Known endpoints and streams are replayed from the SDK conference maps without waiting for a new provider event.
- Remote audio playback, remote tiles, and `VoximplantMediaControls` share that same join authority so a live connection cannot remain in audible-audio / empty-grid / disabled-controls state.
- A `409 STALE_CONNECTION` still unmounts this browser's Vox lobby room. Cleanup releases this mount's `HTMLAudio` and local media only. Newest-connection-wins lease semantics, Vox scenario, Prisma, and Session generation fencing are unchanged.
- Helper: `lib/voximplant/lobby-join-authority.ts` (pure transition rules for the lobby join edge; not a second Session lifecycle).
- Event Lobby Vox room presentation is a normal-flow flex column inside the video pane (`event-lobby-video-pane`). The room root participates in document flow (`flex-1 min-h-0 min-w-0`, not `absolute`) so a collapsing overflow-hidden ancestor cannot clip an out-of-flow box while `getBoundingClientRect` still reports a size. No percentage-height dependency and no browser-name branch.
- The Event Lobby shell (`event-lobby-layout`) is CSS grid: one column below `md`; from `md`, `minmax(0, 1fr)` for the video column and a bounded sidebar (`minmax(15rem, 20rem)`, widening slightly at `lg`). Below `md` the video pane uses `aspect-video` with a max height so it stays compact; from `md` the pane flex-fills remaining column height. Outer lobby scrolling is used when stacked; the video pane itself is `overflow-hidden`. No user-agent or viewport JS.
- After `conference.join()` replay, a provider endpoint whose `userName` matches the current local `sdkUsername` (normalized, domain-stripped) is not materialized as a remote tile. Display name is not identity authority. Newest-browser takeover still treats this browser as the local participant; leftover same-user provider endpoints are browser-local UI suppression only (no provider-wide kick, lease redesign, or Session generation fence).

## Remote Toggle Propagation Fallback

- Vox SDK endpoint events are still primary (`EndpointAdded/Removed`, `RemoteMediaAdded/Removed`).
- Remote mic/camera state now uses an explicit app-level contract:
  - Local client publishes status to backend:
    - `POST /api/sessions/[sessionId]/media-status`
    - `POST /api/events/[id]/media-status`
  - Payload includes `connectionId`, `micEnabled`, `cameraEnabled` plus room identity (`participantId` or token/cookie access).
  - Server validates access and same-login lease before persisting.
- State distribution reuses existing polling surfaces:
  - Session room clients consume status through `GET /api/livekit/sidebar`
    roster fields. That path name is historical: it is the **shared**
    session-room polling surface for both LiveKit and Voximplant. Vox rooms
    use it intentionally.
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

## Provider Disconnect Recovery

Application-side contract for Vox conference/call disconnect and Layer-3
media connectivity. The application tolerates provider `408 Request Timeout`;
it does not try to prevent Vox from emitting it, and a 408 log by itself is
never a rejoin trigger. Recorded production incident:
`cmt8lfu7w0000w9m1xq6hlfpj`.

Layer 1 (logical presence / `SessionRoomConnection` heartbeat) and Layer 2
(`roomLifecycle`) stay independent of Layer 3 (Vox/media health). Recoverable
or bounded-terminal media failure must not write Leave, expire the lease, or
unmount `SharedRoomShell` while the participant is still on the Session room
surface.

Installed `@voximplant/websdk` 5.1.0 `ConnectionOptions.autoReconnect`
defaults to **true**. `ClientState.RECONNECTING` and
`ConferenceState.RECONNECTING` are owned by the SDK. While either is
reconnecting the app must not call `client.connect()`, `conference.join()`,
`conference.hangup()`, or `client.disconnect()`, and must not spend an
application rejoin merely because a 408/log occurred. Usable live media is
not cleared merely because signalling is reconnecting.

- **Authoritative Layer-3 state.** Session-room connectivity is
  `connected | reconnecting | degraded | recovering | failed` in
  `lib/voximplant/layer3-media-connectivity.ts`, projected from the room hook
  as `layer3` (with `providerRecovery` as the terminal-incident substatus).
  Tiny signalling blips that still have usable media do not flash a banner.
- **Stale remotes.** When the current provider generation receives a terminal
  conference Failed or unexpected Disconnected, remotes plus remote stream /
  endpoint-subscription / VAD maps are cleared at the provider-state layer
  **after** the old generation is fenced. A disconnected current conference
  cannot keep old remotes as live tiles. Layout
  (`components/voximplant-video-layout.tsx`) additionally requires `joined`
  for remote `connectedSignal` (defense-in-depth only).
- **Expected vs unexpected.** Auto-rejoin is not used for explicit Leave,
  page/unmount teardown, recovery teardown of the previous generation, stale
  lease, auth/access denial, or a Session that is no longer operable. Event
  or organizer close does not rejoin. Debrief after a normal FINISH
  (`closeMessageKey === "join.sessionFinishedMessage"`) still occupies the
  room and remains operable. Vox disconnect alone is not a Session Leave.
  `LOCAL_ENDED` / `REMOTE_ENDED` are not application terminal-recovery
  triggers. `CONNECTION_LOST` (and other unexpected membership disconnects)
  are terminal Conference events even while the SDK is `RECONNECTING`: the
  incident is **deferred, not lost**. The app must not join/connect/hangup/
  disconnect until SDK reconnect settles, then it executes exactly one bounded
  new-Conference recovery for that incident. If SDK `RECONNECTING` begins
  after that attempt has already started but before the new Conference
  successfully joins, the **same** attempt is paused and later resumed
  exactly once. The app must not treat that pause as a second incident or as
  a failed `already_in_flight` result, and must not join/connect/hangup/
  disconnect while the SDK is reconnecting. Explicit Leave, stale takeover,
  unmount, or a non-operable Session cancels a pending or paused attempt.
- **SDK reconnect observation is edge-triggered.** Only a real
  `RECONNECTING` → settled transition is a reconnect episode. Ordinary
  `CREATED` / `CONNECTING` / `CONNECTED` / `LOGGED_IN` callbacks are not
  treated as `sdk_reconnected`, must not promote `hasEnteredRoom`, and must
  not classify Layer 3 as `degraded` merely because the remote roster is
  empty. A healthy single-user room is a valid connected state. After a real
  reconnect settle, signaling returns to connected unless an explicit media-
  liveness reason (`stream_ended`, native `ended`, automatic StopReceiving)
  is still attached.
- **Bounded terminal recovery, per incident.** `ConferenceEvent.Failed` treats
  the current Conference object as terminal. Unexpected
  `ConferenceEvent.Disconnected` with an unrecoverable reason such as
  `CONNECTION_LOST` is the same membership-terminal class; if SDK reconnect
  is still in progress the join is deferred as above, otherwise the app
  fences generation N synchronously, tears down that Conference only, creates
  a **new** Conference, and `join()`s the same provider room with the **same**
  logical `connectionId` / lease. It does not remount the logical participant,
  does not claim a new connectionId, and does not run recording START/STOP.
  Budget is **one attempt per terminal incident**. Successful recovery resets
  the budget so a later independent incident may recover; a failed incident
  does not loop. This is not a one-shot-forever mount budget.
- **Generation fencing.** Each join/rejoin owns a monotonically increasing
  local generation token (not persisted). Once generation N is declared
  terminal, no callback from N may mutate state that belongs to N+1.
  Ownership (generation + Conference object identity) is validated **before**
  any shared-state mutation, including `runtime.conferenceConnected` and the
  Conference `state.watch` projection. A late callback from a fenced
  Conference must not write `sdkConferenceState`, flip `sdkReconnecting`,
  flush pending recovery, or publish Layer 3. Fence happens **before**
  destructive reset/rejoin, not only in React effect cleanup. Covered
  callbacks include Connected, Disconnected, Failed, EndpointAdded/Removed,
  RemoteMediaAdded/Removed, Stream Ended, native track ended, SDK state
  watchers, and background endpoint reconciliation. While a terminal
  incident is still pending and no newer Conference is authoritative, the
  still-current Conference watcher may observe the legitimate SDK reconnect
  settle so the incident can flush exactly once.
- **408 policy.** `TransportTimeoutError` / `transport_unavailable:408` feeds
  Layer-3. If the SDK is RECONNECTING, the SDK owns recovery. If media remains
  usable, do not rejoin. If media is unusable but the conference is
  non-terminal, only the liveness/resync path runs. Terminal provider state
  uses the conference recovery path. There is no guessed 30-second application
  timeout and no 408→immediate rejoin.
- **Healthy fast path.** First usable live remote media updates remote
  participant state and tile eligibility synchronously/event-driven. Recovery
  must not insert an extra await, occupancy/media-status request, mandatory
  endpoint reconciliation cycle, 1-second poll, peer acknowledgement, or
  SDK-state confirmation between usable media and render. Conference Connected
  is not a render gate for an already-usable live track. Background
  reconciliation stays off that path.
- **Remote media liveness.** A stream object existing is not sufficient.
  Render/select only media whose underlying track is usable (`readyState` not
  `ended`). `RemoteMediaRemoved`, `StreamEvent.Ended`, and native `ended`
  hide that media without Leave or full rejoin. Stream ENDED and native
  track-ended listeners are **owned by endpointId + streamId**.
  `RemoteMediaRemoved` disposes that exact stream-scoped binding and
  re-projects remaining live streams on the endpoint so a late ENDED /
  native `ended` from the removed stream cannot degrade or suppress a
  replacement stream. `EndpointRemoved` / unsubscribe / terminal teardown
  still dispose every binding for that endpoint. Duplicate observation of the
  same stream (initial `getAny*Streams()`, `RemoteMediaAdded`, background
  reconciliation) must not register a second listener. `StopReceivingVideoStream`
  reason `Automatic` is recoverable media degradation: hide video, do not
  rejoin; `StartReceivingVideoStream` or a new live stream restores
  immediately. Cross-browser peer/endpoint convergence uses the same
  live-track-first helper described below; it is not a second recovery
  owner.
- **Peer media convergence.** Logical participant identity is the
  normalized Vox username (trim, lowercase, domain-stripped). Vox endpoint
  id is transport/media-instance identity only. One logical participant may
  temporarily have overlapping endpoints (old/stale/degraded plus
  new/recovered/live). Session-room layout still renders **one** tile.
  `lib/voximplant/participant-media-selection.ts` is the shared synchronous
  ranking helper. `lib/voximplant/peer-media-selection-runtime.ts` is the
  single previous-selection owner for the session-room hook. The hook
  publishes `selectedPeerEndpointIds` from that owner; video tiles,
  speaking/media projection, and HTMLAudioElement playback all consume the
  same selected endpoint ids. Layout does not keep a second previous-
  selection map. Quality order is live usable video, then live usable
  audio, then endpoint present without live media, then ended/stale/unusable.
  A MediaStream object whose tracks are `readyState === "ended"` cannot beat a
  live candidate. Equal-quality candidates keep the previously selected
  endpoint when it is still in the group **for both video and audio**;
  otherwise lexicographic endpoint id (stable tie-break only, not a Vox
  recency signal). Actual remote HTMLAudioElement playback has two ownership
  levels: one selected endpoint per logical participant, then one current
  audio stream for that endpoint (`remote.audioStream.id`). Unselected
  endpoints are paused; an obsolete/replaced stream on a still-selected
  endpoint is paused immediately, without waiting for `RemoteMediaRemoved`.
  An endpoint that becomes selected resumes its current stream immediately
  via `lib/voximplant/remote-audio-playback.ts`; manual unlock plays only the
  currently selected endpoint's current audio stream. A newly attached remote
  audio stream is inserted into the candidate snapshot synchronously before the
  play/pause decision; React `setState` updater timing is not the selection
  authority. Higher conference generation with live media suppresses
  older-generation candidates so a stale callback cannot reclaim the tile or
  the audio element. Background 1s SDK-map reconciliation may prune endpoint
  ids that the snapshot no longer lists; it does not run before first live
  render and does not use a different selection policy. Refresh is not
  required. Event lobby does not copy this session-room selector.
  Recording/transcription identity stays on the logical participant, not the
  transient endpoint id.
- **ReInvite / IceRestart timeout.** Production-shaped WebSDK JSON
  `"actionName":"IceRestartAction"` plus `Action run failed to timeout` is a
  recoverable media/signalling degradation, not `TERMINAL_PROVIDER_FAILURE`
  and not proof the call hung up. While the current call remains connected,
  the hook performs one generation-fenced endpoint resync. It does not
  full-rejoin. An actual later terminal Failed/Disconnected owns conference
  recovery. Gateway websocket close remains the only trigger for
  `createSessionTransportRecovery`.
- **Local camera device failure.** StreamManager `NotReadableError: Device
  in use` is `local_media_device_failure` (non-terminal). It does not clear
  remotes, mark the conference dead, or start provider rejoin. Existing
  camera-unavailable / audio-only join behavior is unchanged. The application
  does not steal another application's camera.
- **Endpoint snapshot.** The existing 1s local SDK map loop uses
  `lib/voximplant/endpoint-reconciliation.ts` as a **background** safety net.
  A transient empty snapshot while the current call is still connected does
  not erase known remotes. `EndpointRemoved`, actual disconnect, and a
  non-empty authoritative snapshot that omits a previously known id remain
  safe removal evidence.
- **Event lobby.** Lobby shares classification, conservative snapshot
  reconcile, and remotes-cleared-on-disconnect. It does **not** copy Session
  bounded terminal conference recovery; lobby already recovers through
  `createProviderConnectRunner`. Event child sessions and standalone sessions
  share the Session room hook.
- **Unchanged.** SessionRoomConnection lease TTL, Session heartbeat cadence,
  Vox Scenario, Prisma/migrations, recording/transcription/enhancement
  semantics, and Session lifecycle policy. Media recovery must not auto-send
  recording START or STOP.

Helpers: `lib/voximplant/layer3-media-connectivity.ts`,
`lib/voximplant/media-liveness.ts`,
`lib/voximplant/participant-media-selection.ts`,
`lib/voximplant/peer-media-selection-runtime.ts`,
`lib/voximplant/remote-audio-playback.ts`,
`lib/voximplant/conference-callback-ownership.ts`,
`lib/voximplant/provider-disconnect-recovery.ts`,
`lib/voximplant/endpoint-reconciliation.ts`,
`lib/voximplant/provider-recovery-log.ts` (sanitized transition logs only;
no tokens, access URLs, secrets, raw SDP, or credentials),
`lib/voximplant/session-room-recovery.runtime.ts`.

## ng_u_* orphan-user cleanup (operator tool)

Operator-gated inventory for application-generated remote users. This is
not part of room join or provisioning. The CLI remains available and
defaults to dry-run. A completed one-time live apply is historical
(`docs/history/design-packets/requirements/stage-3-24a-vox-test-identities.md`).
Do not rerun apply unless a new inventory is explicitly authorized.

- Username algorithm is the production function
  `buildVoximplantUsernameForUser` in `lib/voximplant/username.ts`, re-exported
  by `lib/voximplant/identity.ts`.
- Command: `npm run vox:orphan-cleanup` or
  `npm run vox:orphan-cleanup -- --dry-run`. Default mode is dry-run. A bare
  invocation never deletes.
- Keep-list sources:
  - production `User.id` values via the documented SSH read-only path
    (`ssh negotaitions-poc`, see `docs/history/checkpoints/deployment/yandex-poc-server-parameters.md`);
  - local manual `User.id` values on `localhost:5432`;
  - the four fixed managed E2E IDs only;
  - explicit `/voximplant-test` POC usernames (`participant-a`,
    `participant-b`, `facilitator`, plus `VOXIMPLANT_*_USER` values).
    Passwords are never read or printed.
- E2E `localhost:5433` is not a keep source. Current ephemeral E2E rows may
  be labeled `SOURCE_HINT=CURRENT_EPHEMERAL_E2E_USER` only.
- A remote user is `DELETE_CANDIDATE` only when the username matches
  `^ng_u_[0-9a-f]{16}$` and is absent from every keep source. Distinct
  `User.id` values that hash to the same `ng_u_*` are `AMBIGUOUS_BLOCKED`.
- Dry-run uses Management API `GetUsers` only. `AddUser`, `SetUserInfo`,
  `DelUser`, and database writes are out of scope for the dry-run path.
- A later apply still requires `--apply`, `--expected-count N`, recomputed
  inventory and keep-lists, exact candidate set agreement (count,
  fingerprint, username set), numeric `user_id` only, generated `ng_u_*`
  only, bounded batches of 10, and stop-on-first-batch-failure. There is no
  `user_id=all` or prefix mode. The live CLI also requires
  `VOX_ORPHAN_CLEANUP_ALLOW_APPLY=1`. Do not execute apply as part of
  ordinary validation.
- Helpers: `lib/voximplant/orphan-user-cleanup.ts`,
  `lib/voximplant/orphan-user-cleanup-io.ts`,
  `lib/voximplant/management-api-core.ts` (CLI-safe GetUsers/DelUser),
  `scripts/ops/voximplant-orphan-user-cleanup.ts`.
  Next.js production still imports `lib/voximplant/management-api.ts`
  (`import "server-only"`). Provisioning (`AddUser` / `SetUserInfo`) is
  unchanged.

## Operational Constraints

- Recording start remains browser-relayed. Terminal recording stop is
  server-canonical when a server-stop mode is enabled; browser stop relay is
  fallback only in `prefer_server_with_relay_fallback` and remains the legacy
  path only when mode is `disabled`.
- Scenario webhook base URL is resolved from env/runtime override logic.
- Keep scenario changes in dedicated Vox docs/scripts; application docs only describe current app-side contract.

## Server-side recording stop

- Browser-side recording start remains unchanged and still uses `recording_control` relay.
- Canonical completion (`completeSessionCanonical`) now keeps one durable `SessionRecordingStopOperation` and attempts server-side Vox stop first when enabled.
- Server-side control channel is stored in server-only `SessionVoximplantControlChannel` (`sessionId` + `providerSessionId` unique) with private URL fingerprint logging only.
- Stop transport/result evidence stays additive on `SessionRecordingStopOperation` (`transportAcceptedAt`, `commandAcceptedAt`, `providerTerminalAt`, provider failure fields) without new operation state strings.
- Feature modes are controlled by `VOXIMPLANT_SERVER_STOP_MODE`: `disabled`, `prefer_server_with_relay_fallback`, `prefer_server_no_relay_fallback`.
- Server-stop settings parsing is runtime-neutral in
  `lib/voximplant/server-stop-settings.ts`. Next application consumers
  import `lib/voximplant/server-stop-config.ts`, which keeps
  `import "server-only"`. The maintenance CLI
  (`scripts/ops/stage-3-10-maintenance.ts`) imports the
  settings module directly. The same split applies to Voximplant account
  config (`config-settings.ts` / `config.ts`), webhook URL persistence
  (`recording-webhook-url-store.ts` / `recording-webhook-url.ts`), and
  callback nonce store (`server-stop-replay-store.ts` /
  `server-stop-replay.ts`). Pure parsers do not make secrets client-safe;
  client/server-component code must keep using the server-only wrappers.
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

## Room and lobby responsive geometry

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
- `lib/voximplant/layer3-media-connectivity.ts`
- `lib/voximplant/media-liveness.ts`
- `lib/voximplant/participant-media-selection.ts`
- `lib/voximplant/peer-media-selection-runtime.ts`
- `lib/voximplant/remote-audio-playback.ts`
- `lib/voximplant/provider-disconnect-recovery.ts`
- `lib/voximplant/endpoint-reconciliation.ts`
- `lib/voximplant/lobby-join-authority.ts`
- `lib/voximplant/provider-recovery-log.ts`
- `lib/voximplant/session-room-recovery.runtime.ts`
- `lib/voximplant/event-media-control-store.ts`
- `lib/voximplant/recording-dispatch.ts`
- `lib/voximplant/server-stop-settings.ts`
- `lib/voximplant/server-stop-config.ts`
- `lib/voximplant/config-settings.ts`
- `lib/voximplant/recording-webhook-url-store.ts`
- `lib/voximplant/reinvite-scheme-sanitizer.ts`
- `lib/voximplant/websdk-log-filter.ts`
- `lib/voximplant/username.ts`
- `lib/voximplant/orphan-user-cleanup.ts`
- `lib/voximplant/orphan-user-cleanup-io.ts`
- `scripts/ops/voximplant-orphan-user-cleanup.ts`
- Runtime scenario source: `docs/voximplant/neg-conf.main-room.scenario.js`
- Scenario sync: `docs/voximplant/scenario-sync.md`
- Historical Vox stage notes: `docs/history/design-packets/voximplant/`
