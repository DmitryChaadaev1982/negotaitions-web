-- Stage 3.13B-H email foundation hardening.
-- Additive only: no data drops, renames, or required-column backfills.

-- Ambiguous provider acceptance is not retryable by the normal worker sweep.
ALTER TYPE "EmailMessageStatus" ADD VALUE IF NOT EXISTS 'ACCEPTANCE_UNKNOWN';

-- Unmatched provider events remain reconcilable instead of being marked processed.
ALTER TYPE "EmailProviderEventProcessingStatus" ADD VALUE IF NOT EXISTS 'UNMATCHED';

ALTER TABLE "EmailMessage"
ADD COLUMN IF NOT EXISTS "lastProviderEventType" "EmailProviderEventType",
ADD COLUMN IF NOT EXISTS "lastProviderEventTime" TIMESTAMP(3);

ALTER TABLE "EmailProviderEvent"
ADD COLUMN IF NOT EXISTS "processingResultCode" TEXT,
ADD COLUMN IF NOT EXISTS "processingResultMessage" TEXT,
ADD COLUMN IF NOT EXISTS "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "nextReconcileAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reconciliationDeadlineAt" TIMESTAMP(3);

-- Provider message identity is provider-qualified. PostgreSQL permits multiple
-- NULL values, so retention can still clear provider ids safely.
CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_providerName_lastProviderMessageId_key"
ON "EmailMessage"("providerName", "lastProviderMessageId");

CREATE UNIQUE INDEX IF NOT EXISTS "EmailDeliveryAttempt_provider_providerMessageId_key"
ON "EmailDeliveryAttempt"("provider", "providerMessageId");

CREATE INDEX IF NOT EXISTS "EmailMessage_providerName_lastProviderMessageId_idx"
ON "EmailMessage"("providerName", "lastProviderMessageId");

CREATE INDEX IF NOT EXISTS "EmailMessage_lastProviderEventTime_idx"
ON "EmailMessage"("lastProviderEventTime");

CREATE INDEX IF NOT EXISTS "EmailProviderEvent_provider_providerMessageId_idx"
ON "EmailProviderEvent"("provider", "providerMessageId");

CREATE INDEX IF NOT EXISTS "EmailProviderEvent_processingStatus_nextReconcileAt_idx"
ON "EmailProviderEvent"("processingStatus", "nextReconcileAt");

-- Active suppression uniqueness uses partial indexes because categoryScope is nullable.
CREATE UNIQUE INDEX IF NOT EXISTS "EmailSuppression_active_global_unique"
ON "EmailSuppression"("recipientEmailNormalized")
WHERE "active" = true AND "categoryScope" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "EmailSuppression_active_scoped_unique"
ON "EmailSuppression"("recipientEmailNormalized", "categoryScope")
WHERE "active" = true AND "categoryScope" IS NOT NULL;

ALTER TABLE "EmailProviderEvent"
ADD CONSTRAINT "EmailProviderEvent_emailMessageId_fkey"
FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
