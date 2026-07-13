# Session Completion Test Coverage (Current + Required for Target)

## Covered areas (current strong evidence)

- Session lifecycle and navigation baseline:
  - `tests/e2e/session-navigation.spec.ts`
  - `tests/e2e/session-lifecycle.spec.ts`
- Event completion and warnings:
  - `tests/e2e/event-completion.spec.ts`
- Presence/stale tab baseline:
  - `tests/e2e/voximplant-room-presence.spec.ts`
  - `tests/e2e/voximplant-event-lobby.spec.ts`
- Materials processing continuity:
  - `tests/e2e/session-materials-processing.spec.ts`
- Debrief baseline behavior:
  - `tests/e2e/debrief-ai-sharing.spec.ts`

## Required additional coverage for finalized Stage 3.10 target

### P0-required

- Atomic/idempotent duplicate FINISH under multi-client concurrency.
- Finish committed + delayed stop delivery + retry visibility path.
- Durable last-disconnect closure (including simultaneous disconnect race).
- Reconnect inside grace preserving `DEBRIEF_OPEN`.
- Refresh/back/direct URL guard parity across `OPEN|DEBRIEF_OPEN|CLOSED`.
- Event `COMPLETED` lobby hard-close guard at route/server level.
- Abrupt disconnect with zero remaining clients and no further room requests still expires server-side and closes abandoned `DEBRIEF_OPEN`.
- Expiry worker retry/concurrency safety (two workers).
- Restart-before-expiry and restart-after-expiry cleanup safety.
- Reconnect racing expiry/closure commit behavior.
- Guarantee that `OPEN` negotiations are not closed by debrief-expiry rule.
- Active-connection predicate negative tests (expired/disconnected/superseded/revoked/deleted/not-authorized/event-lobby/materials-polling not counted).

### P1-required

- Administrative completion from:
  - Sessions overview;
  - Session detail;
  - Event host control surface.
- Permission tests:
  - facilitator/session owner/authorized host allowed;
  - participant/observer forbidden.
- Event-linked vs standalone Session completion parity.
- Event completion batch semantics:
  - active/paused recording stop orchestration;
  - mixed session states (already finished, no recording, processing/completed recording);
  - repeated Event completion idempotency;
  - Event completion racing facilitator FINISH;
  - partial stop failure visibility/retry and no Event rollback.

### P2-required

- Sessions overview AI aggregate publication status:
  - none published;
  - partially published;
  - fully published (`AI-отчёт опубликован`);
  - no duplicated published rows.
- Completed-event sessions list action policy:
  - `Open lobby` hidden for completed-event sessions.

## Audit execution note

- This document captures audit evidence and required implementation tests.
- Docs-only update did not execute runtime suites.
