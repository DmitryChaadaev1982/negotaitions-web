# Architecture Code Map

Use this map before changing code. If you touch mapped files, update the linked architecture chapter in the same change.

## Mapping

- Product and domain orchestration
  - Code: `app/actions/cases.ts`, `app/actions/sessions.ts`, `app/actions/events.ts`, `lib/event-scheduling.ts`, `lib/timezones.ts`, `components/new-event-form.tsx`, `components/event-edit-form.tsx`, `prisma/schema.prisma`
  - Docs: `01-product-context.md`, `02-domain-model.md`, `04-session-event-flow.md`
  - Tests: `tests/e2e/current-product-workflow.spec.ts`, `tests/e2e/event-flow.spec.ts`

- Account preferences
  - Code: `app/actions/session-sound-preference.ts`, `app/api/account/session-sound-preference/route.ts`, `lib/session-sound-preference.ts`, `prisma/schema.prisma`
  - Docs: `02-domain-model.md`, `09-security-and-access-control.md`
  - Tests: `tests/e2e/session-sound-preference.spec.ts`

- Session/event lifecycle and control
  - Code: `app/api/sessions/[sessionId]/control/route.ts`, `app/api/sessions/[sessionId]/control-state/route.ts`, `app/api/sessions/[sessionId]/display-status/route.ts`, `app/api/sessions/[sessionId]/media-status/route.ts`, `app/api/sessions/[sessionId]/complete/route.ts`, `app/api/events/[id]/host/route.ts`, `app/api/events/[id]/state/route.ts`, `app/api/events/[id]/media-status/route.ts`, `app/api/events/[id]/media-control/route.ts`, `app/(app)/dashboard/page.tsx`, `components/account-dashboard-view.tsx`, `components/object-pictogram.tsx`, `components/join-page-view.tsx`, `components/session-detail-view.tsx`, `components/session-status-badge.tsx`, `components/sessions-list-view.tsx`, `lib/account-session-materials.ts`, `lib/dashboard-activity-selection.ts`, `lib/object-pictograms.ts`, `lib/event-active-assignment.ts`, `lib/legacy-session-terminal-normalization.ts`, `lib/rejoin/account.ts`, `lib/rejoin/validate.ts`, `lib/session-completion.ts`, `lib/session-display-status.ts`, `lib/session-empty-room-reconciliation.ts`, `lib/session-overview-shared.ts`, `lib/session-overview-stats.ts`, `lib/session-room-access.ts`, `lib/session-room-occupancy-policy.ts`, `lib/session-room-occupancy.ts`, `lib/session-facilitator.ts`, `scripts/ops/normalize-legacy-session-terminal-state.ts`
  - Docs: `04-session-event-flow.md`, `09-security-and-access-control.md`
  - Tests: `tests/e2e/session-lifecycle.spec.ts`, `tests/e2e/session-finish-canonical.spec.ts`, `tests/e2e/session-overview-status.spec.ts`, `tests/e2e/voximplant-room-presence.spec.ts`, `tests/e2e/event-multi-session.spec.ts`, `tests/e2e/voximplant-room-parity.spec.ts`, `tests/e2e/voximplant-event-lobby.spec.ts`, `tests/e2e/stage-3-13e-standalone-remediation.spec.ts`, `tests/e2e/stage-3-13e-dashboard-acceptance.spec.ts`, `tests/e2e/late-observer-debrief-entry.spec.ts`, `lib/dashboard-activity-selection.test.ts`, `lib/legacy-session-terminal-normalization.test.ts`, `lib/session-display-status.test.ts`, `lib/session-return-to-room.test.ts`, `lib/session-room-access.test.ts`, `lib/session-room-occupancy.test.ts`, `lib/negotiation-control.test.ts`, `app/api/sessions/[sessionId]/control/route.test.ts`

