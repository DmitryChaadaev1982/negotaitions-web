# Stage 1 Final Room Polish Audit (Correction 3)

## Scope and guardrails

- Work directory: `C:\Projects\Negotiations AI\negotiations-web-yandex-ai`.
- Stage 2 lobby migration is out of scope and is not started in this correction.
- No Prisma schema/migration changes.
- No Vox webhook route changes.
- No Vox scenario/rule changes.
- No recording dispatch contract changes.
- No Yandex SpeechKit/Yandex AI/DeepSeek pipeline changes.

## 1) Why Diagnostics tile/section is visible in normal mode

- `components/voximplant-video-layout.tsx` renders diagnostics when either `unknownRosterTiles` or `unknownTiles` is non-empty.
- `unknownTiles` are computed from `remoteParticipants` that are not in `usedRemoteIds`.
- Current `usedRemoteIds` logic only adds remote IDs when a matched roster tile has a non-null video stream.
- Remote endpoints without current video stream (camera off/connecting) can be treated as leftovers and appear under diagnostics as unknown, even when they are actually mapped.
- Result: a diagnostics area can appear in normal room mode due to stream-state mismatch, not true unknown endpoints.

## 2) How unknown endpoints are currently detected

- Roster mapping key: normalized `voximplantProviderUsername` from sidebar roster.
- Remote mapping key: normalized `endpointUsername` from SDK endpoints.
- Resolved roster tiles are built first; leftovers in `remoteParticipants` become `unknownTiles`.
- Unknown roster entries are also possible when role zoning resolves to `unknown` in `resolveRosterVisualRoles`.

## 3) Which flags/query params should control diagnostics visibility

- Current room page already has debug controls:
  - `debugAudio` (`?debugAudio=1`) for audio diagnostics panel.
  - `debugRecording` (`?debugRecording=1`) for recording debug panel.
- Room-layout diagnostics should be shown only when:
  - there are real unknown/unmapped endpoints/roles; or
  - explicit debug mode is enabled (`debugAudio` or `debugRecording`).
- Normal participant mode should not render a placeholder diagnostics section.

## 4) How observer row is currently aligned and why single observer is not centered

- Observer row currently uses `flex gap-2 overflow-x-auto`.
- There is no `justify-center`; one observer aligns to start/left.
- Compact observer tiles are constrained by `max-w`, but row alignment is not center-driven.

## 5) How mic/video buttons currently determine visual state

- `VoximplantControlBar` in `components/voximplant-negotiation-room-page.tsx` uses:
  - `micCaptureStatus` for mic text and limited color classes;
  - `isCameraOn` for camera text and amber fallback color.
- State signaling is mostly text/icon-like and not strongly color-coded for:
  - enabled/on,
  - disabled/off,
  - policy-locked/system-muted.
- Accessibility labels/titles for explicit Russian on/off/locked phrasing are not complete.

## 6) How mic state, user mute, system mute, and active speaker are currently represented

- Mic state:
  - Local: `isMicMuted` + `micCaptureStatus` from `useVoximplantRoom`.
  - Remote: no dedicated remote mic-state feed in current hook result.
- System mute:
  - Derived from `controlState.micAllowed`.
  - Page effect toggles local mic when policy disallows.
- User mute:
  - Local user mute represented by `isMicMuted`.
  - Remote user mute is not available directly in current state model.
- Active speaker:
  - Local only via `micLevel` threshold in `voximplant-video-layout`.
  - Remote active speaker is not tracked in current hook/layout model.

## 7) Whether Vox SDK exposes active speaker/audio level/speaking events in current hook

- Current `useVoximplantRoom` implementation computes local `micLevel` via `AnalyserNode` on local mic stream.
- Hook does not currently compute or expose per-remote speaking/audio levels.
- No explicit remote active-speaker event mapping is implemented in this hook.
- Current room UI therefore has reliable local speaking indication only.

## 8) How audio policy is applied across PREPARATION, RUNNING, PAUSED, FINISHED

- Policy source is `lib/negotiation-control.ts`:
  - `PREPARATION/PREPARATION_RUNNING/PREPARATION_PAUSED/READY_TO_START/FINISHED`: `micAllowed=true`.
  - `RUNNING`: `micAllowed=true` only for `PARTICIPANT`; `false` for facilitator/observer.
  - `PAUSED`: `micAllowed=false` for all.
- Enforcement path in room page:
  - Effect in `components/voximplant-negotiation-room-page.tsx` mutes local mic when `micAllowed=false`.
  - Auto-unmute currently only restores participants in specific conditions.

## 9) Whether FINISHED clears policy-driven mute restrictions

- Control-state policy sets `FINISHED` as `micAllowed=true`.
- Current client-side restore effect only auto-unmutes participants and can leave facilitator/observer muted if they were muted by policy in RUNNING/PAUSED.
- Therefore FINISHED may not fully clear policy-muted local state for non-participants in current implementation.

## 10) Why empty observer row reserves too much height

- Observer section is always rendered (correct for structure), but current presentation can still create visible vertical overhead due to:
  - section spacing and larger tile baseline in row mode;
  - empty-state container styling that is not optimized for minimal footprint.
- Combined with main grid spacing this can look like a large blank block on facilitator screen before observers join.

## 11) Minimal fix plan

1. Diagnostics visibility
   - Fix leftover endpoint detection so mapped no-video endpoints are not treated as unknown.
   - Gate diagnostics rendering to real unknowns or explicit debug flags.
   - Keep unknown endpoint diagnostics available when they are real.

2. Observer row alignment and compact empty state
   - Center observer row with `justify-center`.
   - Keep compact tiles and wrapping for multiple observers.
   - Reduce empty-state visual footprint while preserving row presence.

3. Mic/video control clarity
   - Introduce strong state colors:
     - green/on,
     - red/off,
     - gray/locked for policy/system-muted.
   - Add explicit Russian `title`/`aria-label` states:
     - `Микрофон включён`,
     - `Микрофон выключен`,
     - `Камера включена`,
     - `Камера выключена`,
     - `Микрофон заблокирован правилами сессии`.

4. Mic-enabled and speaker indicators
   - Add clear mic-state badge per tile (local + remote fallback from policy/roster).
   - Keep local active speaker highlight from `micLevel`.
   - Do not fake remote speaker highlights without reliable SDK data.
   - Document remote active-speaker limitation in fix report.

5. Audio policy reset behavior
   - Refine policy-mute restore logic to avoid stale lock after FINISHED/READY/PREPARATION.
   - Ensure policy-driven auto-unmute can restore any role that was policy-muted.
   - Preserve RUNNING/PAUSED restrictions.
   - Keep camera independent from audio policy.

6. Tests
   - Extend targeted Vox tests to cover:
     - diagnostics gating logic,
     - observer alignment/compact empty-state selectors,
     - button state labels/classes,
     - mic policy transitions `RUNNING -> PAUSED -> RUNNING -> FINISHED`,
     - tile mic/speaking indicator behavior and non-stale highlighting assumptions.
