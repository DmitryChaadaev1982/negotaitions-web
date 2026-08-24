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
  - Code: `app/api/sessions/[sessionId]/control/route.ts`, `app/api/sessions/[sessionId]/control-state/route.ts`, `app/api/sessions/[sessionId]/display-status/route.ts`, `app/api/sessions/[sessionId]/media-status/route.ts`, `app/api/sessions/[sessionId]/complete/route.ts`, `app/api/sessions/[sessionId]/presence/route.ts`, `app/api/sessions/[sessionId]/presence/stream/route.ts`, `app/api/events/[id]/host/route.ts`, `app/api/events/[id]/state/route.ts`, `app/api/events/[id]/media-status/route.ts`, `app/api/events/[id]/media-control/route.ts`, `app/(app)/dashboard/page.tsx`, `components/account-dashboard-view.tsx`, `components/object-pictogram.tsx`, `components/join-page-view.tsx`, `components/session-detail-view.tsx`, `components/session-status-badge.tsx`, `components/sessions-list-view.tsx`, `components/participants-table.tsx`, `lib/account-session-materials.ts`, `lib/dashboard-activity-selection.ts`, `lib/object-pictograms.ts`, `lib/event-active-assignment.ts`, `lib/event-participant-presence.ts`, `lib/event-presence-buckets.ts`, `lib/event-overview-stats.ts`, `lib/legacy-session-terminal-normalization.ts`, `lib/rejoin/account.ts`, `lib/rejoin/validate.ts`, `lib/session-completion.ts`, `lib/session-completion-core.ts`, `lib/session-current-presence.ts`, `lib/session-current-presence-read.ts`, `lib/session-display-status.ts`, `lib/session-empty-room-reconciliation.ts`, `lib/session-lifecycle-policy.ts`, `lib/session-lifecycle-candidate-selection.ts`, `lib/session-lifecycle-sql.ts`, `lib/session-lifecycle-concurrency-hooks.ts`, `lib/session-lifecycle-observability.ts`, `lib/config/session-lifecycle-settings.ts`, `lib/session-overview-shared.ts`, `lib/session-overview-stats.ts`, `lib/session-room-access.ts`, `lib/session-room-occupancy-policy.ts`, `lib/session-room-occupancy.ts`, `lib/session-room-connection-lease.ts`, `lib/session-facilitator.ts`, `lib/stage-3-10-maintenance.ts`, `scripts/ops/stage-3-10-maintenance.ts`, `scripts/ops/normalize-legacy-session-terminal-state.ts`
  - Docs: `04-session-event-flow.md`, `09-security-and-access-control.md`
  - Tests: `tests/e2e/session-lifecycle.spec.ts`, `tests/e2e/session-finish-canonical.spec.ts`, `tests/e2e/session-overview-status.spec.ts`, `tests/e2e/voximplant-room-presence.spec.ts`, `tests/e2e/event-multi-session.spec.ts`, `tests/e2e/voximplant-room-parity.spec.ts`, `tests/e2e/voximplant-event-lobby.spec.ts`, `tests/e2e/stage-3-13e-standalone-remediation.spec.ts`, `tests/e2e/stage-3-13e-dashboard-acceptance.spec.ts`, `tests/e2e/late-observer-debrief-entry.spec.ts`, `tests/e2e/event-dashboard-lane.spec.ts`, `tests/e2e/event-archive-reuse.spec.ts`, `tests/e2e/stage-3-18a-presence-display.spec.ts`, `lib/dashboard-activity-selection.test.ts`, `lib/access-control.test.ts`, `lib/legacy-session-terminal-normalization.test.ts`, `lib/session-display-status.test.ts`, `lib/session-current-presence.test.ts`, `lib/session-return-to-room.test.ts`, `lib/session-room-access.test.ts`, `lib/session-room-occupancy.test.ts`, `lib/session-lifecycle-policy.test.ts`, `lib/session-lifecycle-finalizer.test.ts`, `lib/session-lifecycle-finalizer.pg.test.ts`, `lib/session-lifecycle-candidate-selection.test.ts`, `lib/session-lifecycle-observability.test.ts`, `lib/event-participant-presence.test.ts`, `lib/event-overview-stats.test.ts`, `lib/config/session-lifecycle-settings.test.ts`, `lib/negotiation-control.test.ts`, `lib/stage-3-10-maintenance.test.ts`, `lib/stage-3-10-maintenance-cli.test.ts`

