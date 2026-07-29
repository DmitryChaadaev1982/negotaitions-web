# 05 Voximplant Integration

## Integration Role

Voximplant is the video/voice provider when `VIDEO_PROVIDER=voximplant` and is used for:

- Room and event-lobby media transport.
- Conference messaging bridge for recording control relay.
- Scenario-driven recording completion callback via webhook.

## Key Components

- Room page: `components/voximplant-negotiation-room-page.tsx`.
- Room hook: `lib/voximplant/use-voximplant-room.ts`.
- Access APIs:
  - `app/api/sessions/[sessionId]/voximplant/access/route.ts`
  - `app/api/events/[id]/voximplant-access/route.ts`
- Recording dispatch adapter: `lib/voximplant/recording-dispatch.ts`.

## Control Channel

- Server builds typed recording command payload.
- Browser relays payload with `conference.sendMessage(...)`.
- Vox scenario executes recording operation and posts status webhook back to app.

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

## Source Notes

- `components/voximplant-negotiation-room-page.tsx`
- `components/event-lobby-view.tsx`
- `components/event-lobby-voximplant-room.tsx`
- `lib/client/connection-id.ts`
- `lib/client/stale-connection.ts`
- `lib/voximplant/use-voximplant-room.ts`
- `lib/voximplant/recording-dispatch.ts`
- `lib/voximplant/reinvite-scheme-sanitizer.ts`
- `lib/voximplant/websdk-log-filter.ts`
- `docs/voximplant/*.md`
