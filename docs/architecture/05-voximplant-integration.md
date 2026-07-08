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

- Current design relies on active browser relay for some recording transitions.
- Scenario webhook base URL is resolved from env/runtime override logic.
- Keep scenario changes in dedicated Vox docs/scripts; application docs only describe current app-side contract.

## Source Notes

- `components/voximplant-negotiation-room-page.tsx`
- `lib/voximplant/use-voximplant-room.ts`
- `lib/voximplant/recording-dispatch.ts`
- `docs/voximplant/*.md`