- Voximplant media integration
  - Code: `components/voximplant-negotiation-room-page.tsx`, `components/event-lobby-view.tsx`, `components/event-lobby-voximplant-room.tsx`, `lib/client/connection-id.ts`, `lib/client/stale-connection.ts`, `lib/voximplant/use-voximplant-room.ts`, `lib/voximplant/lobby-device-warning.ts`, `lib/voximplant/media-status-store.ts`, `lib/voximplant/event-media-control-store.ts`, `lib/voximplant/recording-dispatch.ts`, `lib/voximplant/recording-reconciliation-policy.ts`, `lib/voximplant/recording-reconciliation.ts`, `lib/voximplant/recording-status-fencing.ts`, `lib/voximplant/server-stop-client.ts`, `lib/voximplant/server-stop-settings.ts`, `lib/voximplant/server-stop-config.ts`, `lib/voximplant/server-stop-replay-store.ts`, `lib/voximplant/config-settings.ts`, `lib/voximplant/recording-webhook-url-store.ts`, `lib/voximplant/reinvite-scheme-sanitizer.ts`, `lib/voximplant/websdk-log-filter.ts`, `app/api/sessions/[sessionId]/voximplant/access/route.ts`, `app/api/events/[id]/voximplant-access/route.ts`, `app/api/events/[id]/media-control/route.ts`
  - Docs: `05-voximplant-integration.md`, `09-security-and-access-control.md`
  - Tests: `tests/e2e/voximplant-room-presence.spec.ts`, `tests/e2e/voximplant-recording-attempt-fencing.spec.ts`, `tests/e2e/voximplant-room-parity.spec.ts`, `tests/e2e/voximplant-event-lobby.spec.ts`, `lib/voximplant/recording-reconciliation-policy.test.ts`, `lib/voximplant/recording-reconciliation.test.ts`, `lib/voximplant/server-stop-client.test.ts`, `lib/voximplant/main-room-scenario.test.ts`, `lib/voximplant/main-room-scenario.runtime.test.ts`, `lib/client/connection-id.test.ts`, `lib/voximplant/participant-presence-media-model.test.ts`, `lib/voximplant/reinvite-scheme-sanitizer.test.ts`, `lib/voximplant/lobby-device-warning.test.ts`

- Recording and transcription pipeline
  - Code: `app/api/sessions/[sessionId]/materials/status/route.ts`, `app/api/sessions/[sessionId]/materials/transcribe/route.ts`, `app/api/sessions/[sessionId]/materials/retranscribe/route.ts`, `app/api/sessions/[sessionId]/transcribe-recording/route.ts`, `app/api/sessions/[sessionId]/materials/enhance-transcript/route.ts`, `app/api/sessions/[sessionId]/transcript/route.ts`, `app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts`, `components/recording-indicator.tsx`, `components/recording-transcription-section.tsx`, `lib/recording-display-state.ts`, `lib/post-processing/projection.ts`, `lib/post-processing/enhancement-effective-state.ts`, `lib/services/transcription-run-claim.ts`, `lib/services/transcription-ownership.ts`, `lib/services/transcription-generation-cas.ts`, `lib/services/transcribe-recording-compatibility.ts`, `lib/transcription/transcription-routes.ts`, `lib/services/transcription-runner.ts`, `lib/services/transcription-provider.ts`, `lib/services/yandex-speechkit-transcription.ts`, `lib/services/yandex-transcript-enhancement.ts`, `lib/services/transcript-enhancement-persistence.ts`, `lib/services/transcript-enhancement-orchestration.ts`, `lib/services/transcript-enhancement-timeout.ts`, `lib/transcription/processing-metadata.ts`, `lib/transcription/canonical-diarized-text.ts`, `lib/transcription/recording-transcription-presentation.ts`, `lib/transcription/active-audio-timeline.ts`, `lib/transcription/active-audio-builder.ts`, `lib/transcription/pause-segment-processing.ts`, `lib/transcription/pause-processing-mode.ts`, `lib/transcription/transcript-timing.ts`, `lib/recording/provider.ts`, `lib/voximplant/recording-reconciliation-policy.ts`, `lib/voximplant/recording-reconciliation.ts`, `lib/voximplant/recording-status-fencing.ts`
  - Docs: `06-recording-transcription-pipeline.md`
  - Tests: `tests/e2e/session-materials-processing.spec.ts`, `tests/e2e/voximplant-recording-attempt-fencing.spec.ts`, `tests/e2e/stage-3-13e-standalone-remediation.spec.ts`, `tests/e2e/two-pass-transcription.spec.ts`, `lib/recording/recording-attempt-fencing.test.ts`, `lib/recording-display-state.test.ts`, `lib/voximplant/recording-reconciliation-policy.test.ts`, `lib/voximplant/recording-reconciliation.test.ts`, `lib/voximplant/recording-status-fencing.test.ts`, `lib/transcription/transcript-timing.test.ts`, `lib/transcription/processing-metadata.test.ts`, `lib/transcription/canonical-diarized-text.test.ts`, `lib/transcription/recording-transcription-presentation.test.ts`, `lib/transcription/phase-e-save-contract.test.ts`, `lib/post-processing/projection.test.ts`, `lib/post-processing/enhancement-live-transition.test.ts`, `lib/post-processing/historical-session-compatibility.test.ts`, `lib/services/transcription-ownership.test.ts`, `lib/services/transcription-generation-cas.test.ts`, `lib/services/transcribe-recording-compatibility.test.ts`, `lib/services/transcription-phase-f-race.test.ts`, `lib/transcription/transcription-routes.test.ts`, `lib/services/yandex-transcript-enhancement.test.ts`, `lib/services/transcript-enhancement-orchestration.test.ts`, `lib/services/transcript-enhancement-transitions.test.ts`, `lib/services/transcript-enhancement-persistence.test.ts`, `lib/env.transcript-enhancement.test.ts`, `lib/transcription/pause-interval-filter.test.ts`, `lib/transcription/pause-segment-processing.test.ts`

