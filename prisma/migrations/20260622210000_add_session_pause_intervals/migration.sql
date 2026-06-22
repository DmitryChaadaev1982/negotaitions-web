-- CreateTable
CREATE TABLE "SessionPauseInterval" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionPauseInterval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionPauseInterval_sessionId_idx" ON "SessionPauseInterval"("sessionId");

-- AddForeignKey
ALTER TABLE "SessionPauseInterval" ADD CONSTRAINT "SessionPauseInterval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
