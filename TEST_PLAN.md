# NegotAItions Regression Test Plan

## Scope

This plan covers automated regression and user-flow testing for the currently implemented NegotAItions concepts:

- Cases, soft delete, and case snapshots for historical sessions.
- Sessions, participants, observers, facilitators, notes, and facilitator review.
- Training Events, public join flow, event lobby, assignment draft, and session creation from events.
- Multi-session Events where participants can finish one Session, return to the Event lobby, and later join another Session.
- Compact Dashboard/Events/Sessions cross-page Event statistics and navigation.
- Case Library selection flow in the Event lobby; the old primary case dropdown flow is obsolete.
- Session Materials as the `/join/[joinToken]` destination; live room entry is direct from the lobby via `/room/[sessionId]`.
- Session preparation and negotiation control state.
- LiveKit token and room entry logic, using fake browser media devices for e2e tests.
- Audio-only recording lifecycle and transcription entry points.
- External service diagnostics for LiveKit, Yandex Object Storage/S3-compatible storage, OpenAI, FFmpeg, and app errors.
- Rejoin/recovery logic for event lobbies and session rooms.
- RU/EN UI switching, preserving dynamic user-entered content and exact product spelling: NegotAItions.
- Header/sticky layout smoke coverage on high-traffic pages.

Out of scope for this test phase:

- AI negotiation analysis/report generation.
- Long-running or paid live external service tests by default.
- Paid live provider calls in default CI/local e2e runs.

## Architecture Notes From Inspection

- The app is a Next.js App Router project under `negotiations-web`.
- Prisma uses PostgreSQL with generated client output in `app/generated/prisma`.
- The schema already separates `TrainingEvent.estimatedEventDurationSeconds`, `Session.preparationDurationSeconds`, and `Session.durationSeconds`.
- Event session creation is handled by `lib/create-event-session.ts`, using case defaults through `lib/event-assignment.ts`.
- Session control is handled by `app/api/sessions/[sessionId]/control/route.ts` and `lib/negotiation-control.ts`.
- Recording is started by negotiation `START` and stopped by `FINISH` through `lib/livekit-egress.ts`.
- Transcription is handled by `app/api/sessions/[sessionId]/transcribe-recording/route.ts` and `lib/services/openai-transcription.ts`.
- Rejoin validation is handled by `lib/rejoin/validate.ts`.
- i18n dictionaries live in `lib/i18n/dictionaries`.
- Playwright is configured under `playwright.config.ts` with Chromium fake media devices and mock external service env.

## Assumptions

- Tests will run from `negotiations-web`.
- A test database is available through `DATABASE_URL`.
- The demo facilitator exists or can be created by `npm run db:seed`.
- Tests may create and clean up data with unique `E2E` titles.
- Browser tests will use Chromium with fake media:
  - `--use-fake-ui-for-media-stream`
  - `--use-fake-device-for-media-stream`
- Default automated tests must run with opt-in mock modes:
  - `EXTERNAL_SERVICES_MODE=mock`
  - `RECORDING_MODE=mock`
  - `TRANSCRIPTION_MODE=mock`
- Optional live smoke tests must be skipped unless `RUN_LIVE_SMOKE_TESTS=true`.

## Test Data

Primary generated entities:

- Case: `E2E Case Duration Test`
- Event: `E2E Club Event`
- Host/facilitator: `Dmitry`
- Participants: `Igor`, `Alex`
- Observer: `Serg`
- Multi-session fixtures also use `Maria`, `Olga`, and `Ivan` where a workflow needs more participants.
- Case A: `E2E Case A — Scope Change` with `Client CFO` and `Vendor Project Director`.
- Case B: `E2E Case B — Resource Conflict` with `ERP Delivery Director` and `Analytics Delivery Director`.
- Private role markers:
  - Igor role marker: `E2E_PRIVATE_IGOR_ONLY`
  - Alex role marker: `E2E_PRIVATE_ALEX_ONLY`
- Notes markers:
  - `E2E_NOTE_IGOR`
  - `E2E_NOTE_ALEX`
  - `E2E_NOTE_SERG`
  - `E2E_NOTE_DMITRY`
- Transcript marker: `E2E edited transcript persists`

Tests should prefer direct setup through Prisma for stable preconditions, then exercise user-facing routes and APIs with Playwright where the behavior is browser-dependent.

## Mocked vs Live External Services

Default automated tests:

