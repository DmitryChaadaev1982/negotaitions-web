-- Phase 3: user binding ownership foundation.
ALTER TABLE "TrainingEvent"
ADD COLUMN "hostUserId" TEXT;

ALTER TABLE "EventParticipant"
ADD COLUMN "userId" TEXT;

ALTER TABLE "TrainingEvent"
ADD CONSTRAINT "TrainingEvent_hostUserId_fkey"
FOREIGN KEY ("hostUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventParticipant"
ADD CONSTRAINT "EventParticipant_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "TrainingEvent_hostUserId_idx" ON "TrainingEvent"("hostUserId");
CREATE INDEX "EventParticipant_userId_idx" ON "EventParticipant"("userId");
CREATE INDEX "EventParticipant_eventId_userId_idx" ON "EventParticipant"("eventId", "userId");
CREATE INDEX "SessionParticipant_sessionId_userId_idx" ON "SessionParticipant"("sessionId", "userId");
