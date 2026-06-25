-- Add per-event session room metadata.
ALTER TABLE "Session"
  ADD COLUMN "sequenceNumber" INTEGER,
  ADD COLUMN "roomLabel" TEXT,
  ADD COLUMN "createdFromEventAt" TIMESTAMP(3);

-- Existing event sessions are ordered by creation time inside each event.
WITH ordered_sessions AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "eventId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS sequence_number
  FROM "Session"
  WHERE "eventId" IS NOT NULL
)
UPDATE "Session"
SET
  "sequenceNumber" = ordered_sessions.sequence_number,
  "roomLabel" = COALESCE("Session"."roomLabel", 'Room ' || ordered_sessions.sequence_number),
  "createdFromEventAt" = COALESCE("Session"."createdFromEventAt", "Session"."createdAt")
FROM ordered_sessions
WHERE "Session"."id" = ordered_sessions."id";

-- Allow one EventParticipant to have many historical SessionParticipant rows.
ALTER TABLE "SessionParticipant"
  DROP CONSTRAINT IF EXISTS "SessionParticipant_eventParticipantId_key";

DROP INDEX IF EXISTS "SessionParticipant_eventParticipantId_key";

CREATE INDEX IF NOT EXISTS "SessionParticipant_eventParticipantId_idx"
  ON "SessionParticipant"("eventParticipantId");
