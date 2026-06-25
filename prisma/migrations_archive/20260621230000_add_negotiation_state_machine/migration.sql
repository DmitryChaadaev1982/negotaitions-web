-- CreateEnum
CREATE TYPE "NegotiationState" AS ENUM ('LOBBY', 'RUNNING', 'PAUSED', 'FINISHED');

-- NegotiationCase: minutes -> defaultDurationSeconds
ALTER TABLE "NegotiationCase" ADD COLUMN "defaultDurationSeconds" INTEGER;

UPDATE "NegotiationCase"
SET "defaultDurationSeconds" = COALESCE("negotiationDurationMinutes", 15) * 60;

ALTER TABLE "NegotiationCase" ALTER COLUMN "defaultDurationSeconds" SET NOT NULL;
ALTER TABLE "NegotiationCase" ALTER COLUMN "defaultDurationSeconds" SET DEFAULT 900;

ALTER TABLE "NegotiationCase" DROP COLUMN "negotiationDurationMinutes";

-- Session: add negotiation state machine fields
ALTER TABLE "Session" ADD COLUMN "negotiationState" "NegotiationState" NOT NULL DEFAULT 'LOBBY';
ALTER TABLE "Session" ADD COLUMN "durationSeconds" INTEGER;
ALTER TABLE "Session" ADD COLUMN "negotiationStartedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "negotiationEndedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "timerStartedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "totalPausedSeconds" INTEGER NOT NULL DEFAULT 0;

UPDATE "Session"
SET "durationSeconds" = COALESCE("negotiationDurationMinutes", 15) * 60;

ALTER TABLE "Session" ALTER COLUMN "durationSeconds" SET NOT NULL;

ALTER TABLE "Session" DROP COLUMN "negotiationDurationMinutes";