- Speaker mapping and telemetry
  - Code: `app/api/sessions/[sessionId]/speaker-mapping/route.ts`, `components/recording-transcription-section.tsx`, `lib/transcription/auto-speaker-mapping.ts`, `lib/transcription/auto-trigger-mapping.ts`, `lib/transcription/speaker-mapping-candidates.ts`, `lib/transcription/speaker-mapping-candidate-load.ts`, `lib/transcription/speaker-mapping-completeness.ts`, `lib/transcription/confirm-mapping-after-ai-admission.ts`, `lib/transcription/mapping-ui-presentation.ts`, `lib/telemetry/active-timeline-normalization.ts`, `lib/telemetry/**/*.ts`
  - Docs: `07-speaker-mapping-and-telemetry.md`
  - Tests: `tests/e2e/diarization-speaker-mapping.spec.ts`, `lib/transcription/mapping-ui-presentation.test.ts`, `lib/transcription/speaker-mapping-completeness.test.ts`, `lib/transcription/speaker-mapping-readiness.test.ts`, `lib/transcription/confirm-mapping-after-ai-admission.test.ts`, `lib/transcription/speaker-mapping-state.test.ts`

- AI analysis and debrief
  - Code: `app/api/sessions/[sessionId]/analyze/route.ts`, `app/api/sessions/[sessionId]/materials/status/route.ts`, `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`, `app/api/sessions/[sessionId]/ai-analysis/unshare/route.ts`, `lib/ai/negotiation-analysis.ts`, `lib/ai/analysis-failure-diagnostics.ts`, `lib/ai/analysis-schema-recovery-policy.ts`, `lib/ai/analysis-schema-recovery.ts`, `lib/ai/analysis-input-budget.ts`, `lib/ai/analysis-operation.ts`, `lib/ai/analysis-currentness.ts`, `lib/ai/material-input-envelope.ts`, `lib/ai/material-input-invalidation.ts`, `lib/ai/material-negotiation-notes.ts`, `lib/participant-notes-write.ts`, `lib/debrief-visible-notes.ts`, `lib/ai/session-analysis-context.ts`, `lib/ai/session-analysis-prompt.ts`, `lib/ai-publication-revoke.ts`, `lib/analysis-visibility.ts`, `lib/privacy/serializers.ts`, `lib/ai-publication.ts`, `lib/ai-publication-entry-grant.ts`, `lib/ai-publication-aggregate.ts`, `lib/materials-ai-analysis-view.ts`, `components/session-post-processing-panel.tsx`, `components/session-materials-dashboard.tsx`, `components/account-session-materials-view.tsx`, `app/actions/sessions.ts`, `prisma/schema.prisma`
  - Research-only (not a production runtime import): `lib/ai/schema-characterization.ts`, `scripts/research/characterize-yandex-analysis-schema.ts`
  - Docs: `08-ai-analysis-and-debrief.md`, `09-security-and-access-control.md`
  - Tests: `tests/e2e/debrief-ai-sharing.spec.ts`, `tests/e2e/session-materials-processing.spec.ts`, `tests/e2e/retranscription-confirmation-ui.spec.ts`, `lib/ai/analysis-operation.test.ts`, `lib/ai/negotiation-analysis.test.ts`, `lib/ai/negotiation-analysis-schema-contract.test.ts`, `lib/ai/analysis-failure-diagnostics.test.ts`, `lib/ai/analysis-schema-recovery.test.ts`, `lib/ai/schema-characterization.test.ts`, `lib/ai/session-analysis-prompt.test.ts`, `lib/ai/analysis-currentness.test.ts`, `lib/ai/legacy-null-material-edit.test.ts`, `lib/ai/material-input-envelope.test.ts`, `lib/ai/material-input-invalidation.test.ts`, `lib/ai/retranscription-downstream-invalidation.test.ts`, `lib/ai/material-negotiation-notes.test.ts`, `lib/debrief-visible-notes.test.ts`, `lib/ai-publication.test.ts`, `lib/ai-publication-transaction.test.ts`, `lib/analysis-visibility.test.ts`, `lib/materials-ai-analysis-view.test.ts`, `lib/materials-status-readiness.test.ts`, `lib/post-processing/historical-session-compatibility.test.ts`, `lib/post-processing/retranscription-confirmation-ui.test.ts`

