-- AlterTable
ALTER TABLE "SessionParticipant" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- Backfill lastSeenAt for participants who already joined
UPDATE "SessionParticipant"
SET "lastSeenAt" = "joinedAt"
WHERE "joinedAt" IS NOT NULL AND "lastSeenAt" IS NULL;
