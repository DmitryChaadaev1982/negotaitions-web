# Stage 3.10 Manual Canaries

Use disposable sessions only. Do not use production participant data. Do not store names, transcript text, recording URLs, or secrets in evidence.

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
