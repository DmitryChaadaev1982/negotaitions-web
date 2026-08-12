# Stage 3.13E Debrief And Recording Reconciliation

## Scope and safety

This follow-up remediates two independently proven failures:

1. shared Session Debrief occupancy could ignore active humans after a normal
   role transition and close the room;
2. a lost Voximplant `RECORDING` callback could leave the database in
   `STARTING`, block STOP on missing `egressId`, and lose the normal file
   finalization path.

The investigation used the configured local development database
(`localhost:5432/negotiations`) read-only. No historical row was repaired. No
production mutation, deploy, commit, push, or Voximplant upload is part of this
change.

## Authoritative Debrief contract recovered

- `DEBRIEF_AUTO_CLOSE_GRACE_MS` remains **30,000 ms**.
- Normal negotiation FINISH always writes `negotiationState=FINISHED`,
  authoritative `negotiationEndedAt`, and `roomLifecycle=DEBRIEF_OPEN`.
- Empty-room auto-close is eligible only in `DEBRIEF_OPEN`.
- Every active human `SessionRoomConnection` counts. Occupancy does not compare
  `SessionParticipant.type` with `SessionRoomConnection.role`.
- The effective empty-period boundary is
  `max(negotiationEndedAt, last relevant room-connection departure)`.
- Explicit disconnect, supersede, and revoke use their terminal timestamp.
  Passive loss uses the lease `expiresAt` boundary.
- A rejoin makes a pending close fail the final SQL guard. A later departure
  creates the new current empty period.
- Empty-Debrief expiry, explicit facilitator End Session, and Event authority
  use one idempotent final Session-close mutation. Session completion does not
  complete its `TrainingEvent`.

The approximately 120-second passive room-lease expiry is not Debrief grace.
The 90-second server-stop terminal timeout and 90-second stale-STARTING
reconciliation threshold are also independent.

## Callback-loss forensic timeline

Affected Session: `cmsq5ntja002eocuapyx8tkm9`
Attempt: `41cdd9d6-2866-4b50-adaa-aaa4ecd1346d`

- `14:01:47.780Z`: Voximplant emitted `Recorder.Started`.
- `14:01:48.737Z`: the local Recording row was observed in `STARTING` with the
  exact attempt ID. Cross-system wall clocks do not establish dispatch order;
  code inspection proves START admission commits before RC3 dispatch.
- `14:01:53.818Z`, `14:02:00.071Z`, `14:02:06.573Z`: all bounded
  `recording` webhook attempts returned Vox transport code `-7`; retries were
  exhausted.
- Provider-session registration succeeded independently and persisted the
  control channel for RC3 scenario build
  `main-room-recording-attempt-fencing-2026-08-12-rc3`.
- `14:02:49.159Z`: natural timer completion wrote negotiation FINISHED and
  created a recording STOP operation.
- The STOP operation immediately failed with
  `RECORDING_STARTING_NOT_READY` / `recordingStartingNotReady`, because the old
  Vox path incorrectly required `egressId` while the callback carrying it had
  been lost.
- `14:03:00.008Z`: the facilitator explicitly left. Two observer-role room
  leases remained active, but their `SessionParticipant.type` was
  `PARTICIPANT`; the old role-equality occupancy join ignored both.
- `14:03:19.173Z`: the old `materials/status` timeout path changed the
  Recording to
  `FAILED + RECORDING_STARTING_TIMEOUT_RECONCILED` without querying Vox.
- `14:03:32.058Z`: false zero occupancy closed the Debrief. Room clients then
  received the canonical close redirect and tore down their Vox calls.
- `14:05:03.166Z`: the empty scenario terminated and `Recorder.Stopped`
  supplied a real recording URL/file. This was provider shutdown, not a normal
  application STOP command.

Control Session `cmsq5kkyo0011ocuataiyvwfe` followed the normal path:
`RECORDING` callback accepted, exact STOP accepted at `13:58:04.943Z`,
recorder stopped about 86 ms later, and the database reached `COMPLETED`.

### Direct forensic answers

1. The affected database attempt entered `STARTING` at
   `14:01:48.737Z`.
2. It never entered canonical `RECORDING`.
3. The old stale-STARTING branch in
   `app/api/sessions/[sessionId]/materials/status/route.ts` changed it to
   `FAILED`.
