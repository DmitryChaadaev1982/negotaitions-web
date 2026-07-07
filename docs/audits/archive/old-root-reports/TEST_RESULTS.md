# NegotAItions Test Results

## Executed Commands

- `npm run lint` — passed
- `npm run build` — passed
- `npx prisma validate` — passed
- `npm run test:e2e` — passed

## Automated Test Summary

Latest Playwright result:

- 25 passed
- 1 skipped
- 0 failed

Skipped:

- Optional live external-service smoke placeholder is skipped by default unless `RUN_LIVE_SMOKE_TESTS=true`.
- Any live provider tests remain skipped unless explicitly enabled; default e2e does not call real OpenAI, LiveKit Egress, or Yandex Object Storage.

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
- Old e2e expectations for mandatory `/join/[joinToken]` briefing-before-room flow were rewritten: `/join/[joinToken]` is Session Materials, while Event lobby room buttons target `/room/[sessionId]` directly.
- Obsolete one-session Event assumptions were removed from new coverage; the current suite includes multi-session Event creation, sequential participant reassignment, and duplicate active-assignment blocking.
- Case Library and Configure session flow are covered instead of a simple primary case dropdown.
- Dashboard and Events page multi-session stats are covered with compact UI/no-horizontal-overflow assertions.
- Session Materials, Rejoin routing, completed Event state, privacy, and mocked recording/transcription lifecycle remain covered.
- External services run in mock mode by default: `RECORDING_MODE=mock`, `TRANSCRIPTION_MODE=mock`, and `EXTERNAL_SERVICES_MODE=mock`.

## Fixed Defects

- Fixed server-side role privacy leak in `lib/room-sidebar.ts`; participant and observer join tokens no longer receive facilitator-only role briefings in the sidebar API payload.

## Remaining Known Issues

- Live external service smoke tests were not run because `RUN_LIVE_SMOKE_TESTS` was not enabled.
- Next dev server logs an `allowedDevOrigins` warning for `127.0.0.1` during Playwright runs. It does not fail tests.
- Mock LiveKit room setup still logs expected client disconnect noise when tests navigate away from lobby/room pages. It does not fail tests.

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