- Voximplant media integration
  - Code: `components/voximplant-negotiation-room-page.tsx`, `components/event-lobby-view.tsx`, `components/event-lobby-voximplant-room.tsx`, `lib/client/connection-id.ts`, `lib/client/stale-connection.ts`, `lib/voximplant/use-voximplant-room.ts`, `lib/voximplant/lobby-device-warning.ts`, `lib/voximplant/media-status-store.ts`, `lib/voximplant/event-media-control-store.ts`, `lib/voximplant/recording-dispatch.ts`, `lib/voximplant/recording-reconciliation-policy.ts`, `lib/voximplant/recording-reconciliation.ts`, `lib/voximplant/recording-status-fencing.ts`, `lib/voximplant/server-stop-client.ts`, `lib/voximplant/reinvite-scheme-sanitizer.ts`, `lib/voximplant/websdk-log-filter.ts`, `app/api/sessions/[sessionId]/voximplant/access/route.ts`, `app/api/events/[id]/voximplant-access/route.ts`, `app/api/events/[id]/media-control/route.ts`
  - Docs: `05-voximplant-integration.md`, `09-security-and-access-control.md`
  - Tests: `tests/e2e/voximplant-room-presence.spec.ts`, `tests/e2e/voximplant-recording-attempt-fencing.spec.ts`, `tests/e2e/voximplant-room-parity.spec.ts`, `tests/e2e/voximplant-event-lobby.spec.ts`, `lib/voximplant/recording-reconciliation-policy.test.ts`, `lib/voximplant/recording-reconciliation.test.ts`, `lib/voximplant/server-stop-client.test.ts`, `lib/voximplant/main-room-scenario.test.ts`, `lib/voximplant/main-room-scenario.runtime.test.ts`, `lib/client/connection-id.test.ts`, `lib/voximplant/participant-presence-media-model.test.ts`, `lib/voximplant/reinvite-scheme-sanitizer.test.ts`, `lib/voximplant/lobby-device-warning.test.ts`

- Recording and transcription pipeline
  - Code: `app/api/sessions/[sessionId]/materials/status/route.ts`, `app/api/sessions/[sessionId]/materials/transcribe/route.ts`, `app/api/sessions/[sessionId]/materials/retranscribe/route.ts`, `app/api/sessions/[sessionId]/materials/enhance-transcript/route.ts`, `components/recording-indicator.tsx`, `components/recording-transcription-section.tsx`, `lib/recording-display-state.ts`, `lib/services/transcription-run-claim.ts`, `lib/services/transcription-runner.ts`, `lib/services/transcription-provider.ts`, `lib/services/yandex-speechkit-transcription.ts`, `lib/services/yandex-transcript-enhancement.ts`, `lib/services/transcript-enhancement-persistence.ts`, `lib/services/transcript-enhancement-orchestration.ts`, `lib/transcription/active-audio-timeline.ts`, `lib/transcription/active-audio-builder.ts`, `lib/transcription/pause-segment-processing.ts`, `lib/transcription/pause-processing-mode.ts`, `lib/transcription/transcript-timing.ts`, `lib/recording/provider.ts`, `lib/voximplant/recording-reconciliation-policy.ts`, `lib/voximplant/recording-reconciliation.ts`, `lib/voximplant/recording-status-fencing.ts`
  - Docs: `06-recording-transcription-pipeline.md`
  - Tests: `tests/e2e/session-materials-processing.spec.ts`, `tests/e2e/voximplant-recording-attempt-fencing.spec.ts`, `tests/e2e/stage-3-13e-standalone-remediation.spec.ts`, `tests/e2e/two-pass-transcription.spec.ts`, `lib/recording/recording-attempt-fencing.test.ts`, `lib/recording-display-state.test.ts`, `lib/voximplant/recording-reconciliation-policy.test.ts`, `lib/voximplant/recording-reconciliation.test.ts`, `lib/voximplant/recording-status-fencing.test.ts`, `lib/transcription/transcript-timing.test.ts`, `lib/services/yandex-transcript-enhancement.test.ts`, `lib/services/transcript-enhancement-orchestration.test.ts`, `lib/services/transcript-enhancement-persistence.test.ts`, `lib/env.transcript-enhancement.test.ts`, `lib/transcription/pause-interval-filter.test.ts`, `lib/transcription/pause-segment-processing.test.ts`

- Speaker mapping and telemetry
  - Code: `app/api/sessions/[sessionId]/speaker-mapping/route.ts`, `components/recording-transcription-section.tsx`, `lib/transcription/auto-speaker-mapping.ts`, `lib/transcription/auto-trigger-mapping.ts`, `lib/transcription/mapping-ui-presentation.ts`, `lib/telemetry/active-timeline-normalization.ts`, `lib/telemetry/**/*.ts`
  - Docs: `07-speaker-mapping-and-telemetry.md`
  - Tests: `tests/e2e/diarization-speaker-mapping.spec.ts`, `lib/transcription/mapping-ui-presentation.test.ts`

