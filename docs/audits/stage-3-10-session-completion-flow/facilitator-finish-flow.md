# Facilitator Finish Flow (Current)

1. **UI handler**: facilitator clicks finish in `FacilitatorRoomControls` (`runAction("FINISH")`).
2. **Local state**: `isSubmitting=true`; no optimistic terminal state before API response.
3. **API request**: `POST /api/sessions/[sessionId]/control` with facilitator auth + optional `connectionId`.
4. **Session write**: server updates `Session.negotiationState` to `FINISHED` via `getControlUpdateData`.
5. **Recording stop request**:
   - LiveKit: stop is attempted server-side inside `/control`.
   - Voximplant: `/control` returns success, then client callback triggers `/recording-control stop` and conference scenario relay.
6. **SDK disconnect**: not part of finish itself; users may stay connected in debrief.
7. **Server-side recording stop**:
   - LiveKit immediate call in `/control`.
   - Voximplant row upsert to `STOPPED` then webhook-driven final status.
8. **Webhook/finalization**: Voximplant webhook can promote `STOPPED -> COMPLETED` when `fileKey` arrives.
9. **Participant notification**: other clients observe finish through `control-state` polling (1s interval), not push.
10. **Timer stop**: implied by terminal negotiation state returned by control-state.
11. **Room teardown**: no forced global disconnect on finish; room shell enters debrief mode for connected clients.
12. **Redirect**: no automatic finish redirect; navigation depends on user leave/materials actions.
13. **Post-processing start**: materials/status pipeline can continue independently after stop/finalization events.
14. **Materials visibility**: materials route remains available before transcript/AI completion.

## Authoritative action

- Authoritative negotiation completion event is `/api/sessions/[sessionId]/control` with action `FINISH`.
- For Voximplant recording, authoritative transport completion is webhook, not the initial stop request response.

## Ordering and transactionality

- Session state write happens before Voximplant client relay stop.
- Finish + recording stop are not a single DB transaction across provider boundaries.

## Idempotency / duplicate behavior

- Duplicate FINISH suppression is mostly client-side (button disabled during submit).
- Server has explicit no-op only for PAUSE/RESUME; FINISH idempotency is partial/implicit.
- Vox stop relay has per-tab `stopInFlightRef`, but no global idempotency key across clients/tabs.

## Rejoin/debrief implications

- FINISHED is treated as closed by `buildSessionCloseState`, but room UI still supports debrief for connected users.
- Rejoin validation currently routes finished sessions to materials, so reconnecting into debrief is restricted.

## Redirect wait for recording finalization

- Redirect/navigation does not wait for recording finalization; users can open materials while recording is `STOPPED/PROCESSING`.

## Target clarification for Event completion reuse

- Event completion must not bypass canonical Session completion orchestration.
- Future Event completion flow must batch through same Session completion backend path used by facilitator FINISH, with Event-completion mode and idempotent operation ownership.