- Security and access control
  - Code: `lib/auth/**`, `lib/auth/client-ip.ts`, `lib/auth/credential-concurrency.ts`, `lib/auth/credential-dispatch-fence.ts`, `lib/auth/user-row-lock.ts`, `lib/auth/registration.ts`, `lib/auth/authenticated-password-change.ts`, `lib/auth/admin-account-status.ts`, `lib/auth/account-security-error-messages.ts`, `lib/auth/reset-fragment.ts`, `lib/auth/response-timing-floor.ts`, `lib/prisma.ts`, `lib/prisma-connection-string.ts`, `lib/email/rendered-content-guards.ts`, `lib/email/account-security.ts`, `lib/email/admin-journal.ts`, `lib/email/sensitive-payload.ts`, `lib/email/password-reset-dispatch.ts`, `lib/email/canary.ts`, `lib/email/operational-cli.ts`, `lib/email/local-preview.ts`, `lib/email/provider-event-consumer.ts`, `lib/email/yandex-postbox-provider-event-parser.ts`, `app/api/auth/forgot-password/route.ts`, `app/api/admin/email-journal/**`, `app/api/admin/email-preview/route.ts`, `app/(app)/admin/email/**`, `app/api/events/**`, `app/api/sessions/**`, `lib/room-participant-resolver.ts`
  - Provider-event ingestion and auth-origin remediation: `lib/email/provider-event-consumer-cli.ts`, `lib/email/provider-event-consumer-harness.ts`, `lib/config/server-action-origins.ts`, `lib/auth/return-url.ts`, `tests/e2e/helpers/production-proxy-harness.ts`
  - Docs: `09-security-and-access-control.md`, `account-security-email-flows.md`, `email-delivery-foundation.md`, `docs/implementation/stage-3-13c-security-remediation.md`, `docs/implementation/stage-3-13c-provider-events-auth-admin.md`, `docs/audits/stage-3-13c-proxy-readiness/`
  - Tests: `tests/e2e/phase-1-1-security.spec.ts`, `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts`, `tests/e2e/stage-3-13c-account-email.spec.ts`, `tests/e2e/stage-3-13c-proxy-and-email-journal.spec.ts`, `tests/e2e/stage-3-13c-login-logout.spec.ts`, `tests/e2e/stage-3-13c-production-proxy-login.spec.ts`, `lib/auth/password-reset-core.test.ts`, `lib/auth/client-ip.test.ts`, `lib/auth/return-url.test.ts`, `lib/config/server-action-origins.test.ts`, `lib/auth/credential-concurrency.remediation.test.ts`, `lib/auth/reset-fragment.test.ts`, `lib/auth/account-security-error-messages.test.ts`, `lib/auth/test-hook-production-guard.test.ts`, `lib/prisma-connection-string.test.ts`, `lib/email/admin-journal.test.ts`, `lib/email/sensitive-payload.test.ts`, `lib/email/final-remediation.test.ts`, `lib/email/canonical-origin.test.ts`, `lib/email/local-preview.test.ts`, `lib/email/provider-event-consumer.test.ts`, `lib/email/provider-event-consumer-shards.test.ts`, `lib/email/provider-event-consumer-cli.test.ts`, `lib/email/provider-event-consumer-lock.pg.test.ts`, `scripts/stage-3-13c-test-database.ts`, `scripts/run-stage-3-13c-provider-events.ts`, `scripts/run-stage-3-13c-schema-verifier.ts`, `scripts/verify-stage-3-13c-high-remediation-r2.ts`, `scripts/verify-stage-3-13c-final-remediation.ts`, `scripts/verify-stage-3-13c-provider-event-remediation.ts`

