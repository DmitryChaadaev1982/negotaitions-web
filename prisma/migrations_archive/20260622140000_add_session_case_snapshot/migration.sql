-- Add snapshot columns to Session (nullable during backfill)
ALTER TABLE "Session" ADD COLUMN "snapshotCaseTitle" TEXT;
ALTER TABLE "Session" ADD COLUMN "snapshotBusinessContext" TEXT;
ALTER TABLE "Session" ADD COLUMN "snapshotPublicInstructions" TEXT;
ALTER TABLE "Session" ADD COLUMN "snapshotCaseLanguage" "CaseLanguage";

-- Backfill snapshot from linked NegotiationCase
UPDATE "Session" AS s
SET
  "snapshotCaseTitle" = c."title",
  "snapshotBusinessContext" = c."businessContext",
  "snapshotPublicInstructions" = c."publicInstructions",
  "snapshotCaseLanguage" = c."caseLanguage"
FROM "NegotiationCase" AS c
WHERE s."negotiationCaseId" = c."id";

-- Create SessionRole table
CREATE TABLE "SessionRole" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "privateInstructions" TEXT NOT NULL,
    "objectives" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "hiddenInfo" TEXT NOT NULL,
    "fallbackPosition" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRole_pkey" PRIMARY KEY ("id")
);

-- Copy CaseRole rows into SessionRole for each existing session
INSERT INTO "SessionRole" (
    "id",
    "sessionId",
    "name",
    "privateInstructions",
    "objectives",
    "constraints",
    "hiddenInfo",
    "fallbackPosition",
    "sortOrder",
    "createdAt",
    "updatedAt"
)
SELECT
    md5(s."id" || ':' || cr."id"),
    s."id",
    cr."name",
    cr."privateInstructions",
    cr."objectives",
    cr."constraints",
    cr."hiddenInfo",
    cr."fallbackPosition",
    cr."sortOrder",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Session" AS s
JOIN "CaseRole" AS cr ON cr."negotiationCaseId" = s."negotiationCaseId";

CREATE INDEX "SessionRole_sessionId_idx" ON "SessionRole"("sessionId");

ALTER TABLE "SessionRole"
ADD CONSTRAINT "SessionRole_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Replace caseRoleId with sessionRoleId on SessionParticipant
ALTER TABLE "SessionParticipant" ADD COLUMN "sessionRoleId" TEXT;

UPDATE "SessionParticipant" AS sp
SET "sessionRoleId" = sr."id"
FROM "SessionRole" AS sr,
     "CaseRole" AS cr,
     "Session" AS s
WHERE sp."sessionId" = sr."sessionId"
  AND sp."sessionId" = s."id"
  AND sp."caseRoleId" = cr."id"
  AND sr."sortOrder" = cr."sortOrder"
  AND cr."negotiationCaseId" = s."negotiationCaseId";

DROP INDEX IF EXISTS "SessionParticipant_caseRoleId_idx";

ALTER TABLE "SessionParticipant" DROP CONSTRAINT IF EXISTS "SessionParticipant_caseRoleId_fkey";
ALTER TABLE "SessionParticipant" DROP COLUMN "caseRoleId";

CREATE INDEX "SessionParticipant_sessionRoleId_idx" ON "SessionParticipant"("sessionRoleId");

ALTER TABLE "SessionParticipant"
ADD CONSTRAINT "SessionParticipant_sessionRoleId_fkey"
FOREIGN KEY ("sessionRoleId") REFERENCES "SessionRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce NOT NULL on snapshot columns
ALTER TABLE "Session" ALTER COLUMN "snapshotCaseTitle" SET NOT NULL;
ALTER TABLE "Session" ALTER COLUMN "snapshotBusinessContext" SET NOT NULL;
ALTER TABLE "Session" ALTER COLUMN "snapshotPublicInstructions" SET NOT NULL;
ALTER TABLE "Session" ALTER COLUMN "snapshotCaseLanguage" SET NOT NULL;
