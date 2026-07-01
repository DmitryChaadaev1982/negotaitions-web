# Stage 2 Correction Report: Lobby/Room Vox Camera, Layout, Transition, i18n

## What was corrected

- Added Stage 2 correction audit:
  - `docs/voximplant/stage-2-lobby-room-correction-audit.md`
- Unified Vox media behavior across lobby and room:
  - shared media error helpers in `lib/voximplant/media-error-utils.ts`;
  - shared mic/camera controls in `components/voximplant-media-controls.tsx`;
  - room hook and lobby component now reuse shared helpers/states.
- Fixed Lobby -> Room Vox lifecycle sequencing:
  - new browser lifecycle gate in `lib/voximplant/browser-client-lifecycle.ts`;
  - both lobby cleanup and room init now coordinate disconnect/connect order.
- Refactored lobby layout to isolate scrolling:
  - video pane stable and overflow-isolated;
  - side panel scrolls independently;
  - lobby video tiles use bounded non-stretch sizing.
- Completed i18n pass for lobby/room media controls and key labels (RU/EN):
  - removed hard-coded English/Russian mixed labels from Vox lobby/room UI;
  - added missing dictionary keys and replaced stale hard-coded banners.

## Root causes

1. **Camera blocked/device in use in lobby**
   - Lobby had separate, partial media error handling from room hook.
   - StreamManager camera-busy console noise was not suppressed in lobby path.
   - Result: recoverable camera failures surfaced as noisy SDK errors instead of consistent system UI state.

2. **Lobby video stretching/scroll coupling**
   - Lobby video grid used `h-full` + `auto-rows-fr`, forcing vertical stretching.
   - Container hierarchy lacked strict `min-h-0`/`overflow-hidden` isolation.
   - Result: right panel growth influenced page/video area sizing and produced oversized tiles.

3. **Inconsistent media control labels/styles**
   - Lobby and room had duplicated control implementations with different label language and style logic.
   - Lobby used hard-coded English labels; room used hard-coded Russian labels.
   - Result: locale switching produced mixed-language UI and inconsistent semantics.

4. **Participant Lobby -> Room transition failure (`DISCONNECTING`)**
   - Room Vox init could begin while lobby Vox client was still disconnecting during route transition.
   - No cross-page browser lifecycle sequencing existed.
   - Result: timing-sensitive SDK status conflict (`not connected` / `DISCONNECTING`) on participant transition.

5. **i18n gaps**
   - Hard-coded labels remained in `event-lobby-voximplant-room`, `voximplant-video-layout`, `voximplant-negotiation-room-page`, and stale-connection banners.
   - Result: RU/EN switch did not fully propagate in lobby + room product UI.

## Files changed

- `docs/voximplant/stage-2-lobby-room-correction-audit.md` (new)
- `docs/voximplant/stage-2-event-lobby-vox-implementation-report.md` (updated)
- `components/event-lobby-view.tsx`
- `components/event-lobby-voximplant-room.tsx`
- `components/voximplant-media-controls.tsx` (new)
- `components/voximplant-negotiation-room-page.tsx`
- `components/voximplant-video-layout.tsx`
- `components/shared-room-shell.tsx`
- `lib/voximplant/use-voximplant-room.ts`
- `lib/voximplant/media-error-utils.ts` (new)
- `lib/voximplant/browser-client-lifecycle.ts` (new)
- `lib/i18n/dictionaries/en.ts`
- `lib/i18n/dictionaries/ru.ts`
- `tests/e2e/voximplant-layout-camera-model.spec.ts`
- `tests/e2e/voximplant-event-lobby.spec.ts`

## Tests added/updated

- Updated `tests/e2e/voximplant-layout-camera-model.spec.ts`:
  - shared control state styling/labels checks;
  - lobby layout isolation assertions;
  - lobby non-stretch tile-grid assertion;
  - lifecycle sequencing assertion (lobby + room);
  - required RU/EN media dictionary labels assertion.
- Updated `tests/e2e/voximplant-event-lobby.spec.ts`:
  - camera-busy warning key + shared controls usage assertion.

## Validation results

Environment used before Playwright:

- `$env:DATABASE_URL="postgresql://negotiations:negotiations_password@localhost:5432/negotiations_vox_test"`
- `$env:PLAYWRIGHT_PORT="3000"`

Build and schema:

- `npm run lint` — PASS (3 existing unrelated warnings in `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts`)
- `npm run build` — PASS
- `npx prisma validate` — PASS
- `npx prisma generate` — PASS

Stage 1 regressions:

- `npx playwright test tests/e2e/voximplant-room-parity.spec.ts` — PASS
- `npx playwright test tests/e2e/voximplant-room-presence.spec.ts` — PASS
- `npx playwright test tests/e2e/voximplant-layout-camera-model.spec.ts` — PASS
- `npx playwright test tests/e2e/voximplant-recording-debug.spec.ts` — PASS (panel-enabled subset skipped by env as expected)

Stage 2/event regressions:

- `npx playwright test tests/e2e/event-flow.spec.ts` — PASS
- `npx playwright test tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts` — PASS
- `npx playwright test tests/e2e/voximplant-event-lobby.spec.ts` — PASS

## Manual smoke still required

1. Russian UI: facilitator + participant + observer join in event lobby.
2. Join with camera blocked/in use and confirm:
   - localized system warning;
   - no crash;
   - lobby remains usable;
   - transition to room still possible.