4. It persisted `RECORDING_STARTING_TIMEOUT_RECONCILED`.
5. Provider-session/control metadata was persisted successfully.
6. A STOP operation was attempted when negotiation ended.
7. It did not reach Vox because local delivery classified STARTING without
   `egressId` as `RECORDING_STARTING_NOT_READY`.
8. Yes: canonical STARTING plus missing callback-derived `egressId` caused the
   old STOP path to reject locally; the later recoverable FAILED state was also
   not eligible.
9. False occupancy closed the room, redirected clients, and removed the human
   calls that had kept the scenario alive.
10. Provider scenario termination, not application STOP, finally stopped the
    physical recorder.

## Implemented lifecycle correction

- Shared occupancy now reads active lease truth by Session and active User,
  without a `SessionParticipant` role-equality join or a lease-role filter.
- The final close repeats occupancy and grace guards in the same SQL mutation,
  so a racing rejoin makes closure a no-op.
- Final Session close atomically writes `status=COMPLETED`, `endedAt`,
  `roomLifecycle=CLOSED`, `closeReason`, and `updatedAt`. Event authority alone
  writes `closedByEventAt/closedByEventId`.
- Shared lifecycle code does not select a route. Existing standalone and Event
  close-state/navigation policies remain container-specific.
- Shared Session overview status derivation now presents
  `FINISHED + DEBRIEF_OPEN` as `Debrief` / `Дебриф`. `Completed` /
  `Завершено` requires the canonical terminal Session state
  (`status=COMPLETED + roomLifecycle=CLOSED`), with compatibility for
  historical completed rows whose lifecycle is null. Recording,
  transcription, and analysis completion do not override an open Debrief.
- `canReturnToRoom`, token rejoin, account rejoin targets, Session details, and
  Event active assignment use that same canonical terminal derivation.
  `FINISHED + DEBRIEF_OPEN` remains returnable through the 30-second empty-room
  grace and reconnect; only canonical Session close, deletion, or Event
  authority close disables return. Existing access/token/participant checks
  remain authoritative.

## Implemented recording correction

- `recordingAttemptId` is persisted with `STARTING` before dispatch. Admission
  no longer writes `startedAt`; provider-confirmed `Recorder.Started` owns that
  timestamp.
- Vox RC3 STOP accepts exact fenced `STARTING` without `egressId`. Only
  `FAILED + RECORDING_STARTING_TIMEOUT_RECONCILED` with an exact attempt and
  persisted control channel gets the narrow failed-state exception. LiveKit
  guards remain unchanged.
- RC4 adds signed `get_recording_status` for one exact attempt and a bounded
  immutable terminal cache (8 attempts, 60-minute TTL).
- Existing control-state/materials polling admits only stale STARTING, durable
  stopping, and the narrow recoverable failure. A recording-row CAS plus
  process single-flight coalesces calls; the per-attempt throttle is 30 seconds.
- Exact active status restores canonical RECORDING and can re-drive a due
  failed/timed-out STOP for the same attempt.
- Exact STOPPED metadata goes through safe key normalization, S3 HEAD outside a
  transaction, and a second attempt/status CAS before normal completion.
- Unavailable/unknown provider state becomes the bounded recoverable
  `RECORDING_STARTING_TIMEOUT_RECONCILED` warning. The indicator renders orange
  `Recording did not start` / `Запись не запустилась`; only canonical
  `RECORDING` renders active recording.

## Rollout order

RC4 was manually activated before the application rollout. Its current exported
source matches the repository source byte-for-byte:

- marker: `main-room-recording-reconciliation-2026-08-12-rc4`;
- SHA256: `040e7c5557c3156133a48556da1a6b86976f058fb969f111d9c673c9a2368553`.

Remaining order:

1. Preserve the current RC4 source/build artifact and require zero active
   recording, stop-delivery, transcription, enhancement, or AI-analysis work.
2. Apply the additive nullable `recordingAttemptId` migration/index through the
   guarded production overlay.
3. Deploy the compatible application (legacy RC2 rows remain legacy-only).
4. Verify the existing RC4 marker and exact-attempt telemetry.

Do not upload Voximplant again as part of this rollout. Application
`601704bafde7da219fe1f1e37737e7769a09a6f9` continues to use legacy RC2
recording messages, callbacks, and server-stop commands; RC4 retains that path,
so a quiescent application rollback may keep RC4 active. An exact RC3 source is
not present in repository files or Git history, and the Voximplant API exposes
the current script but no scenario-version history.

## Validation

Validation results are recorded after the final runtime diff stabilizes.
