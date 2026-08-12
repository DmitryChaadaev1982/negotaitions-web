ALTER TABLE "Recording"
ADD COLUMN "recordingAttemptId" TEXT;

CREATE UNIQUE INDEX "Recording_recordingAttemptId_key"
ON "Recording"("recordingAttemptId");