- Deployment and external systems
  - Code: `lib/env.ts`, `lib/config.ts`, `lib/config/server-runtime-settings.ts`, `lib/config/session-lifecycle-settings.ts`, `lib/config/provider-runtime.ts`, `lib/prisma-production-migration-overlay.ts`, `lib/runtime-permissions.ts`, `lib/storage/s3.ts`, `lib/services/admin-env-display.ts`, `lib/services/admin-health-route-handler.ts`, `components/admin-diagnostics-emergency-state.tsx`, `app/api/admin/health/route.ts`, `lib/debug/recording-debug.ts`, `app/api/debug/recording/[sessionId]/route.ts`, `scripts/verify-runtime-config-drift.ts`, `scripts/ops/prisma-production-migration-overlay.ts`, `scripts/ops/email-*.ts`, `scripts/ops/password-reset-backlog-quarantine.ts`, `deploy/systemd/negotiations-email-*`, `deploy/systemd/negotiations-stage310-maintenance.timer`, `deploy/nginx/trusted-client-ip-snippet.conf`, `deploy/nginx/sanitized-access-log.conf`
  - Docs: `11-deployment-architecture.md`, `12-external-systems.md`, `email-runtime-and-yandex-cloud.md`, `docs/operations/admin-configuration-diagnostics.md`, `docs/operations/deployment-runbook.md`
  - Tests: `tests/e2e/admin-diagnostics-env.spec.ts`, `app/api/admin/health/route.test.ts`, `lib/prisma-production-migration-overlay.test.ts`, `lib/services/admin-health-emergency-ui.test.ts`, `lib/services/admin-env-display.test.ts`, `lib/config/server-runtime-settings.test.ts`, `lib/debug/recording-debug.test.ts`

- Engineering workflow and eval registry
  - Code: `scripts/eval-registry-check.mjs`, `scripts/eval-registry-lib.mjs`, `scripts/check-native-dialogs.mjs`, `scripts/check-native-dialogs-lib.mjs`, `scripts/native-dialog-allowlist.json`, `package.json` (`eval:registry:check`, `check:native-dialogs`, `test:unit`, `validate:fast`, `validate:build`, `validate:deploy`)
  - Docs: `docs/testing/engineering-workflow.md`, `docs/testing/eval-registry.json`, `docs/testing/validation-checklist.md`, `docs/testing/agent-model-routing.md`, `.cursor/skills/validate-wave/SKILL.md`, `.cursor/skills/verify-requirements/SKILL.md`
  - Tests: `scripts/__tests__/eval-registry-check.test.mjs`, `scripts/__tests__/check-native-dialogs.test.mjs`, `scripts/__tests__/validate-gate-scripts.test.mjs`

- Test tooling and E2E fixtures
  - Code: `scripts/agent-tooling/**`, `scripts/run-playwright-mode.mjs`, `scripts/lab-post-transcription.ts`, `scripts/research/characterize-yandex-analysis-schema.ts`, `playwright*.config.ts`, `tests/e2e/helpers/db.ts`, `tests/e2e/helpers/e2e-database.ts`, `tests/e2e/helpers/post-transcription-lab-*.ts`, `tests/e2e/post-transcription-lab.spec.ts`, `tests/e2e/**`
  - Docs: `docs/testing/engineering-workflow.md`, `docs/testing/eval-registry.json`, `docs/testing/e2e-strategy.md`, `docs/testing/observer-test-execution-policy.md`, `docs/testing/validation-checklist.md`, `docs/testing/agent-model-routing.md`, `docs/requirements/stage-3-15a-post-processing-workflow.md`, `docs/handoffs/stage-3-15a-local-operator-acceptance.md`

