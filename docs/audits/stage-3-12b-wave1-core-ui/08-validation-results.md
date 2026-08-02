# Validation Results

This document is updated as validation gates run.

## Preflight

- Branch: `ui/stage-3-12b-wave1-core-ui`
- Base SHA: `57075368192dc5b7c0923e92156119065bbc4618`
- Working tree before implementation: clean
- `.env`: present and ignored by `.gitignore`

## Automated

- Focused semantic unit: passed with `node --import ./scripts/test-unit-env-bootstrap.mjs --import tsx --test "lib/ui/semantic-action-model.test.ts"`.
- Wave 1 focused E2E: passed with `npm run test:e2e:focused:managed -- tests/e2e/stage-3-12b-wave1-core-ui.spec.ts --project=chromium`.
- `npm run lint`: passed with 5 existing warnings outside Wave 1 changes.
- `npx tsc --noEmit`: Wave 1 errors fixed; command still fails on pre-existing unrelated test type errors in `lib/ai-publication-aggregate.test.ts`, `lib/services/transcript-enhancement-orchestration.test.ts`, `lib/voximplant/participant-presence-media-model.test.ts`, `lib/voximplant/server-stop-client.test.ts`, `tests/e2e/event-flow.spec.ts`, `tests/e2e/stage-3-12b-observer-scaling.spec.ts`, and `tests/e2e/two-pass-transcription.spec.ts`.
- `npm run validate:fast`: pending.
- `npm run validate:deploy`: pending.
- `npm run test:e2e:smoke`: pending.
- `npm run test:e2e:smoke:browser`: pending.
- `npm run test:stage310`: pending.

## Existing Relevant Suites To Run

- Account dashboard/navigation: `tests/e2e/phase-4-account-navigation.spec.ts`
- Event lobby: `tests/e2e/voximplant-event-lobby.spec.ts`
- Event completion: `tests/e2e/event-completion.spec.ts`
- Session navigation: `tests/e2e/session-navigation.spec.ts`
- Role preference / assignment: `tests/e2e/phase-6-11b-session-role-assignment.spec.ts`
- Participant presence: `tests/e2e/voximplant-room-presence.spec.ts`
- Observer rail: `tests/e2e/stage-3-12b-observer-scaling.spec.ts`
- Session finish/debrief: `tests/e2e/session-finish-canonical.spec.ts`

## Manual

Manual dashboard, participant, observer, facilitator, Event owner, lifecycle, responsive, zoom, and RU/EN checks are pending.
