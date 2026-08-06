# Stage 3.13C Final Review Residuals

These findings do not block the current High/Medium remediation. They remain
open, were intentionally deferred by product decision, and must not be
reported as fixed by this iteration.

## FINAL-04 — Authentication architecture documentation remains inaccurate

- Severity: Low
- Status: DEFERRED
- Affected document:
  `docs/architecture/account-security-email-flows.md` (original review:
  lines 227-239).
- Original review description: the document presents the original production
  authentication cause as established and lists local origins as if they were
  in the production Server Action allowlist.
- Operational risk: future authentication changes or operational reviews may
  rely on an inaccurate trust model.
- Recommended future correction: state that the production root cause remains
  unproven, document production as exactly `negotaitions.ru`, and list the five
  development origins separately.
- Runtime status: production origin behavior is already secure; this is a
  documentation residual only.

The affected architecture document is intentionally unchanged in this
iteration. FINAL-04 remains open and is not fixed.

## FINAL-05 — PostgreSQL truncates one migration identifier

- Severity: Informational
- Status: DEFERRED
- Affected migration:
  `prisma/migrations/20260806113000_add_email_provider_event_ingestion/migration.sql`.
- Affected index:
  `EmailProviderIngestionFailure_provider_streamName_shardId_sequenceNumber_key`.
- Original review description: the declared 76-character identifier exceeds
  PostgreSQL's 63-byte identifier limit and is automatically truncated.
- Collision risk: a future identifier with the same first 63 bytes could
  collide even though the current migration succeeds.
- Recommended future cleanup: use an explicit unique-index name no longer than
  63 characters in an appropriately planned migration-history cleanup.

The committed migration is intentionally not rewritten in this iteration.
FINAL-05 remains open and is not fixed.

## FINAL-06 — Removed origin variable remains named in tests

- Severity: Informational
- Status: DEFERRED
- Affected test: `lib/config/server-action-origins.test.ts` (original review:
  lines 64-69 and 147-153).
- Original review description: obsolete
  `NEXT_BUILD_ALLOW_LOCAL_SERVER_ACTION_ORIGINS`-family names remain in test
  fixtures after removal from runtime configuration.
- Runtime effect: none; the production resolver ignores these names and keeps
  the production allowlist restricted.
- Recommended future correction: replace the obsolete-name fixtures with a
  generic unknown-override test.

The obsolete-name fixtures are intentionally unchanged in this iteration.
FINAL-06 remains open and is not fixed.
