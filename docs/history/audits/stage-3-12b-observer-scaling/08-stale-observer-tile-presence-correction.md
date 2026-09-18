# Stale Observer Tile Presence Correction

## Classification

`REGRESSION_FROM_STAGE_3_12B_O`

The Stage 3.12B-O observer rail intentionally changed observer rendering from active observer tiles to every roster entry whose visual zone resolved to `observer`. Source inspection shows that change made the rail scalable and stable, but it also let historical or inactive observer roster entries keep occupying media tiles.

## Reported Defect

Manual local testing found that after an observer left the Session room, their observer tile stayed in the observer rail as an inactive grey media tile. The same observer could also remain visible as inactive in the facilitator management/sidebar roster.

The corrected distinction is:

- Management/sidebar roster: known Session/Event participants may remain visible with inactive status.
- Active observer media rail: only observer-zone entries with current valid room presence may occupy a video tile.

## Root Cause

`components/voximplant-video-layout.tsx` built `observerTiles` from every resolved roster tile whose zone was `observer`.

That meant `SessionParticipant` roster membership was used as active media membership. `SessionRoomConnection` state was already exposed on each `SessionRosterEntry` as `isLogicallyPresent`, `logicalConnectionId`, and `logicalDisconnectReason`, but it only affected tile connection styling through the normalized media model. It did not decide whether an observer rail tile should exist.

After explicit leave or lease expiry, the server-side sidebar payload correctly reports `isLogicallyPresent: false`, but the stale observer entry still resolves to the `observer` visual zone and therefore remained in the rail as a grey tile.

## Corrected Contract

`lib/voximplant/room-layout-model.ts` now exposes `shouldRenderObserverRailTile`.

The observer rail includes a roster entry only when:

- the resolved visual zone is `observer`;
- `SessionRoomConnection` logical presence is active (`isLogicallyPresent === true`);
- provider-bound observers still have current active media/provider presence.

The rail excludes entries whose connection has explicitly left, expired, been superseded, been revoked, or is only a historical/known participant without active logical presence. For observers with a Voximplant provider identity, active lease alone is not enough to keep a rail tile: if the provider endpoint disappears, the tile is removed immediately rather than waiting for the two-minute lease window.

Camera state, microphone state, speaking state, and temporary absence of media tracks do not remove a tile while logical room presence remains valid.

## Behavior

Explicit leave:

- The existing explicit leave API sequence remains unchanged.
- Once `/presence/leave` records `EXPLICIT_LEAVE` and the sidebar poll refreshes, the observer rail removes the tile.
- The participant may remain visible in the facilitator management roster.

Abrupt disconnect and lease expiry:

- Stage 3.10 lease storage and expiry helpers are unchanged.
- Provider-bound observer rail membership follows current media/provider presence first, so provider disconnect removes the tile immediately.
- The rail still follows the server-derived logical presence field already exposed by the sidebar payload to exclude finalized/expired connections.
- When the server-side lease is expired or finalized and sidebar state refreshes, the observer tile is removed.

Reconnect:

- Logical presence is summarized by user identity.
- A superseded old connection plus a valid replacement connection keeps one roster entry and one rail tile.
- Stable tile keys remain `SessionParticipant.id`, preserving rail order where possible.

Camera off:

- A camera-off observer with active logical presence remains in the rail.
- Existing placeholder/media-status rendering remains responsible for the visual camera-off state.

## Tests Added

- `tests/e2e/voximplant-layout-camera-model.spec.ts`
  - Covers the pure observer rail membership helper.
  - Proves explicit leave, expiry, historical/no-presence entries, and non-observer zones are excluded.
- Proves provider-bound observers disappear when the media/provider presence is gone even if the logical lease is still active.
  - Proves camera-off and mic-off do not exclude an active observer.

- `tests/e2e/stage-3-12b-observer-scaling.spec.ts`
  - Seeds user-bound observers with deterministic `SessionRoomConnection` rows.
  - Covers explicit leave while the facilitator role-management roster keeps the inactive observer row.
  - Covers lease expiry without a client timeout.
  - Covers reconnect before expiry without duplicate observer tiles.
  - Covers multiple observers where only active observers remain in the rail.
  - Covers the same membership semantics in `OPEN` and `DEBRIEF_OPEN`.

## Validation Notes

Pre-fix evidence:

- A first focused live-mode attempt was blocked before the rail assertion because the already-running development server used a different database from the E2E helpers, causing the seeded facilitator cookie to redirect to login.
- The pure helper scenario later passed; the same live-mode invocation also picked up unrelated observer-named API tests because of runner grep argument handling, and those failed for the same live-server/E2E-database mismatch.

Final validation results are tracked in `06-validation-results.md`.

## Manual Regression Status

Manual browser regression still needs to be repeated against the running local environment:

- Explicit observer leave.
- Abrupt observer departure.
- Reconnect before expiry.
- Camera off.
- Multiple observers.

Actual lease-expiry delay observed: pending manual verification. The configured lease window remains `PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS` (`120000` ms).