- Must not call real OpenAI.
- Must not start real LiveKit Egress.
- Must not upload/download real Yandex Object Storage objects.
- Should use deterministic mock behavior for tokens, recording status changes, transcription text, and provider error simulations.
- Should verify that app state transitions and diagnostics records are correct.

Required mock behavior if missing:

- LiveKit room/token test mode returns deterministic test data sufficient for UI flow tests.
- Recording start creates or updates a `Recording` as `RECORDING` without calling LiveKit Egress.
- Recording stop marks the same recording as `COMPLETED` and sets a fake `fileKey`.
- Transcription returns deterministic sample text and segments without downloading storage or calling OpenAI.
- Error modes can simulate LiveKit quota/billing, Yandex download failure, and OpenAI quota/rate/billing failures.

Optional live smoke tests:

- Must be skipped unless `RUN_LIVE_SMOKE_TESTS=true`.
- Must be short and bounded.
- Recording smoke duration must be 30-60 seconds max.
- Must never run by default in `npm run test:e2e` or `npm run test:all`.

## Flows To Test

1. Case duration separation: event duration stays independent from session preparation and negotiation durations.
2. Event lobby join and rejoin: same browser context does not create duplicate `EventParticipant` records.
3. Event assignment to session: host selects a case from Case Library, clicks Use this case, configures session, assigns facilitator/roles/observer, and creates a linked session with snapshots.
4. Role privacy in session: participants and observers do not receive other users' private role instructions; facilitator-only access is explicit.
5. Preparation phase: session begins in `PREPARATION`; preparation controls do not start recording or negotiation timer.
6. Negotiation phase and recording lifecycle: start/pause/resume/finish behavior preserves one recording and delays transcription until explicit action.
7. Session rejoin: participant and facilitator return to the same session, role, and control state.
8. Notes visibility: participants/observer see only their own notes; facilitator can review all notes.
9. Soft delete and snapshots: deleted cases disappear from new selectors while old sessions keep snapshots and role privacy.
10. Admin diagnostics and external service errors: mocked provider failures are visible and do not expose secrets.
11. Transcription: completed mock recording can be transcribed, edited, saved, and reloaded.
12. i18n: RU/EN labels switch while case, notes, transcript, and product spelling remain unchanged.
13. Header/sticky layout: important pages remain usable when scrolled.
14. Events compact UI: no horizontal overflow at 1366px, readable stats, completed Events do not show active controls.
15. Multi-session creation: one Event can contain multiple active and finished Sessions with consistent stats.
16. Sequential participant workflow: a participant can finish Session 1, return to lobby, see Session 1 materials, then join Session 2.
17. Duplicate active assignment prevention: participant cannot be assigned to two active Sessions, but can be reassigned after finishing.
18. Event completion across Sessions: all active Sessions close, recordings are preserved, and materials links remain available.
19. Rejoin routing: active assignment opens room; finished/latest assignment opens materials; completed Event does not reopen a live room.
20. Recording/transcription isolation: per-session recordings and transcripts do not leak across Sessions.

## Stable Selector Strategy

Use `data-testid` for critical controls and state assertions. Add missing test ids without changing UX, especially:

- Event/case/session creation controls.
- Event lobby assignment controls.
- Rejoin button.
- Session preparation and negotiation controls.
- Recording status and transcription controls.
- Transcript textarea and save button.
- Admin diagnostics link.
- Multi-session Event stats: `event-total-sessions`, `event-active-sessions`, `event-finished-sessions`, `event-participants-in-lobby`.
- Event lobby: `case-library-section`, `sessions-board`, `event-session-card`, `my-sessions-in-event-section`, `go-to-session-room-button`.
- Session room and materials: `session-room-page`, `session-finished-message`, `session-materials-page`, `private-role-section`.

Where a `data-testid` would be awkward, use accessible labels or roles, but avoid relying only on localized text for core logic.

## Risks

- Live room rendering depends on mock LiveKit token/config behavior; default e2e uses mock env and fake media.
- Privacy must be checked at API and UI levels because DOM hiding alone is insufficient.
- Existing forms have few stable selectors, so tests may need safe `data-testid` additions.
- Playwright installation may add package lock changes and browser binaries.
- Test database setup may need local environment alignment; `.env` must not be committed or exposed.

## Commands

Planned commands:

```bash
npm run lint
npm run build
npx prisma validate
npm run test:e2e
npm run test:all
```

Optional live smoke command:

```bash
RUN_LIVE_SMOKE_TESTS=true npm run test:e2e -- --grep @live-smoke
```

