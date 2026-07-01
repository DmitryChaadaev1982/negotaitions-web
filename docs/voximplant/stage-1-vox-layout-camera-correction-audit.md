# Stage 1 Correction 2 Audit: Vox Layout, Roles Refresh, Camera Toggle

## Scope And Guardrails

- Work scope: Stage 1 room UX/presence/camera correction only.
- Stage 2 lobby migration is not started in this correction.
- Prisma schema/migrations are not part of this correction.
- Vox webhook route, Vox scenario/rule, recording dispatch contract, and Yandex SpeechKit/Yandex AI/DeepSeek pipeline are outside this correction scope.

## 1) Current Layout Model (Before Correction)

- **Model type**: mixed, partially roster-first and partially stream-first.
  - Roster was used to build zone candidates.
  - Stream presence was still driving practical visibility and perceived placement because of section order and video-first rendering.
- **Facilitator tile selection**:
  - from `SessionRosterEntry.participantType === FACILITATOR`.
- **Participant A/B tile selection**:
  - from participant role-name parsing (`Participant A/B`, `participant_a/b`, Russian equivalent).
  - non-A/B assigned participant names were pushed to unknown or fallback paths.
- **Observers selection**:
  - from `participantType === OBSERVER` plus unassigned participants fallback.
- **Unknown endpoints handling**:
  - unmapped remote endpoints were shown under unknown participants diagnostics.
  - no explicit guarantee in layout composition to keep unknowns out of principal zones.

## 2) Current Observer Rendering (Before Correction)

- Root cause of "observers section not visible":
  - observers were rendered as a lower section after timer/facilitator/participants, not as a top persistent band.
  - on desktop this frequently pushed observers below the fold in real room usage.
- Empty observers section:
  - technically rendered (`No observers connected`), but not guaranteed visible because of section placement.
- Stream dependency:
  - observer tile identity came from roster, but UX still appeared stream-first because video surface dominated and observers were not structurally prioritized.

## 3) Current Role Reassignment Update Path (Before Correction)

- **Apply roles write path**:
  - role assignment updates `SessionParticipant.sessionRoleId` in domain APIs.
- **Sidebar/roster refetch path**:
  - room page polls `/api/livekit/sidebar` every 1s.
- **Vox layout update path**:
  - `sidebar.roster` was passed to Vox layout and recomputed by memoized transforms.
- **Memoization risk**:
  - role zoning relied heavily on role-name parser; if case role labels did not match A/B patterns, visual zones did not move as expected even after fresh polling data.
- **Client propagation**:
  - all connected clients already poll sidebar/control-state every 1s, so propagation exists; issue was zone recomputation semantics, not missing transport.

## 4) Current Camera Toggle Logic (Before Correction)

- Local video stream creation:
  - camera-on path always attempted `createVideoStream` when re-enabling after off.
- Camera-off behavior:
  - previous implementation stopped/released local video stream and reset local stream references.
- Camera re-enable behavior:
  - attempted add-stream flow again, depending on internal `videoStreamAdded` state.
- Duplicate add risk:
  - after off/on, conference slot could already be occupied by previous video stream type state; re-adding could hit SDK duplicate errors.
- Concurrent click guard:
  - `videoOpPending` guard exists and prevents concurrent toggles.

## 5) Root Causes

1. **Missing observers section (manual smoke)**  
   Primary cause: layout structure order, not only data. Observer zone was rendered late and effectively hidden by viewport flow.

2. **Apply roles does not move users visually**  
   Primary cause: participant slot mapping depended on strict role-name parsing; with non-standard role names reassigned users did not land in A/B zones as expected.

3. **Incorrect room structure**  
   Primary cause: section-by-section stack (`timer -> facilitator -> participants -> observers`) instead of required domain-first composition (`observers top + 3-column negotiation core + diagnostics`).

4. **Camera duplicate video stream error**  
   Primary cause: camera off removed local video stream object; camera on attempted fresh video add and could encounter `Stream with type video already exists` conference-side state mismatch.

## 6) Minimal Fix Plan

1. Implement a pure roster-first layout model helper:
   - deterministic domain zone mapping (`facilitator`, `participant_a`, `participant_b`, `observer`, `unknown`);
   - explicit handling for unassigned participants as observer/unassigned;
   - fallback deterministic two-slot assignment when role labels are non-A/B.

2. Restructure Vox room visual composition:
   - observers row always on top and always rendered (with compact empty state text);
   - desktop three-column core: participant A / center facilitator+timer / participant B;
   - diagnostics zone only for unknown/unmapped entities.

3. Keep role reassignment refresh poll path:
   - continue consuming sidebar polling data (1s interval);
   - consume latest roster in layout helper so all clients converge without reload.

4. Make camera toggle idempotent:
   - camera off disables existing video track (does not force duplicate re-add later);
   - camera on reuses existing track when present;
   - create/add stream only if no reusable video stream exists;
   - treat duplicate stream-type error as recoverable mismatch;
   - preserve non-fatal user error for unavailable camera.

5. Add focused tests for layout and camera helper logic:
   - roster-first zone mapping with missing stream;
   - observer/unassigned behavior;
   - reassignment recompute behavior;
   - unknown role isolation;
   - camera idempotent enable plan and duplicate-error classification.

## 7) Polling Interval Note

- Existing room polling interval is 1 second for sidebar and control-state in `voximplant-negotiation-room-page`.
- This correction keeps the same interval and documents it as the expected role-refresh latency bound for connected clients.
