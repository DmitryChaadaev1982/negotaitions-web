-- CreateEnum
CREATE TYPE "RoomLifecycle" AS ENUM ('OPEN', 'DEBRIEF_OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Session"
ADD COLUMN "roomLifecycle" "RoomLifecycle";

-- CreateTable
CREATE TABLE "SessionRoomConnection" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "leaseVersion" INTEGER NOT NULL DEFAULT 1,
    "role" "ParticipantType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "disconnectedAt" TIMESTAMP(3),
    "disconnectedReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByConnectionId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRoomConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRecordingStopOperation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestedByMode" TEXT NOT NULL,
    "requestReason" TEXT,
    "operationId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorClass" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "lastDeliveryTransport" TEXT,
    "fallbackPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRecordingStopOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionRoomConnection_connectionId_key" ON "SessionRoomConnection"("connectionId");

-- CreateIndex
CREATE INDEX "Session_roomLifecycle_idx" ON "Session"("roomLifecycle");

-- CreateIndex
CREATE INDEX "SessionRoomConnection_sessionId_idx" ON "SessionRoomConnection"("sessionId");

-- CreateIndex
CREATE INDEX "SessionRoomConnection_sessionId_disconnectedAt_idx" ON "SessionRoomConnection"("sessionId", "disconnectedAt");

-- CreateIndex
CREATE INDEX "SessionRoomConnection_sessionId_expiresAt_idx" ON "SessionRoomConnection"("sessionId", "expiresAt");

-- CreateIndex
CREATE INDEX "SessionRoomConnection_expiresAt_idx" ON "SessionRoomConnection"("expiresAt");

-- CreateIndex
CREATE INDEX "SessionRoomConnection_sessionId_role_disconnectedAt_supersededAt_revokedAt_expiresAt_idx"
ON "SessionRoomConnection"("sessionId", "role", "disconnectedAt", "supersededAt", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "SessionRoomConnection_sessionId_userId_idx" ON "SessionRoomConnection"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "SessionRoomConnection_sessionId_userId_disconnectedAt_supersededAt_revokedAt_expiresAt_idx"
ON "SessionRoomConnection"("sessionId", "userId", "disconnectedAt", "supersededAt", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRoomConnection_single_active_per_user_idx"
ON "SessionRoomConnection"("sessionId", "userId")
WHERE "disconnectedAt" IS NULL AND "supersededAt" IS NULL AND "revokedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecordingStopOperation_recordingId_key"
ON "SessionRecordingStopOperation"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecordingStopOperation_operationId_key"
ON "SessionRecordingStopOperation"("operationId");

-- CreateIndex
CREATE INDEX "SessionRecordingStopOperation_sessionId_idx"
ON "SessionRecordingStopOperation"("sessionId");

-- CreateIndex
CREATE INDEX "SessionRecordingStopOperation_state_updatedAt_idx"
ON "SessionRecordingStopOperation"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "SessionRecordingStopOperation_state_nextRetryAt_idx"
ON "SessionRecordingStopOperation"("state", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "SessionRoomConnection"
ADD CONSTRAINT "SessionRoomConnection_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRoomConnection"
ADD CONSTRAINT "SessionRoomConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRecordingStopOperation"
ADD CONSTRAINT "SessionRecordingStopOperation_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRecordingStopOperation"
ADD CONSTRAINT "SessionRecordingStopOperation_recordingId_fkey"
FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
