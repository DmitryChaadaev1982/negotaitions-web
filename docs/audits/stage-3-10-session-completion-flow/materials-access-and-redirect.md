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
