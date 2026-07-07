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

## Operational Constraints

- Current design relies on active browser relay for some recording transitions.
- Scenario webhook base URL is resolved from env/runtime override logic.
- Keep scenario changes in dedicated Vox docs/scripts; application docs only describe current app-side contract.

## Source Notes

- `components/voximplant-negotiation-room-page.tsx`
- `lib/voximplant/use-voximplant-room.ts`
- `lib/voximplant/recording-dispatch.ts`
- `docs/voximplant/*.md`
