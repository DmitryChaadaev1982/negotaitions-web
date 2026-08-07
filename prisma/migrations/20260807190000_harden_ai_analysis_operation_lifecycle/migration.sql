-- Additive durable ownership and lease fencing for AI analysis operations.
-- Existing rows intentionally remain valid with NULL ownership fields.

ALTER TABLE "AiAnalysis"
    ADD COLUMN "runToken" TEXT,
    ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "AiAnalysis_status_leaseExpiresAt_idx"
    ON "AiAnalysis"("status", "leaseExpiresAt");
