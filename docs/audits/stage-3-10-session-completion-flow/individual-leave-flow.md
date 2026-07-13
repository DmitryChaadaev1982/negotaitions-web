# Individual Leave Flow (Current)

## Common leave mechanics

- Room leave action in Vox room: `markSessionLeftFlag(sessionId)` -> provider `leave()` -> `router.push(materialsUrl)`.
- Leave does not directly call `/api/sessions/[sessionId]/control` FINISH.
- Presence update after leave is indirect (heartbeats stop; `lastSeenAt` ages out).

## Facilitator leaves without finish

- Current behavior: facilitator disconnects only their own client path.
- No direct session FINISH write from leave handler.
- Session can remain active if negotiation not otherwise finished/closed.
- Risk: if no facilitator remains, session can still be RUNNING/PAUSED without explicit closure transition.

## Participant leaves

- Disconnects own client and navigates to materials.
- Does not stop recording and does not finish session.
- Other participants remain in room.

## Observer leaves

- Same as participant leave behavior.
- No direct session-state mutation.

## Event participant vs standalone participant

- Redirect destination from room leave is materials URL:
  - account mode: `/sessions/[sessionId]/materials`
  - token mode legacy path built by helper for join flow
- Event context adds optional lobby links in shell, but leave button itself still targets materials path in room adapter.

## Non-click exits

- Browser tab close/network loss: no guaranteed explicit leave API; system relies on heartbeat timeout and stale status derivation.
- Browser back/refresh: route guards decide destination based on current session close/activity predicates.

## Rejoin after leave

- Rejoin is possible while session is considered active by `isSessionActiveForRoom`.
- If negotiation already `FINISHED`, rejoin validation routes to materials (not room).
