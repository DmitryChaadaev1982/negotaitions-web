-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "closedByEventAt" TIMESTAMP(3),
ADD COLUMN "closedByEventId" TEXT,
ADD COLUMN "closeReason" TEXT;

-- AlterTable
ALTER TABLE "TrainingEvent" ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "completedBy" TEXT,
ADD COLUMN "completionReason" TEXT,
ADD COLUMN "endedMessage" TEXT;