- AI analysis and debrief
  - Code: `app/api/sessions/[sessionId]/analyze/route.ts`, `app/api/sessions/[sessionId]/materials/status/route.ts`, `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`, `app/api/sessions/[sessionId]/ai-analysis/unshare/route.ts`, `lib/ai/negotiation-analysis.ts`, `lib/ai/analysis-input-budget.ts`, `lib/ai/analysis-operation.ts`, `lib/ai/session-analysis-context.ts`, `lib/ai/session-analysis-prompt.ts`, `lib/analysis-visibility.ts`, `lib/privacy/serializers.ts`, `lib/ai-publication.ts`, `lib/ai-publication-entry-grant.ts`, `lib/ai-publication-aggregate.ts`, `lib/materials-ai-analysis-view.ts`, `components/session-post-processing-panel.tsx`, `components/session-materials-dashboard.tsx`, `prisma/schema.prisma`
  - Docs: `08-ai-analysis-and-debrief.md`, `09-security-and-access-control.md`
  - Tests: `tests/e2e/debrief-ai-sharing.spec.ts`, `tests/e2e/session-materials-processing.spec.ts`, `lib/ai/analysis-operation.test.ts`, `lib/ai/negotiation-analysis.test.ts`, `lib/ai/session-analysis-prompt.test.ts`, `lib/ai-publication.test.ts`, `lib/ai-publication-transaction.test.ts`, `lib/analysis-visibility.test.ts`, `lib/materials-ai-analysis-view.test.ts`, `lib/materials-status-readiness.test.ts`

- Security and access control
  - Code: `lib/auth/**`, `lib/auth/client-ip.ts`, `lib/auth/credential-concurrency.ts`, `lib/auth/credential-dispatch-fence.ts`, `lib/auth/user-row-lock.ts`, `lib/auth/registration.ts`, `lib/auth/authenticated-password-change.ts`, `lib/auth/admin-account-status.ts`, `lib/auth/account-security-error-messages.ts`, `lib/auth/reset-fragment.ts`, `lib/auth/response-timing-floor.ts`, `lib/prisma.ts`, `lib/prisma-connection-string.ts`, `lib/email/rendered-content-guards.ts`, `lib/email/account-security.ts`, `lib/email/admin-journal.ts`, `lib/email/sensitive-payload.ts`, `lib/email/password-reset-dispatch.ts`, `lib/email/canary.ts`, `lib/email/operational-cli.ts`, `lib/email/local-preview.ts`, `lib/email/provider-event-consumer.ts`, `lib/email/yandex-postbox-provider-event-parser.ts`, `app/api/auth/forgot-password/route.ts`, `app/api/admin/email-journal/**`, `app/api/admin/email-preview/route.ts`, `app/(app)/admin/email/**`, `app/api/events/**`, `app/api/sessions/**`, `lib/room-participant-resolver.ts`
  - Provider-event ingestion and auth-origin remediation: `lib/email/provider-event-consumer-cli.ts`, `lib/email/provider-event-consumer-harness.ts`, `lib/config/server-action-origins.ts`, `lib/auth/return-url.ts`, `tests/e2e/helpers/production-proxy-harness.ts`
  - Docs: `09-security-and-access-control.md`, `account-security-email-flows.md`, `email-delivery-foundation.md`, `docs/implementation/stage-3-13c-security-remediation.md`, `docs/implementation/stage-3-13c-provider-events-auth-admin.md`, `docs/audits/stage-3-13c-proxy-readiness/`
  - Tests: `tests/e2e/phase-1-1-security.spec.ts`, `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts`, `tests/e2e/stage-3-13c-account-email.spec.ts`, `tests/e2e/stage-3-13c-proxy-and-email-journal.spec.ts`, `tests/e2e/stage-3-13c-login-logout.spec.ts`, `tests/e2e/stage-3-13c-production-proxy-login.spec.ts`, `lib/auth/password-reset-core.test.ts`, `lib/auth/client-ip.test.ts`, `lib/auth/return-url.test.ts`, `lib/config/server-action-origins.test.ts`, `lib/auth/credential-concurrency.remediation.test.ts`, `lib/auth/reset-fragment.test.ts`, `lib/auth/account-security-error-messages.test.ts`, `lib/auth/test-hook-production-guard.test.ts`, `lib/prisma-connection-string.test.ts`, `lib/email/admin-journal.test.ts`, `lib/email/sensitive-payload.test.ts`, `lib/email/final-remediation.test.ts`, `lib/email/canonical-origin.test.ts`, `lib/email/local-preview.test.ts`, `lib/email/provider-event-consumer.test.ts`, `lib/email/provider-event-consumer-shards.test.ts`, `lib/email/provider-event-consumer-cli.test.ts`, `lib/email/provider-event-consumer-lock.pg.test.ts`, `scripts/stage-3-13c-test-database.ts`, `scripts/run-stage-3-13c-provider-events.ts`, `scripts/run-stage-3-13c-schema-verifier.ts`, `scripts/verify-stage-3-13c-high-remediation-r2.ts`, `scripts/verify-stage-3-13c-final-remediation.ts`, `scripts/verify-stage-3-13c-provider-event-remediation.ts`

