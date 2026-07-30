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

## Rollback

Rollback is to revert the feature commit that contains this report and implementation:

```bash
git revert <feature-commit-sha>
```

Do not use `git reset --hard`, detached HEAD, or merge/rewrite operations against `deploy/yandex-poc`.
