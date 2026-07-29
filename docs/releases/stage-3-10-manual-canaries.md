# Stage 3.10 Manual Canaries

Use disposable sessions only. Do not use production participant data. Do not store names, transcript text, recording URLs, or secrets in evidence.

## Final M1-M7 status

- M1 PASS — facilitator canonical finish.
- M2 PASS — administrative finish without facilitator browser.
- M3 PASS — complete one Session from Event lobby.
- M4 PASS — complete Event with active recording.
- M5 PASS — explicit leave, logical presence, rejoin without duplication,
  active recording preserved, and recorder ReInvite sanitizer verified live.
- M6 PASS — `CLOSED` Session stale tabs, direct-room access, and redirects.
- M7 PASS — recording, transcription, enhancement, speaker mapping, AI
  analysis, publication, and participant materials.

Exact tested main-room scenario:

- marker: `main-room-server-stop-2026-07-28-rc6`
- SHA-256:
  `D9324A97E7CEC42DDC2515AF04F467ABFF9364BB01CEB37FF04623149DE6AAE5`

Known residual issue: Voximplant upstream emits an unbacked recorder
`vi/conf-info-added` ReInvite cause. The sanitizer is the current mitigation and
must remain installed before conference module registration until the provider
or WebSDK fixes the mismatch and this canary passes without sanitization.

Future backlog: define the long-horizon lifecycle for empty `OPEN` Sessions and
empty Events in hours or bounded by Event lifetime. Do not apply the short
`DEBRIEF_OPEN` auto-close grace to `OPEN`.

## Stage 3.10 server-stop rollout canary

Mode progression:

1. Start with `VOXIMPLANT_SERVER_STOP_MODE=disabled` (behavior compatibility check).
2. Switch to `prefer_server_with_relay_fallback` for bounded rollout.
3. Validate fallback frequency and terminal callback latency.
4. Promote to `prefer_server_no_relay_fallback` only after callback reliability is proven.

Rollback:

- Immediate rollback is env-only: set `VOXIMPLANT_SERVER_STOP_MODE=disabled` and restart app.
- Do not drop additive schema objects (`SessionVoximplantControlChannel`, `VoximplantCallbackNonce`, added stop evidence columns).

## ST310-VOX-023 — Provider Auto-finalization Reconciliation

1. Create disposable standalone session with facilitator + participant.
2. Confirm scenario build marker in Vox logs.
3. Start recording, then finish from facilitator controls.
4. Keep at least one client connected for relay eligibility.
5. Observe relay claim and duplicate relay behavior from second client.
6. Confirm webhook receipt and recording transition.
7. Verify stop-operation state converges (`DELIVERED` or reconciled terminal).
8. Confirm materials page availability and transcript pipeline start.

Expected evidence:

- Sanitized scenario logs: build marker, stop request, relay path, webhook POST.
- App logs: canonical finish, stop-operation transition.
- DB: recording status timestamps + stop-operation row.

## ST310-VOX-024 — Remote Scenario Drift + Rule Binding

1. Export currently deployed scenario source.
2. Record current build marker from logs.
3. Compare deployed source/build marker to local canonical marker.
4. Confirm rule binding targets `neg-conf-main-room`.
5. Run disposable canary join/start/stop.
6. Confirm webhook contract unchanged and signed.

Expected evidence:

- Sanitized drift report (marker + hash metadata only).
- Rule binding screenshot/text (no secrets).
- Sanitized canary logs and app receipt.

## ST310-VOX-025 — Recorder.Stopped After Provider Shutdown

1. Use disposable session with active recording.
2. Trigger facilitator finish and then controlled conference termination path.
3. Validate `ConferenceEvents.Stopped` / `AppEvents.Terminating` observability if reproducible.
4. Confirm stopped webhook arrives and recording status advances.
5. Confirm materials remain accessible.

Expected evidence:

- Sanitized scenario termination logs.
- App webhook logs with successful signature validation.
- Recording + stop-operation terminal state.

## ST310-PRESENCE-011 — Multi-browser/device Presence

Setup:

- Browser A profile: facilitator.
- Browser B profile/device: participant.
- Browser C tab: same facilitator account (newest-tab takeover check).

Procedure:

1. Join from A and B; then join same facilitator from C.
2. Confirm newest-tab takeover (A becomes stale).
3. Attempt control action from stale A (expect stale rejection).
4. Refresh C within grace; verify continuity.
5. Perform explicit leave from B only; verify C remains active.
6. Simulate abrupt close on C; wait expiry sweep window; verify closure behavior.
7. Validate debrief rejoin and materials redirect behavior after finish.

Expected evidence:

