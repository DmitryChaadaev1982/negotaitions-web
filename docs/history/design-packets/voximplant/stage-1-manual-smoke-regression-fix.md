# Stage 1 Manual Smoke Regression Fix (Correction 2)

## Scope Confirmation

- Work directory: `C:\Projects\Negotiations AI\negotiations-web-yandex-ai`.
- Stage 2 was **not** started.
- Event lobby migration was **not** started.
- Prisma schema/migrations were **not** changed.
- Yandex SpeechKit / Yandex AI / DeepSeek pipeline was **not** changed.
- Voximplant webhook route was **not** changed.
- Voximplant scenario/rule was **not** changed.
- Recording dispatch contract was **not** changed.
- Debug panel was **not** removed.
- No local tunnel URLs were hard-coded.
- No commit was created.

## Root Cause By Regression (Correction 2)

1. Facilitator camera toggle duplicate stream errors
   - Root cause: camera-off flow destroyed local video stream and camera-on attempted fresh add; SDK conference state could already hold video type and emit duplicate stream errors.
   - Fix: camera-off now disables track idempotently; camera-on reuses existing stream/track when present and only creates/adds when absent.

2. Observers section "missing"
   - Root cause: observers were rendered as a lower section after timer/facilitator/participants; in real viewport they were effectively below fold.
   - Fix: observers band is always rendered at top, with compact tiles and compact empty state.

3. Role assignment does not move users in room layout
   - Root cause: participant slot mapping depended on narrow role-name parsing and did not consistently remap non-A/B role labels after polling refresh.
   - Fix: deterministic roster-first zone resolver with fallback assignment for two negotiation slots and explicit unknown diagnostics.

4. Video room structure mismatch
   - Root cause: old stacked layout order (`timer -> facilitator -> participants -> observers`) did not match required domain-first desktop hierarchy.
   - Fix: desktop hierarchy is now observers top, main three-column negotiation row, diagnostics bottom.

5. Materials button visibility
   - Root cause: materials navigation in shared room header was hidden on smaller breakpoints (`sm` visibility gating), which made it appear missing.
   - Fix: materials button is now visible for allowed participants consistently.

## Files Changed