- Deployment and external systems
  - Code: `lib/env.ts`, `lib/config.ts`, `lib/config/server-runtime-settings.ts`, `lib/config/provider-runtime.ts`, `lib/prisma-production-migration-overlay.ts`, `lib/runtime-permissions.ts`, `lib/storage/s3.ts`, `lib/services/admin-env-display.ts`, `lib/services/admin-health-route-handler.ts`, `components/admin-diagnostics-emergency-state.tsx`, `app/api/admin/health/route.ts`, `scripts/verify-runtime-config-drift.ts`, `scripts/ops/prisma-production-migration-overlay.ts`, `scripts/ops/email-*.ts`, `scripts/ops/password-reset-backlog-quarantine.ts`, `deploy/systemd/negotiations-email-*`
  - Docs: `11-deployment-architecture.md`, `12-external-systems.md`, `email-runtime-and-yandex-cloud.md`, `docs/operations/admin-configuration-diagnostics.md`, `docs/operations/deployment-runbook.md`
  - Tests: `tests/e2e/admin-diagnostics-env.spec.ts`, `app/api/admin/health/route.test.ts`, `lib/prisma-production-migration-overlay.test.ts`, `lib/services/admin-health-emergency-ui.test.ts`, `lib/services/admin-env-display.test.ts`, `lib/config/server-runtime-settings.test.ts`

- Test tooling and E2E fixtures
  - Code: `scripts/agent-tooling/**`, `scripts/run-playwright-mode.mjs`, `playwright*.config.ts`, `tests/e2e/helpers/db.ts`, `tests/e2e/helpers/e2e-database.ts`, `tests/e2e/**`
  - Docs: `docs/testing/e2e-strategy.md`, `docs/testing/observer-test-execution-policy.md`, `docs/testing/validation-checklist.md`, `docs/testing/agent-model-routing.md`

- Public website and content foundation
  - Code: `app/(public)/layout.tsx`, `app/(public)/page.tsx`,
    `app/(public)/about/page.tsx`, `app/(public)/support/page.tsx`,
    `app/(public)/faq/page.tsx`, `components/public-header.tsx`,
    `components/public-home-page.tsx`, `components/public-about-page.tsx`,
    `components/public-support-page.tsx`, `components/public-faq-page.tsx`,
    `components/public-visual-frame.tsx`, `components/site-footer.tsx`,
    `components/app-header-nav.tsx`, `lib/public-site/visuals.ts`,
    `lib/public-site/faq-items.ts`, `lib/public-site/author-portrait.ts`,
    `public/images/public-site/`, `public/images/landing/`,
    `lib/seo/indexing.ts`, `lib/i18n/config.ts`,
    `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ru.ts`,
    `app/(app)/layout.tsx`, `app/(auth)/layout.tsx`, `app/room/layout.tsx`
  - Docs: `13-public-site-and-content.md`, `03-application-architecture.md`, `01-product-context.md`
  - Tests: `lib/seo/indexing.test.ts`, `lib/i18n/config.test.ts`,
    `lib/i18n/dictionaries/public-home.test.ts`,
    `lib/i18n/dictionaries/public-communication.test.ts`,
    `lib/public-site/visuals.test.ts`, `tests/e2e/public-homepage.spec.ts`,
    `tests/e2e/public-communication.spec.ts`,
    `tests/e2e/phase-6-legal-consent.spec.ts`

## Required Doc-Update Rule

1. Before coding, inspect this map.
2. If changed files are mapped, update the linked architecture doc(s).
3. If no doc update is needed, explicitly justify that in final response/PR.
4. New major feature area:
   - add mapping entry here,
   - add or extend chapter in `architecture/`.