3. Right panel long content: verify independent side scroll and stable video pane.
4. Verify tile max sizing/aspect and no giant stretch behavior.
5. Switch RU <-> EN and verify lobby/room labels + media controls switch fully.
6. Verify case/user names are unchanged during locale switch.
7. Facilitator and participant both transition Lobby -> Room without DISCONNECTING failure.
8. Re-run preparation/start/pause/resume/finish smoke in room.

## Are Vox logs still required?

- Recommended: **yes**, for final real-runtime confidence.
- Mandatory scenario/rule code changes: **no** (none introduced by this correction).

## Stage 2 checkpoint safety

- Automated regression status: **green** on requested suites.
- Stage 2 is **safe to checkpoint after manual multi-user smoke checklist is confirmed**.

## Guardrail confirmation (untouched critical components)

- `prisma/schema.prisma` — untouched
- `prisma/migrations/*` — untouched
- `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts` — untouched
- `lib/voximplant/recording-dispatch.ts` — untouched
- `docs/voximplant/neg-conf.main-room.scenario.js` — untouched
- Voximplant recording webhook route and recording dispatch contract — unchanged
- Yandex SpeechKit / Yandex AI / DeepSeek pipeline internals — untouched

---

## Stage 2 Correction 2: Final baseline blockers

### Root causes confirmed

1. Duplicate same-user lobby entries:
   - Event lobby state previously rendered `EventParticipant` rows 1:1.
   - Historical duplicate rows for same `(eventId,userId)` were therefore rendered as separate cards.
   - Lease logic was correct for action blocking but did not dedupe participant cards.

2. Stale first tab UX:
   - Stale takeover (`STALE_CONNECTION`) was detected, but stale tab could still keep lobby media mounted.
   - Host/participant UI controls were not explicitly disabled client-side in stale mode.

3. Observer AI analysis sharing:
   - Sharing pipeline was mostly correct (shared payload + sanitization existed).
   - Projection logic for facilitator/participant/observer was inline and fragmented in status route.
   - Centralized projection helpers were needed to make leakage policy explicit and regression-resistant.

### What was implemented

- Lobby participant identity dedupe in `lib/event-state.ts`:
  - account participants deduped by `userId`;
  - token-only rows deduped by `eventParticipant.id`;
  - canonical participant remapping applied to current participant and active assignment mapping.
- Deterministic account participant resolution:
  - `lib/access-control.ts`
  - `lib/ensure-event-participant.ts`
  - `app/actions/events.ts`
  - all switched to explicit latest-first ordering for `(eventId,userId)` resolution.
- Stale tab UX hardening in `components/event-lobby-view.tsx`:
  - stale takeover message uses dedicated RU/EN event-lobby text;
  - reconnect and return-to-events actions added;
  - stale tab media area no longer stays active;
  - preference controls and host controls are blocked/hidden in stale mode.
- Role-based analysis projection centralization:
  - new `lib/analysis-visibility.ts`:
    - `getAnalysisForFacilitator(...)`
    - `getAnalysisForParticipant(...)`
    - `getAnalysisForObserver(...)`
  - `app/api/sessions/[sessionId]/materials/status/route.ts` now uses these helpers.

### Observer/participant/facilitator filtering policy now enforced

- Facilitator:
  - full analysis.
- Participant:
  - shared/sanitized analysis + own personal feedback only.
- Observer:
  - shared/sanitized general analysis only (no participant personal feedback).

### Tests added/updated

- Updated `tests/e2e/voximplant-event-lobby.spec.ts`:
  - stale lease blocks participant preference updates;
  - stale lease blocks host mutation/session creation and stale Vox access;
  - participant list payload deduped by user identity.
- Updated `tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts`:
  - observer receives shared analysis without participant personal feedback;
  - participant A/B isolation remains enforced.

### Validation commands and outcomes

- `npm run lint` — PASS (existing unrelated warnings only in `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts`)
- `npm run build` — PASS
- `npx prisma validate` — PASS
- `npx prisma generate` — PASS
- `npx playwright test tests/e2e/voximplant-room-parity.spec.ts` — PASS
- `npx playwright test tests/e2e/voximplant-room-presence.spec.ts` — PASS
- `npx playwright test tests/e2e/voximplant-layout-camera-model.spec.ts` — PASS
- `npx playwright test tests/e2e/voximplant-recording-debug.spec.ts` — PASS (panel-enabled subset skipped by env as expected)
- `npx playwright test tests/e2e/event-flow.spec.ts` — PASS
- `npx playwright test tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts` — PASS
- `npx playwright test tests/e2e/voximplant-event-lobby.spec.ts` — PASS
- Additional observer/debrief suite run:
  - `npx playwright test tests/e2e/debrief-ai-sharing.spec.ts` — FAIL on pre-existing `FINISH` control expectation (`debrief-ai-sharing.spec.ts:89`) before observer checks execute.

### Stage 2 checkpoint readiness

- Stage 2 baseline blockers in this correction are resolved in code and covered by regression suites above.
- Stage 2 is safe for checkpoint after the required manual smoke checklist is completed.

### Guardrails confirmed for this correction

- Stage 3 was not started.
- `prisma/schema.prisma` and `prisma/migrations/*` unchanged by this correction.
- `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts` unchanged.
- `lib/voximplant/recording-dispatch.ts` unchanged.
- `docs/voximplant/neg-conf.main-room.scenario.js` unchanged.
- Vox recording webhook route, scenario/rule, and recording dispatch contract unchanged.
- Yandex SpeechKit / Yandex AI / DeepSeek generation pipeline internals unchanged.
