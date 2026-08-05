-- Stage 3.13C-R security remediation.
-- Additive only: credential generation for linearizable password mutations,
-- encrypted sensitive email payloads (no durable plaintext reset tokens),
-- and related-token association for stale-reset cancellation.

ALTER TABLE "User"
ADD COLUMN "credentialGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "EmailMessage"
ADD COLUMN "sensitivePayloadCiphertext" TEXT,
ADD COLUMN "sensitivePayloadNonce" TEXT,
ADD COLUMN "sensitivePayloadClearedAt" TIMESTAMP(3),
ADD COLUMN "relatedTokenId" TEXT;

CREATE INDEX "EmailMessage_relatedTokenId_idx"
ON "EmailMessage"("relatedTokenId");

CREATE INDEX "EmailMessage_sensitivePayloadClearedAt_idx"
ON "EmailMessage"("sensitivePayloadClearedAt");

CREATE INDEX "User_credentialGeneration_idx"
ON "User"("credentialGeneration");
