-- Global cross-process provider admission authority for transcript enhancement.
-- Fixed inventory of 10 leased slots; a future "leaseExpiresAt" means in-flight.
CREATE TABLE "TranscriptEnhancementProviderSlot" (
    "slotIndex" INTEGER NOT NULL,
    "jobId" TEXT,
    "runId" TEXT,
    "leaseToken" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptEnhancementProviderSlot_pkey" PRIMARY KEY ("slotIndex")
);

CREATE INDEX "TranscriptEnhancementProviderSlot_leaseExpiresAt_idx"
ON "TranscriptEnhancementProviderSlot"("leaseExpiresAt");

CREATE INDEX "TranscriptEnhancementProviderSlot_jobId_leaseExpiresAt_idx"
ON "TranscriptEnhancementProviderSlot"("jobId", "leaseExpiresAt");

-- Fixed slot inventory. Idempotent so a repeated bootstrap is a no-op.
INSERT INTO "TranscriptEnhancementProviderSlot" ("slotIndex", "updatedAt")
VALUES (0, NOW()), (1, NOW()), (2, NOW()), (3, NOW()), (4, NOW()),
       (5, NOW()), (6, NOW()), (7, NOW()), (8, NOW()), (9, NOW())
ON CONFLICT ("slotIndex") DO NOTHING;