- UI: stale-connection handling + redirects.
- DB: superseded/disconnected rows and lifecycle state.
- Logs: claim/supersession/disconnect/closure decisions.

## ST310-VOX-026 — Any-client Relay + Duplicate Relay

1. Disposable session with at least facilitator + participant (optional observer third client).
2. Start recording and finish session.
3. Trigger relay from participant/observer client.
4. Trigger duplicate relay from another client.
5. Verify one logical stop operation persists and converges.
6. Confirm webhook reconciliation path and no over-recording beyond accepted threshold.

Expected evidence:

- Scenario logs: relay attempts + stop status.
- App logs: single operation id, duplicate handling.
- DB: one stop operation per recording, terminal status convergence.

## ST310-VOX-027 — Takeover Race + Observer Endpoint Churn

Setup:

- Browser A: facilitator (active tab first).
- Browser B: participant.
- Browser C: same facilitator account (newest-tab takeover).
- Optional Browser D: observer joining/leaving while session is active.

Procedure:

1. Takeover before preparation and confirm only newest tab keeps control.
2. Takeover during preparation while stale tab is still connecting.
3. Takeover during active negotiation while media is flowing.
4. Takeover during `DEBRIEF_OPEN`.
5. Run repeated A -> B -> A lease supersession cycle.
6. From stale tab attempt mic/camera toggle and facilitator control actions.
7. Verify participant continuity (no duplicate participant identities).
8. Keep recording active during takeover, then finish and stop recording from active tab.
9. Confirm there are no uncaught page errors and no development overlay errors for:
   - `ConferenceImpl.handleReInvite` / `mids`
   - `EndpointManagerImpl.setEndpointVad: Can't find endpoint ...`
10. Observer canary: observer joins active conference, participant speaks, observer leaves, active participants keep audio/video, observer appears once, facilitator keeps control authority.

Expected evidence:

- UI: stale tab blocked immediately; active tab remains fully functional.
- Logs: single active lease holder; stale tab heartbeat/control polling stops.
- Provider behavior: no stale-tab media/control mutation reaches SDK.
- Recording: active tab can still complete session and stop recording.

## ST310-013/014/015 — Presence + Vox SDK Regression Addendum

Run this addendum on the same disposable event/session setup used for Tests 13–15.

Presence assertions:

1. Explicit participant leave updates Events `In Sessions` within 3-5 seconds.
2. Browser close/F5/network drop does not immediately remove in-session presence.
3. After lease expiry, `In Sessions` drops on the next list poll.
4. Multiple active tabs for one user count once in `In Sessions`.

Vox SDK assertions:

1. Late observer can join an already active session.
2. Facilitator control authority remains correct during `RUNNING`.
3. No Next.js overlay appears for known benign SDK races (`mute`, VAD endpoint race).
4. Real transport/gateway failures remain visible in console errors.
5. Audio/video, timer, and recording continue to function normally.

## ST310-VOX-028 — Join While Recorder Endpoint Is Active

Covers the deterministic WebSDK ReInvite fault where the VoxEngine audio
recorder is announced as a `vi/conf-info-added` cause without a matching
`scheme.endpoints` entry. Any client joining after recording has started hits it,
which in practice means every rejoin.

Setup:

- Fresh `npm run dev`, no reused tabs.
- Three fresh private browser contexts: facilitator + participant A + participant B.
- One new Event Session, recording started and confirmed active.

Procedure:

1. All three join the room and confirm mutual audio/video.
2. Confirm recording is active (`recording_status` reached `recording`).
3. Participant B leaves the room explicitly via the leave control.
4. Confirm B disappears from the facilitator roster and from A's roster, and that
   the Session stays `OPEN` with recording still running.
5. Participant B rejoins the same room.

Expected evidence:

- Console on the rejoining client shows **no**
  `Cannot read properties of undefined (reading 'mids')` and no
  `[Voximplant SDK log downgraded once] reinvite_mids_race`.
- Console on the rejoining client shows exactly one
  `[Voximplant] dropped unresolvable ReInvite cause vi/conf-info-added ...` line.
  Absence of this line while recording is active means the sanitizer did not run
  and the ordering guarantee is broken.
- Rejoined participant appears exactly once in every roster, with one media tile.
- Rejoined participant both hears and is heard; video appears when enabled.
- Facilitator and participant A keep working audio/video throughout.
- Session remains `OPEN`; recording continues; no `SessionRecordingStopOperation`
  row is created by the rejoin.
- Provider session log shows a `Call.ReInviteAccepted` from the rejoining call id
  for the initial full-roster ReInvite. Its absence is the failure signature.
