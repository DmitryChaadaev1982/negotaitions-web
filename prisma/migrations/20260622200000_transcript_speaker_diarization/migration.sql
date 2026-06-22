-- AlterTable
ALTER TABLE "Transcript" ADD COLUMN "diarizedText" TEXT,
ADD COLUMN "hasSpeakerDiarization" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "speakerMapping" JSONB;

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "mappedParticipantId" TEXT,
    "startSeconds" DOUBLE PRECISION,
    "endSeconds" DOUBLE PRECISION,
    "text" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranscriptSegment_transcriptId_idx" ON "TranscriptSegment"("transcriptId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_mappedParticipantId_idx" ON "TranscriptSegment"("mappedParticipantId");

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_mappedParticipantId_fkey" FOREIGN KEY ("mappedParticipantId") REFERENCES "SessionParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
