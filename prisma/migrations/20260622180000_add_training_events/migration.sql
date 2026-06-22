-- CreateEnum
CREATE TYPE "TrainingEventStatus" AS ENUM ('DRAFT', 'LOBBY_OPEN', 'SESSION_CREATED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventParticipantPreference" AS ENUM ('UNDECIDED', 'PLAY', 'OBSERVE', 'FACILITATE');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "eventId" TEXT;

-- CreateTable
CREATE TABLE "TrainingEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" "TrainingEventStatus" NOT NULL DEFAULT 'LOBBY_OPEN',
    "publicJoinCode" TEXT NOT NULL,
    "hostToken" TEXT NOT NULL,
    "lobbyRoomName" TEXT,
    "selectedCaseId" TEXT,
    "defaultDurationSeconds" INTEGER NOT NULL DEFAULT 900,
    "assignmentDraft" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "participantToken" TEXT NOT NULL,
    "preference" "EventParticipantPreference" NOT NULL DEFAULT 'UNDECIDED',
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "wantsToPlay" BOOLEAN NOT NULL DEFAULT false,
    "wantsToObserve" BOOLEAN NOT NULL DEFAULT false,
    "wantsToFacilitate" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "assignedSessionId" TEXT,
    "assignedSessionParticipantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SessionParticipant" ADD COLUMN "eventParticipantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEvent_publicJoinCode_key" ON "TrainingEvent"("publicJoinCode");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEvent_hostToken_key" ON "TrainingEvent"("hostToken");

-- CreateIndex
CREATE INDEX "TrainingEvent_selectedCaseId_idx" ON "TrainingEvent"("selectedCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_participantToken_key" ON "EventParticipant"("participantToken");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_assignedSessionParticipantId_key" ON "EventParticipant"("assignedSessionParticipantId");

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_idx" ON "EventParticipant"("eventId");

-- CreateIndex
CREATE INDEX "EventParticipant_assignedSessionId_idx" ON "EventParticipant"("assignedSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_eventParticipantId_key" ON "SessionParticipant"("eventParticipantId");

-- CreateIndex
CREATE INDEX "Session_eventId_idx" ON "Session"("eventId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TrainingEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_eventParticipantId_fkey" FOREIGN KEY ("eventParticipantId") REFERENCES "EventParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEvent" ADD CONSTRAINT "TrainingEvent_selectedCaseId_fkey" FOREIGN KEY ("selectedCaseId") REFERENCES "NegotiationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TrainingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_assignedSessionId_fkey" FOREIGN KEY ("assignedSessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_assignedSessionParticipantId_fkey" FOREIGN KEY ("assignedSessionParticipantId") REFERENCES "SessionParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
