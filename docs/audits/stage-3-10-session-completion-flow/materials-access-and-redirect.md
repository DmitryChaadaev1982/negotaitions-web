# Materials Access and Redirect (Current vs Final Target)

## Current audited behavior

- Primary route is `/sessions/[id]/materials` with account-based authorization checks.
- Materials are accessible in processing/intermediate states.
- Navigation to materials does not require transcript or AI completion.
- Redirects into materials happen from leave, rejoin guards, event overlays, and session actions.

## Final target decisions

## Materials accessibility policy

- Materials remain accessible during all recording/transcript/AI processing states.
- Delayed recording webhook finalization must not block materials access.
- No-recording sessions must still render a valid no-recording/no-analysis state.

## Session-finished redirect policy

- Normal Session `FINISHED` plus room `DEBRIEF_OPEN`:
  - authorized room re-entry allowed;
  - materials remain accessible but are not forced as only destination.
- Normal Session `FINISHED` plus room `CLOSED`:
  - room access redirects to materials.

## Event-completed redirect policy

- Event `COMPLETED` disables interactive lobby participation.
- Linked sessions/rooms follow hard-close semantics.
- Navigation should lead to event results/session materials context.

## Supersession statement

This Stage 3.10 policy supersedes older guidance that all normally `FINISHED` sessions must immediately redirect away from room access.

## Trap-free navigation requirements

- Direct URL, refresh, and browser-back outcomes must align with one unified guard policy.
- Redirect targets must never trap users in unavailable lobby/room loops.
- Once room lifecycle is committed `CLOSED`, navigation/reconnect must not reopen room interactivity and must resolve to materials/results context.

## Checkpoint B implementation update

Canonical redirect resolver is now implemented at:

- `lib/session-room-access.ts` -> `resolveSessionClosedRedirectPath(...)`

Applied destinations:

- Standalone closed room: `/sessions/[id]/materials` (or `/join/[token]` when join-token flow is used).
- Event-linked completed room:
  - event-owner hierarchy may route to `/events/[id]/lobby` (completed results context),
  - participant/member hierarchy routes to session materials.

Closed room-sensitive APIs now return deterministic close metadata:

- `code: "ROOM_CLOSED"` or `code: "EVENT_CLOSED"`
- `redirectTo: <canonical destination>`

Room clients consume this metadata to avoid reconnect/poll retry loops after close.

## Redirect matrix (Checkpoint B final hardening)

### Standalone session

- `OPEN`:
  - authorized facilitator/participant/observer -> room allowed;
  - unauthorized/non-member -> denied (login/forbidden by caller surface).
- `DEBRIEF_OPEN`:
  - authorized member -> room allowed in debrief mode;
  - unauthorized/non-member -> denied.
- `CLOSED`:
  - room routes -> materials (`/sessions/[id]/materials` or `/join/[token]` for join-token path).
- `deleted`:
  - room routes -> deny (`404 sessionDeleted`).
- `unauthorized`:
  - no room entry, no provider credentials, no lease renewal.

### Event-linked session with active event

- `OPEN` -> authorized members may enter room.
- `DEBRIEF_OPEN` -> authorized members may rejoin debrief room.
- `CLOSED` -> redirect to materials path.

### Event-linked session with `COMPLETED` event

- lobby URL (`/events/[id]/lobby`) -> server redirects away from interactive lobby.
- room URL (`/room/[sessionId]`) -> canonical `EVENT_CLOSED` + redirect.
- session management URLs (`control-state`, `sidebar`, `heartbeat`, `media-status`, `control`, `recording-control`) -> `409 EVENT_CLOSED` with canonical `redirectTo`.
- materials URL -> remains available for authorized member context.

### Actor outcomes

- facilitator: normal controls in active room; after terminal close only convergence-safe status/relay flows.
- participant: cannot `FINISH`; may access allowed room states and authorized relay transport only.
- observer: same as participant for transport; cannot `FINISH`, cannot start/pause/resume recording after finish.
- event host (owner hierarchy): completed-event redirect may prefer event results context.
- non-member: denied; no credentials/lease claims.

## Loop prevention checks

- no room -> lobby -> room loop after close/event completion (server-side redirect is terminal for closed room access).
- no room -> materials -> room loop (room callers re-evaluate canonical lifecycle and stay redirected).
- completed event lobby refresh does not reopen interactive lobby.
- room flash on closed state is avoided for server-routed entry points.
- redirect targets are fixed server-generated paths; query params cannot inject arbitrary redirect destinations.