- Public website and content foundation
  - Code:     `app/(public)/layout.tsx`, `app/(public)/page.tsx`,
    `app/(public)/about/page.tsx`, `app/(public)/support/page.tsx`,
    `app/(public)/faq/page.tsx`, `app/opengraph-image.tsx`,
    `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`,
    `app/robots.ts`, `app/sitemap.ts`, `app/(legal)/layout.tsx`, `components/public-header.tsx`,
    `components/public-home-page.tsx`, `components/public-about-page.tsx`,
    `components/public-support-page.tsx`, `components/public-faq-page.tsx`,
    `components/public-visual-frame.tsx`, `components/site-footer.tsx`,
    `components/app-header.tsx`, `components/app-header-nav.tsx`, `components/ui/brand-logo.tsx`, `components/public-site-analytics.tsx`,
    `lib/public-site/visuals.ts`, `lib/public-site/faq-items.ts`, `lib/public-site/author-portrait.ts`,
    `public/images/public-site/`, `public/images/landing/`,
    `lib/seo/indexing.ts`, `lib/seo/canonical.ts`, `lib/seo/copy.ts`,
    `lib/seo/page-metadata.ts`, `lib/seo/robots-policy.ts`,
    `lib/seo/sitemap-pages.ts`, `lib/seo/site.ts`,
    `lib/analytics/yandex-metrica.ts`, `lib/analytics/yandex-metrica-client.ts`,
    `lib/consent/cookie-consent.ts`, `lib/i18n/config.ts`,
    `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ru.ts`,
- `lib/legal/`, `lib/consent/user-consent.ts`, `lib/auth/registration.ts`,
    `app/(legal)/privacy/page.tsx`, `app/(legal)/terms/page.tsx`,
    `app/(legal)/cookie-policy/page.tsx`,
    `app/(legal)/data-processing-consent/page.tsx`,
    `app/(legal)/ai-processing-notice/page.tsx`,
    `app/legal-update/page.tsx`, `app/actions/legal-release.ts`,
    `components/legal-document-page.tsx`, `components/legal-document-header.tsx`,
    `components/legal-update-view.tsx`, `components/legal-release-checkboxes.tsx`,
    `app/(auth)/register/page.tsx`,
    `app/(app)/layout.tsx`, `app/(auth)/layout.tsx`, `app/room/layout.tsx`,
    `lib/legal/require-current-release.ts`,
    `lib/legal/legal-update-return-url.ts`,
    `lib/legal/legal-document-return.ts`,
    `lib/legal/legal-update-draft.ts`
  - Docs: `13-public-site-and-content.md`, `03-application-architecture.md`,
    `01-product-context.md`, `09-security-and-access-control.md`,
    `10-data-storage-and-retention.md`,
    `docs/operations/personal-data-erasure-runbook.md`,
    `docs/operations/public-site-seo-and-analytics.md`
  - Tests: `lib/seo/indexing.test.ts`, `lib/seo/canonical.test.ts`,
    `lib/seo/sitemap-robots.test.ts`, `lib/seo/copy.test.ts`, `lib/seo/favicon.test.ts`, `lib/analytics/yandex-metrica.test.ts`,
    `lib/consent/cookie-consent.test.ts`, `lib/i18n/config.test.ts`,
    `lib/i18n/dictionaries/public-home.test.ts`,
    `lib/i18n/dictionaries/public-communication.test.ts`,
    `lib/legal/legal-copy.test.ts`, `lib/legal/release.test.ts`,
    `lib/legal/require-current-release.test.ts`,
    `lib/legal/legal-document-return.test.ts`,
    `lib/legal/legal-update-draft.test.ts`,
    `lib/consent/user-consent.test.ts`,
    `lib/public-site/visuals.test.ts`,
    `lib/public-site/app-header-nav-layout.test.ts`,
    `tests/e2e/public-homepage.spec.ts`,
    `tests/e2e/public-communication.spec.ts`,
    `tests/e2e/public-site-seo.spec.ts`,
    `tests/e2e/public-site-analytics.spec.ts`,
    `tests/e2e/phase-6-legal-consent.spec.ts`,
    `tests/e2e/legal-update.spec.ts`,
    `tests/e2e/legal-document-navigation.spec.ts`

## Required Doc-Update Rule

1. Before coding, inspect this map.
2. If changed files are mapped, update the linked architecture doc(s).
3. If no doc update is needed, explicitly justify that in final response/PR.
4. New major feature area:
   - add mapping entry here,
   - add or extend chapter in `architecture/`.
