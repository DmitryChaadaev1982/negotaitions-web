# Stage 3.10 Client UX Hardening — Wave 1 Implementation Report

## Source Problem

Stage 3.10 deploy code had the correct lifecycle and server-side recording-stop architecture, but several client UX paths were still fragile:

- session detail presence could classify participants with independent `Date.now()` calls during SSR/hydration;
- event-state responses could be cached by browser/proxy layers;
- lobby/materials polling could apply stale slow responses;
- durable recording stop progress was not visible in the recording UI;
- room headers did not show the event room label consistently;
- operational diagnostics around event completion and room control had limited structured context.

## Scope

Implemented Wave 1 only:

- stable SSR presence reference timestamp;
- event-state no-store headers;
- structured Stage 3.10 observability logs;
- additive `stopOperationState` exposure and UI display;
- polling race guards for event lobby and materials panels;
- standard safe `span` attributes on `Badge`;
- additive `roomLabel` room header title.

No Prisma schema, migrations, Voximplant scenario, production environment, server database, or deploy branch merge was changed.

## Legacy Fragments Used

- Presence snapshot helper idea from legacy `lib/presence.ts` and related tests.
- Event lobby polling interval/stale-response helper idea from legacy `lib/event-state-polling.ts`.
- Room header formatter idea from legacy `lib/room-header-title.ts`.
- Minimal stopOperationState response/UI wiring idea from legacy recording files.
- Minimal in-flight/request-sequence poll guards from legacy materials panels.
- Minimal Badge HTML attributes pattern from legacy `components/badge.tsx`.

## Legacy Fragments Rejected

The following were intentionally not ported in Wave 1:

- occupancy-gated return to debrief;
- client-room-phase;
- recording-finalization-phase;
- post-close relay continuity;
- FAILED-as-stopping recording display;
- session-recording-reconciliation;
- old browser relay delivery policies;
- old occupancy, lease, and maintenance changes;
- recording-status evidence rewrites;
- wholesale legacy e2e files.

These remain Wave 2/3 or rejected items because they overlap Stage 3.10 lifecycle/server-stop semantics.

## Changed Files

- `app/(app)/sessions/[id]/page.tsx`
- `app/api/events/[id]/state/route.ts`
- `app/api/sessions/[sessionId]/control/route.ts`
- `app/api/sessions/[sessionId]/recording/route.ts`
- `components/badge.tsx`
- `components/event-lobby-view.tsx`
- `components/participants-table.tsx`
- `components/recording-transcription-section.tsx`
- `components/session-detail-view.tsx`
- `components/session-materials-dashboard.tsx`
- `components/session-post-processing-panel.tsx`
- `components/shared-room-shell.tsx`
- `lib/complete-event.ts`
- `lib/event-state-polling.ts`
- `lib/event-state-polling.test.ts`
- `lib/presence.ts`
- `lib/presence.test.ts`
- `lib/recording-display-state.test.ts`
- `lib/room-header-title.ts`
- `lib/room-header-title.test.ts`
- `lib/room-sidebar-types.ts`
- `lib/room-sidebar.ts`
- `docs/audits/stage-3-10-client-ux-hardening/implementation-report.md`

## Functionality

Stable SSR presence clock:

- page-level `presenceSnapshotAt` is computed once per request;
- `SessionDetailView` and `ParticipantsTable` receive the same timestamp;
- initial presence snapshots use `buildInitialParticipantPresenceSnapshot`;
- SSE updates after hydration still replace initial presence with live data.

Event-state no-cache:

- successful and relevant error responses now include `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`, `Pragma: no-cache`, and `Expires: 0`;
- `triggerStage310ExpiryReconciliation` and all access checks remain in place.

Observability:

- `completeTrainingEvent` logs start, authorization, lifecycle decision, per-session result, final result, and controlled errors;
- session control route logs operation start, authorization/access decisions, lifecycle decisions, stale lease errors, final result, and controlled errors;
- logs use stable `area`/`event` names and omit tokens, cookies, full headers, and request bodies.

Recording UI:

- GET `/recording` includes `recording.stopOperationState`;
- UI displays `PENDING`, `DELIVERING`, and `DELIVERED` as stopping progress;
- `FAILED` is displayed as failure/review state, not infinite progress;
- GET does not create stop operations or update evidence timestamps.

Polling:

- event lobby polling rejects stale responses, prevents overlapping state polls, backs off while hidden, refreshes quickly after visibility/focus, and cleans timers/listeners;
- materials dashboard and post-processing panel reject stale status responses and prevent unbounded overlapping status polls.

Room header:

- sidebar data now carries optional `roomLabel`;
- header title is formatted as `roomLabel — session title`;
- duplicate label is avoided when the title already contains the label;
- logical presence sidebar, explicit leave, mobile/desktop layout, and authorization paths are unchanged.

## Lifecycle And Server-Stop Evidence

No Stage 3.10 lifecycle/server-stop files were changed:

- `lib/session-room-occupancy.ts`
- `lib/session-room-connection-lease.ts`
- `lib/stage-3-10-maintenance.ts`
- `lib/session-completion.ts`
- `lib/session-recording-stop-relay.ts`
- `lib/recording-stop-delivery-policy.ts`
- `app/api/sessions/[sessionId]/recording-control/route.ts`
- `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`
- `components/voximplant-negotiation-room-page.tsx`
- `prisma/**`

Stage 3.10 gates stayed green, including server-side stop, callback nonce/signature, timezone occupancy SQL, DEBRIEF grace, explicit leave, observer access, and event completion.

## Test Results

