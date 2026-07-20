# Architecture Code Map

Use this map before changing code. If you touch mapped files, update the linked architecture chapter in the same change.

## Mapping

- Product and domain orchestration
  - Code: `app/actions/cases.ts`, `app/actions/sessions.ts`, `app/actions/events.ts`, `prisma/schema.prisma`
  - Docs: `01-product-context.md`, `02-domain-model.md`
  - Tests: `tests/e2e/current-product-workflow.spec.ts`, `tests/e2e/event-flow.spec.ts`

- Session/event lifecycle and control
  - Code: `app/api/sessions/[sessionId]/control/route.ts`, `app/api/sessions/[sessionId]/control-state/route.ts`, `app/api/sessions/[sessionId]/media-status/route.ts`, `app/api/events/[id]/host/route.ts`, `app/api/events/[id]/state/route.ts`, `app/api/events/[id]/media-status/route.ts`
  - Docs: `04-session-event-flow.md`
  - Tests: `tests/e2e/session-lifecycle.spec.ts`, `tests/e2e/event-multi-session.spec.ts`, `tests/e2e/voximplant-room-parity.spec.ts`, `tests/e2e/voximplant-event-lobby.spec.ts`, `lib/negotiation-control.test.ts`, `app/api/sessions/[sessionId]/control/route.test.ts`

- Voximplant media integration
  - Code: `components/voximplant-negotiation-room-page.tsx`, `components/event-lobby-view.tsx`, `components/event-lobby-voximplant-room.tsx`, `lib/client/connection-id.ts`, `lib/client/stale-connection.ts`, `lib/voximplant/use-voximplant-room.ts`, `lib/voximplant/media-status-store.ts`, `lib/voximplant/recording-dispatch.ts`, `app/api/sessions/[sessionId]/voximplant/access/route.ts`, `app/api/events/[id]/voximplant-access/route.ts`
  - Docs: `05-voximplant-integration.md`, `09-security-and-access-control.md`
  - Tests: `tests/e2e/voximplant-room-presence.spec.ts`, `tests/e2e/voximplant-room-parity.spec.ts`, `tests/e2e/voximplant-event-lobby.spec.ts`, `lib/client/connection-id.test.ts`, `lib/voximplant/participant-presence-media-model.test.ts`

- Recording and transcription pipeline
  - Code: `app/api/sessions/[sessionId]/materials/status/route.ts`, `app/api/sessions/[sessionId]/materials/enhance-transcript/route.ts`, `components/recording-transcription-section.tsx`, `lib/services/transcription-runner.ts`, `lib/services/transcription-provider.ts`, `lib/services/yandex-speechkit-transcription.ts`, `lib/services/yandex-transcript-enhancement.ts`, `lib/services/transcript-enhancement-persistence.ts`, `lib/services/transcript-enhancement-orchestration.ts`, `lib/transcription/active-audio-timeline.ts`, `lib/transcription/active-audio-builder.ts`, `lib/transcription/pause-segment-processing.ts`, `lib/transcription/pause-processing-mode.ts`, `lib/transcription/transcript-timing.ts`, `lib/recording/provider.ts`
  - Docs: `06-recording-transcription-pipeline.md`
  - Tests: `tests/e2e/session-materials-processing.spec.ts`, `tests/e2e/two-pass-transcription.spec.ts`, `lib/transcription/transcript-timing.test.ts`, `lib/services/yandex-transcript-enhancement.test.ts`, `lib/services/transcript-enhancement-persistence.test.ts`, `lib/env.transcript-enhancement.test.ts`, `lib/transcription/pause-interval-filter.test.ts`, `lib/transcription/pause-segment-processing.test.ts`

- Speaker mapping and telemetry
  - Code: `app/api/sessions/[sessionId]/speaker-mapping/route.ts`, `components/recording-transcription-section.tsx`, `lib/transcription/auto-speaker-mapping.ts`, `lib/transcription/auto-trigger-mapping.ts`, `lib/transcription/mapping-ui-presentation.ts`, `lib/telemetry/active-timeline-normalization.ts`, `lib/telemetry/**/*.ts`
  - Docs: `07-speaker-mapping-and-telemetry.md`
  - Tests: `tests/e2e/diarization-speaker-mapping.spec.ts`, `lib/transcription/mapping-ui-presentation.test.ts`

- AI analysis and debrief
  - Code: `app/api/sessions/[sessionId]/analyze/route.ts`, `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`, `lib/ai/negotiation-analysis.ts`, `lib/ai/session-analysis-context.ts`
  - Docs: `08-ai-analysis-and-debrief.md`
  - Tests: `tests/e2e/debrief-ai-sharing.spec.ts`, `tests/e2e/session-materials-processing.spec.ts`

- Security and access control
  - Code: `lib/auth/**`, `app/api/events/**`, `app/api/sessions/**`, `lib/room-participant-resolver.ts`
  - Docs: `09-security-and-access-control.md`
  - Tests: `tests/e2e/phase-1-1-security.spec.ts`, `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts`

- Deployment and external systems
  - Code: `lib/env.ts`, `lib/config.ts`, `lib/storage/s3.ts`, `app/api/admin/health/route.ts`
  - Docs: `11-deployment-architecture.md`, `12-external-systems.md`
  - Tests: `tests/e2e/admin-diagnostics-env.spec.ts`

- Voximplant server-stop POC (isolated; not production lifecycle)
  - Code: `lib/voximplant/poc/**` (incl. `poc-run-store.ts`, `poc-paths.ts`, `poc-health.ts`, `create-poc-session.ts`, `local-db-safety.ts`, `history-client.ts`, `conference-join-flag.ts`, `private-control-state.ts`, `orchestrator/**` with `browser-join.ts` prewarm/live phases, `participant-prewarm.ts`, `browser-stages.ts`, `browser-artifacts.ts`, `recording-start.ts`, `test-participant-access.ts`), `scripts/poc/voximplant-server-stop/**` (incl. `run-poc.ts`, `show-last-report.ts`, `cleanup-poc.ts`, `inspect-run.ts`, `test-participant-access.ts`, `test-recording-start.ts`), `docs/voximplant/neg-conf.server-stop-poc.scenario.js`, `app/api/poc/voximplant/server-stop/health/route.ts` (flag-gated POC health only), `app/api/poc/voximplant/server-stop/callback/route.ts` (flag-gated POC callback only), `app/api/sessions/[sessionId]/voximplant/access/route.ts` (flag-gated conference name override only)
  - Docs: `13-voximplant-server-stop-poc.md`, `docs/voximplant/server-stop-poc-manual-checkpoints.md`
  - Tests: `lib/voximplant/poc/**/*.test.ts` (`npm run test:poc:vox-server-stop`)

## Required Doc-Update Rule

1. Before coding, inspect this map.
2. If changed files are mapped, update the linked architecture doc(s).
3. If no doc update is needed, explicitly justify that in final response/PR.
4. New major feature area:
   - add mapping entry here,
   - add or extend chapter in `architecture/`.
