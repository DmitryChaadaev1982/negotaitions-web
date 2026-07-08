# 04 Session And Event Flow

## Standalone Session Flow

1. Facilitator creates a session from case context.
2. Session participants and roles are assigned.
3. Participants enter room (`/room/[sessionId]` or join flow).
4. Facilitator drives preparation and negotiation state transitions.
5. Recording lifecycle is tied to negotiation control flow.
6. Materials API exposes recording/transcript/analysis progression.

## Event-Based Flow

1. Event is created and opened in lobby mode.
2. Participants join event lobby.
3. Host creates assignment draft and selects case.
4. Session is created from event assignment.
5. Assigned users move from lobby to room.
6. Session completion can return users to lobby or materials.

## State Authorities

- Session/event source of truth: database state.
- Room views poll control and sidebar/materials APIs.
- Event assignment and participant linkage are persisted server-side.
- Negotiation `PAUSED` state controls timer/recording-analysis boundaries, not room-media connectivity.
- `micAllowed` is a speaking-policy signal. In `PAUSED`, microphones remain allowed for all in-room roles (`PARTICIPANT`, `FACILITATOR`, `OBSERVER`).
- Pause interval orchestration is idempotent:
  - repeated `PAUSE` while already paused does not create duplicate open intervals;
  - repeated `RESUME` while already running is treated as no-op;
  - `FINISH` closes all remaining open pause intervals.

## Key Control Endpoints

- Session control: `app/api/sessions/[sessionId]/control/route.ts`.
- Session control state: `app/api/sessions/[sessionId]/control-state/route.ts`.
- Session media status publish: `app/api/sessions/[sessionId]/media-status/route.ts`.
- Event host control: `app/api/events/[id]/host/route.ts`.
- Event state: `app/api/events/[id]/state/route.ts`.
- Event lobby media status publish: `app/api/events/[id]/media-status/route.ts`.

## Source Notes

- `app/actions/sessions.ts`
- `app/actions/events.ts`
- `app/api/sessions/[sessionId]/control/route.ts`
- `app/api/sessions/[sessionId]/control-state/route.ts`
- `app/api/events/[id]/host/route.ts`
- `app/api/events/[id]/state/route.ts`
- `docs/architecture/session-flow-gap-analysis.md`
