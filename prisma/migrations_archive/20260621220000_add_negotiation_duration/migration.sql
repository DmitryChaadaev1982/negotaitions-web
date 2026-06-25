-- AlterTable
ALTER TABLE "NegotiationCase" ADD COLUMN "negotiationDurationMinutes" INTEGER NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "negotiationDurationMinutes" INTEGER NOT NULL DEFAULT 15;
