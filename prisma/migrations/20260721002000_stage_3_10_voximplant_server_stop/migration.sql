-- AlterTable
ALTER TABLE "SessionRecordingStopOperation"
ADD COLUMN "transportAcceptedAt" TIMESTAMP(3),
ADD COLUMN "commandAcceptedAt" TIMESTAMP(3),
ADD COLUMN "providerTerminalAt" TIMESTAMP(3),
ADD COLUMN "providerTerminalStatus" TEXT,
ADD COLUMN "providerFailureCode" TEXT,
ADD COLUMN "providerFailureMessage" TEXT,
ADD COLUMN "providerSessionIdAtCommand" TEXT,
ADD COLUMN "providerConferenceNameAtCommand" TEXT;

-- CreateTable
CREATE TABLE "SessionVoximplantControlChannel" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "conferenceName" TEXT NOT NULL,
    "controlUrl" TEXT NOT NULL,
    "controlUrlFingerprint" TEXT NOT NULL,
    "scenarioBuild" TEXT,
    "scenarioSource" TEXT,
    "ruleIdentity" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionVoximplantControlChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoximplantCallbackNonce" (
    "id" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "operationId" TEXT,
    "providerSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoximplantCallbackNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionVoximplantControlChannel_sessionId_key"
ON "SessionVoximplantControlChannel"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionVoximplantControlChannel_providerSessionId_key"
ON "SessionVoximplantControlChannel"("providerSessionId");

-- CreateIndex
CREATE INDEX "SessionVoximplantControlChannel_conferenceName_idx"
ON "SessionVoximplantControlChannel"("conferenceName");

-- CreateIndex
CREATE UNIQUE INDEX "VoximplantCallbackNonce_nonceHash_key"
ON "VoximplantCallbackNonce"("nonceHash");

-- CreateIndex
CREATE INDEX "VoximplantCallbackNonce_expiresAt_idx"
ON "VoximplantCallbackNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "VoximplantCallbackNonce_sessionId_createdAt_idx"
ON "VoximplantCallbackNonce"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "SessionVoximplantControlChannel"
ADD CONSTRAINT "SessionVoximplantControlChannel_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
