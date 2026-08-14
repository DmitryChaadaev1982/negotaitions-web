-- Durable, role-bound publication snapshots for participant and observer AI
-- delivery. Existing shared rows deliberately receive no inferred grants:
-- historical publication-time presence was never persisted, so backfilling it
-- would risk granting late joiners or observers access they did not earn.

CREATE TYPE "AiAnalysisPublicationProjection" AS ENUM ('PARTICIPANT', 'OBSERVER');

ALTER TABLE "AiAnalysis"
    ADD COLUMN "analysisVersion" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "publicationEpoch" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AiAnalysisPublication" (
    "id" TEXT NOT NULL,
    "aiAnalysisId" TEXT NOT NULL,
    "analysisVersion" INTEGER NOT NULL,
    "publicationEpoch" INTEGER NOT NULL,
    "sharedAnalysisJson" JSONB,
    "sharedExecutiveSummary" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "publishedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAnalysisPublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAnalysisPublicationGrant" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "sessionParticipantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projection" "AiAnalysisPublicationProjection" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAnalysisPublicationGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiAnalysisPublication_aiAnalysisId_publicationEpoch_key"
    ON "AiAnalysisPublication"("aiAnalysisId", "publicationEpoch");
CREATE INDEX "AiAnalysisPublication_aiAnalysisId_revokedAt_idx"
    ON "AiAnalysisPublication"("aiAnalysisId", "revokedAt");
CREATE INDEX "AiAnalysisPublication_aiAnalysisId_analysisVersion_revokedAt_idx"
    ON "AiAnalysisPublication"("aiAnalysisId", "analysisVersion", "revokedAt");

CREATE UNIQUE INDEX "AiAnalysisPublicationGrant_publicationId_sessionParticipantId_key"
    ON "AiAnalysisPublicationGrant"("publicationId", "sessionParticipantId");
CREATE INDEX "AiAnalysisPublicationGrant_sessionParticipantId_userId_revokedAt_idx"
    ON "AiAnalysisPublicationGrant"("sessionParticipantId", "userId", "revokedAt");
CREATE INDEX "AiAnalysisPublicationGrant_publicationId_revokedAt_idx"
    ON "AiAnalysisPublicationGrant"("publicationId", "revokedAt");

ALTER TABLE "AiAnalysisPublication"
    ADD CONSTRAINT "AiAnalysisPublication_aiAnalysisId_fkey"
    FOREIGN KEY ("aiAnalysisId") REFERENCES "AiAnalysis"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiAnalysisPublicationGrant"
    ADD CONSTRAINT "AiAnalysisPublicationGrant_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES "AiAnalysisPublication"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiAnalysisPublicationGrant"
    ADD CONSTRAINT "AiAnalysisPublicationGrant_sessionParticipantId_fkey"
    FOREIGN KEY ("sessionParticipantId") REFERENCES "SessionParticipant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiAnalysisPublicationGrant"
    ADD CONSTRAINT "AiAnalysisPublicationGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
