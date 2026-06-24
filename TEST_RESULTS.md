# NegotAItions Test Results

## Executed Commands

- `npm install -D @playwright/test`
- `npx playwright install chromium`
- `npm run lint` — passed
- `npm run build` — passed
- `npx prisma validate` — passed
- `npm run test:e2e` — passed
- `npm run test:all` — passed

## Automated Test Summary

Playwright result:

- 7 passed
- 1 skipped
- 0 failed

Skipped:

- Optional live external-service smoke placeholder is skipped by default unless `RUN_LIVE_SMOKE_TESTS=true`.

Covered default mock-mode flows:

- Event lobby join persistence and no duplicate participant creation.
- Rejoin validation for event lobby participant tokens.
- Event-to-session assignment with facilitator, two participants, and observer.
- Event duration, preparation duration, and negotiation duration separation.
- Event lobby state does not expose private role instructions.
- Session role privacy for participant and observer API payloads.
- Preparation start/pause/resume/stop without recording.
- Negotiation start/pause/resume/finish with mock recording lifecycle.
- Transcript creation, editing, saving, and reload persistence.
- Participant notes privacy through join page and facilitator notes review.
- Soft-deleted cases removed from new event selection while old session snapshots remain usable.
- Mock LiveKit/Yandex/OpenAI error diagnostics without paid calls.
- RU/EN UI rendering with dynamic content preserved.
- Product spelling `NegotAItions`.
- Sticky header smoke coverage on core pages.

## Fixed Defects

- Fixed server-side role privacy leak in `lib/room-sidebar.ts`; participant and observer join tokens no longer receive facilitator-only role briefings in the sidebar API payload.

## Remaining Known Issues

- Live external service smoke tests were not run because `RUN_LIVE_SMOKE_TESTS` was not enabled.
- Next dev server logs an `allowedDevOrigins` warning for `127.0.0.1` during Playwright runs. It does not fail tests.
- Public event join/lobby UI bootstrapping can remain in a loading state under the Playwright dev harness while LiveKit lobby video initializes; default tests assert the durable join/rejoin behavior through DB state and validation APIs.

## How To Run Again

```bash
npm run lint
npm run build
npx prisma validate
npm run test:e2e
```

Optional live smoke:

```bash
RUN_LIVE_SMOKE_TESTS=true npm run test:e2e -- --grep @live-smoke
```

