-- Additive durable fencing for Stage 3.13C provider-event consumers.
-- Provider sequence numbers remain opaque strings; no migration compares or
-- rewrites them.

CREATE TABLE "EmailProviderConsumerLease" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "streamName" TEXT NOT NULL,
    "generation" BIGINT NOT NULL DEFAULT 0,
    "holderId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailProviderConsumerLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailProviderConsumerLease_provider_streamName_key"
    ON "EmailProviderConsumerLease"("provider", "streamName");

CREATE INDEX "EmailProviderConsumerLease_updatedAt_idx"
    ON "EmailProviderConsumerLease"("updatedAt");

ALTER TABLE "EmailProviderStreamCheckpoint"
    ADD COLUMN "revision" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "lastWriterGeneration" BIGINT,
    ADD COLUMN "lastWriterHolderId" TEXT;