- `components/voximplant-video-layout.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `lib/voximplant/use-voximplant-room.ts`
- `lib/voximplant/room-layout-model.ts`
- `lib/voximplant/camera-toggle-logic.ts`
- `tests/e2e/voximplant-room-parity.spec.ts`
- `tests/e2e/voximplant-room-presence.spec.ts`
- `tests/e2e/voximplant-layout-camera-model.spec.ts`
- `docs/voximplant/stage-1-vox-layout-camera-correction-audit.md`

## Tests Changed

- `tests/e2e/voximplant-room-parity.spec.ts`
  - Existing API/state parity checks preserved.
- `tests/e2e/voximplant-room-presence.spec.ts`
  - Existing lease takeover checks preserved.
- `tests/e2e/voximplant-layout-camera-model.spec.ts`
  - Added roster-first layout model checks (missing stream identity, observers/unassigned, reassignment recompute, unknown role isolation).
  - Added camera idempotency helper checks (reuse path and duplicate stream error classification).

## Validation Results

- `npm run lint` -> PASS (existing unrelated warnings remain in another pre-existing e2e file).
- `npm run build` -> PASS.
- `npx prisma validate` -> PASS.
- `npx prisma generate` -> PASS.
- `npx playwright test tests/e2e/voximplant-room-parity.spec.ts` -> BLOCKED by test DB env (`SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`).
- `npx playwright test tests/e2e/voximplant-room-presence.spec.ts` -> BLOCKED by same DB env error.
- `npx playwright test tests/e2e/voximplant-recording-debug.spec.ts` -> BLOCKED by same DB env error.

## Manual User Steps

1. Start dev server.
2. Set `VIDEO_PROVIDER=voximplant`.
3. Open same session with facilitator, 2 participants, 2 observers.
4. Before role assignment:
   - non-facilitators appear as observer/unassigned observer;
   - nobody is incorrectly shown as facilitator.
5. Assign roles:
   - participants move left/right;
   - facilitator center;
   - observers top;
   - all clients update without refresh.
6. Facilitator sees self and all users.
7. Toggle facilitator camera.
8. Open same session under same login in second tab:
   - verify deterministic duplicate behavior;
   - stale tab cannot control.
9. Verify participant materials button.
10. Run basic start/pause/resume/finish smoke.
11. Confirm recording pipeline not regressed.

## Are Vox Logs Still Required?

- Recommended: **yes**, for final manual smoke confirmation of recorder/scenario runtime behavior.
- For this correction set, logs are not required to validate the UI/role/layout/lease fixes themselves, but still valuable for recording-path confidence.

## Checkpoint Safety Assessment

- Stage 1 correction set is structurally aligned with the requested scope and guardrails.
- Automated lint/build/prisma gates are green.
- Full checkpoint confidence still depends on re-running the three targeted Playwright specs after fixing test DB `DATABASE_URL` password/env injection for Playwright workers.

## Correction 3 Addendum (Final room polish before checkpoint)

### Root causes confirmed

1. Diagnostics tile visible in normal mode:
   - Unknown endpoint leftovers were computed from remote streams not used by role tiles, but streamless-yet-mapped endpoints could still be treated as leftovers and shown as diagnostics.
2. Observer alignment and empty-space issue:
   - Observer row used left-aligned horizontal flow (`overflow-x`) without center alignment for single tile.
   - Empty observer state styling was not compact enough for facilitator-first view.
3. Mic/video controls unclear:
   - Control bar used weak state signaling and did not provide explicit on/off/locked labels.
4. Speaking border behavior looked wrong:
   - Speaking highlight was local-level only; no clear per-tile mic-state badge for all users, so users interpreted single highlight as global speaker indicator.
5. Possible stuck system mute after finish:
   - Policy auto-unmute logic restored participants only, allowing facilitator/observer local mute to remain stale after policy unlock states.

### Corrections implemented

- Diagnostics section now appears only when:
  - real unknown/unmapped endpoints exist; or
  - explicit debug mode is enabled.
- Unknown endpoint matching no longer treats mapped streamless endpoints as unknown leftovers.
- Observer row is centered, wraps compactly, and empty state is compact.
- Vox mic/video buttons now expose explicit stateful visuals and labels:
  - green/on,
  - red/off,
  - gray/locked (system policy).
- Added Russian accessibility labels/titles:
  - `Микрофон включён`
  - `Микрофон выключен`
  - `Камера включена`
  - `Камера выключена`
  - `Микрофон заблокирован правилами сессии`
- Added per-tile mic-state badge/border:
  - local tile uses actual local mute + policy lock;
  - remote tile uses policy fallback when direct remote mic state is not exposed.
- Local active-speaker highlight remains based on live `micLevel`; remote multi-speaker highlight is not synthesized without reliable SDK data.
- Policy mute restore now applies to any role that was policy-muted once restrictions are lifted.

### Files changed in Correction 3

- `docs/voximplant/stage-1-final-room-polish-audit.md`
- `components/voximplant-video-layout.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `lib/voximplant/room-layout-model.ts`
- `tests/e2e/voximplant-layout-camera-model.spec.ts`
- `tests/e2e/voximplant-room-parity.spec.ts`

### Validation rerun (Correction 3)

- `npm run lint` -> PASS (existing unrelated warnings remain in another legacy e2e file).
- `npm run build` -> PASS.
- `npx prisma validate` -> PASS.
- `npx prisma generate` -> PASS.
- `npx playwright test tests/e2e/voximplant-room-parity.spec.ts` -> PASS.
- `npx playwright test tests/e2e/voximplant-room-presence.spec.ts` -> PASS.
- `npx playwright test tests/e2e/voximplant-layout-camera-model.spec.ts` -> PASS.
- `npx playwright test tests/e2e/voximplant-recording-debug.spec.ts` -> PASS (`panel enabled` subset remains skipped by env as designed).

### Remaining manual confirmation required

- Real Vox runtime smoke (facilitator/participants/observer) is still required for final UI/audio behavior confirmation and recorder-runtime confidence.