- Focused helper tests: 26 tests, 3 suites, 26 passed.
- `npm run validate:fast`: passed. Unit tests: 601 tests, 601 passed. E2E list: 615 tests discovered in 41 files.
- `npm run validate:deploy`: passed. Unit tests: 601 tests, 601 passed. E2E list: 615 tests discovered in 41 files. Next build compiled and typechecked successfully.
- `npm run test:e2e:smoke`: passed, 12 Playwright smoke tests.
- `npm run test:e2e:smoke:browser`: first run failed because Playwright Chromium was missing; after `npm run test:e2e:install`, passed, 5 Playwright browser smoke tests.
- `npm run test:stage310`: passed. Unit portion: 102 tests passed. E2E portion: 30 tests passed.

Environment notes:

- `npm ci` was required once because dependencies were missing.
- Playwright Chromium was required once for browser smoke.
- Tests used local non-production URLs:
  - `DATABASE_URL=postgresql://negotiations:...@localhost:5432/negotiations?schema=public`
  - `E2E_DATABASE_URL=postgresql://negotiations:...@localhost:5433/negotiations_e2e?schema=public`

## Acceptance Mapping

- Event lobby continues polling without manual refresh: covered by helper wiring and browser smoke.
- Stale poll response cannot roll back newer event state: covered by `event-state-polling` unit tests and lobby sequence guard.
- Hidden/visible transition resumes polling: covered by helper delay tests and visibility/focus wiring.
- Session detail presence is SSR/hydration-consistent: covered by `presence.test.ts`.
- Room header shows room label and title without duplication: covered by `room-header-title.test.ts`.
- Recording UI receives `stopOperationState`: API route and component wiring completed.
- Stage 3.10 lifecycle unchanged: protected by `test:stage310`.
- Server-side recording stop tests remain green: `test:stage310`.
- Timezone occupancy tests remain green: `test:stage310`.
- DEBRIEF grace and observer access tests remain green: `test:stage310`.

## Known Limitations

- No new E2E files were added for polling race simulations; coverage is focused helper/unit plus existing smoke/stage gates.
- `FAILED` durable stop operation is surfaced as failure/review state in UI, but no new backend remediation workflow was added.
- Observability logs are console JSON logs only; no external telemetry sink was added.

## Deferred Wave 2/3 Items

- Occupancy-gated return to debrief.
- Client room phase helper.
- Recording finalization phase.
- Post-close relay continuity.
- Session lifecycle display consolidation.
- Recording/materials semantic stop classifier work.
- Any rewrite touching occupancy, lease, maintenance, server-stop delivery, or Voximplant scenario.

## Post-implementation technical verification

Rerun date: 2026-07-30.

Verification verdicts:

- L10 stale poll response: PASS WITH LIMITATION. Unit/statically verified request sequencing, stale-response rejection, hidden polling interval, in-flight guard, and cleanup. No new browser race harness was added.
- L11 event-state cache headers: PASS. Authenticated success and controlled-error routes return no-store/no-cache headers; route audit found no expected response path bypassing the shared JSON helper.
- L19 structured logs: PASS. Event completion and session control emit stable JSON `area`/`event` records without tokens, cookies, full request bodies, or full headers.

Post-verification fixture defect:

- `tests/e2e/voximplant-event-lobby.spec.ts` reproduced `POST /api/events/:id/host` returning `400 facilitatorInvalid` before the fix.
- Root cause: `createE2eEvent({ withParticipants: true })` creates legacy token-only `EventParticipant` rows; the failing scenario selected `Dmitry` as facilitator without binding `Dmitry.userId`.
- Production validation is correct and unchanged: `createSessionFromEvent()` requires the facilitator event participant to exist and have `userId`, because the created `Session.facilitatorId` is a real user id.
- Fix: the E2E scenario now creates test users, sets `TrainingEvent.hostUserId`/`facilitatorUserId` to the host test user, binds `Dmitry.userId` to that host test user, binds player/observer participants to their generated users, and posts as the authenticated event owner. `Dmitry` keeps `preference='FACILITATE'` and `isHost=true`.
- Application code, Prisma schema/migrations, lifecycle, occupancy, lease, server-side stop, and Voximplant scenario files were not changed.

Focused rerun results:

- Pre-fix reproduction: `voximplant-event-lobby.spec.ts` failed 1/7 at `session creation from event preserves role assignment and account room path`; `POST /api/events/:id/host` returned `facilitatorInvalid`.
- Post-fix full run: `voximplant-event-lobby.spec.ts` passed 7/7.
- Three sequential stability reruns: `voximplant-event-lobby.spec.ts` passed 7/7, 7/7, 7/7.
- `event-completion.spec.ts`: passed 12/12.
- `session-finish-canonical.spec.ts`: passed 9/9 twice sequentially.
- `voximplant-room-presence.spec.ts`: passed 21/21.

Mandatory gate results:

- `npm run validate:fast`: passed. Unit tests: 601/601. E2E list: 615 tests in 41 files.
- `npm run validate:deploy`: passed. Includes `validate:fast` plus successful Next build/typecheck.
- `npm run test:e2e:smoke`: passed. 12/12 Playwright smoke tests; E2E database safety checks passed.
- `npm run test:e2e:smoke:browser`: passed. 5/5 browser smoke tests; E2E database safety checks passed.
- `npm run test:stage310`: passed. Unit portion 102/102; E2E portion 30/30.

Final rerun verdict: PASS. Merge: GO. Server canary: GO, subject to normal deployment controls.

## Rollback

Rollback is to revert the feature commit that contains this report and implementation:

```bash
git revert <feature-commit-sha>
```

Do not use `git reset --hard`, detached HEAD, or merge/rewrite operations against `deploy/yandex-poc`.
