# Stage 3.12B-W1 Reconnect Media State

## Affected Session

- Session: https://local.negotaitions.ru/room/cmsd58m9i00001gua9z1n22z2
- Parent Event lobby: https://local.negotaitions.ru/events/cms7ru4bi0000t8uaoxjonu23/lobby

## Reproduction

Observer reproduction:

1. Join the active negotiation as `Test` observer.
2. Leave the Session.
3. Rejoin while the negotiation is still active.
4. The observer tile can be recreated with stale microphone state from the previous room connection.

Facilitator reproduction:

1. Facilitator is in the same active negotiation.
2. Facilitator leaves through normal product navigation.
3. Facilitator rejoins while the negotiation remains active.
4. The same stale connection media-state risk applies to the facilitator/self tile and remote facilitator tile.

## Actual State After Reconnect

Source inspection shows that during `RUNNING`, the room control contract sets `micAllowed=false` for observer and facilitator roles. The local room page enforces that policy by muting the local microphone after reconnect. Participants keep the normal participant microphone policy.

The observed stale display was caused by the rendered remote tile trusting cached session media status without proving that the status belonged to the current `SessionRoomConnection.connectionId`.

## Displayed State Before Correction

- A stale `micEnabled=true` record from the previous connection could be merged into the reconnected participant model.
- Connected unknown media was normalized to `off`, hiding the difference between unknown reconnect state and authoritative muted state.
- Remote active-speaker state was derived from any current audio stream and was not gated by the resolved tile microphone state.
- The tile border resolver evaluated active speaking before muted state.

## Root Cause

The session media-status cache is keyed by participant id and stores a `connectionId`, but `room-sidebar` exposed the cached `micEnabled` and `cameraEnabled` values without checking that the cached `connectionId` matched the current active room lease for that user.

After reconnect, `SessionRoomConnection` correctly advances to the new durable user connection, but the old media-status record could still overwrite the current-generation provider/track evidence until the new client published fresh media status.

## Generation Ownership

The fix treats the active `SessionRoomConnection.connectionId` as the media generation for session media-status records:

- matching `connectionId`: media status is current and can render;
- mismatched `connectionId`: media status is stale and ignored;
- no current media record: media state remains unknown/neutral unless an actual current track provides evidence.

Provider endpoint deduplication remains by normalized Vox username, not display name.

## Active-Speaker Lifecycle

Remote speaking meters are now bound to the roster/provider merged model:

- meters attach only when the current tile resolves to microphone enabled;
- missing or disabled audio tracks do not attach an analyser;
- muted state resets speaking to false;
- track removal or stream replacement disposes the previous meter state;
- late callbacks are accepted only when their generation still matches the current meter generation.

Thresholds and debounce values were not changed.

## Muted Red-Border Contract

Tile visual precedence is documented in `VoximplantParticipantTile`:

1. disconnected/stale;
2. muted;
3. active speaking;
4. connected/default.

Muted users cannot show an active-speaker border. Facilitator, observer, participant, and self tiles all use the same resolved media model and border precedence.

## Results

- Observer reconnect muted: stale old `micEnabled=true` is ignored; current `micEnabled=false` renders muted state.
- Observer unmute/speaking: current `micEnabled=true` can enable speaking highlight when a valid current track is present.
- Facilitator reconnect muted: stale old state is ignored; current muted state is accepted.
- Facilitator unmute/speaking: current enabled state is accepted and permits speaking highlight.
- Participant reconnect: participant A muted and participant B enabled states are scoped to their current connections.
- Repeated reconnect: current media status is scoped to the latest connection and duplicate active leases are superseded.
- Camera regression: microphone reconnect does not alter camera state.
- Observer ordering: existing stable roster ordering remains unchanged.

## Tests

Passed:

- Focused reconnect media unit suite: 44 passing tests.
- Focused reconnect media Playwright spec: 4 passing deterministic DB/provider-state simulations.
- Camera/media layout model: 26 passing tests.

Attempted but blocked:

- Room parity API test currently fails on the first sidebar API call before reconnect assertions. The failure is outside the reconnect media-state path and should be investigated separately.

Not run:

- `npm run test:e2e:observer:layout` was not run.
- Manual browser verification and screenshots were not completed in this pass because the local HTTPS proxy returned `502 Bad Gateway`, and the available port-3000 owner was `chrome.exe`, not a confirmed dev server.

## Known Limitations

- The focused E2E spec uses deterministic database/provider-state simulation instead of real audio hardware.
- Manual evidence screenshots still need to be captured against a working local HTTPS/dev-server setup.
