-- AlterEnum
ALTER TYPE "RecordingStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "RecordingStatus" ADD VALUE IF NOT EXISTS 'STOPPED';

-- CreateEnum
CREATE TYPE "RecordingType" AS ENUM ('AUDIO_ONLY', 'VIDEO_COMPOSITE');
CREATE TYPE "CompressionStatus" AS ENUM ('NOT_STARTED', 'COMPRESSING', 'COMPLETED', 'FAILED', 'SKIPPED');
CREATE TYPE "ExternalService" AS ENUM ('LIVEKIT', 'OPENAI', 'YANDEX_OBJECT_STORAGE', 'FFMPEG', 'APP');
CREATE TYPE "ExternalServiceEventSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "ExternalServiceErrorCode" AS ENUM (
  'AUTH_ERROR',
  'PERMISSION_DENIED',
  'QUOTA_EXCEEDED',
  'BILLING_LIMIT',
  'RATE_LIMIT',
  'CONFIG_MISSING',
  'NETWORK_ERROR',
  'STORAGE_UPLOAD_FAILED',
  'STORAGE_DOWNLOAD_FAILED',
  'STORAGE_OBJECT_NOT_FOUND',
  'RECORDING_START_FAILED',
  'RECORDING_STOP_FAILED',
  'RECORDING_STATUS_FAILED',
  'TRANSCRIPTION_FAILED',
  'TRANSCRIPTION_FILE_TOO_LARGE',
  'COMPRESSION_FAILED',
  'FFMPEG_MISSING',
  'UNKNOWN'
);

-- AlterTable Recording
ALTER TABLE "Recording"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'LIVEKIT_CLOUD',
  ADD COLUMN IF NOT EXISTS "egressId" TEXT,
  ADD COLUMN IF NOT EXISTS "recordingType" "RecordingType" NOT NULL DEFAULT 'AUDIO_ONLY',
  ADD COLUMN IF NOT EXISTS "fileUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "fileKey" TEXT,
  ADD COLUMN IF NOT EXISTS "fileName" TEXT,
  ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "originalSizeBytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "compressedFileKey" TEXT,
  ADD COLUMN IF NOT EXISTS "compressedFileName" TEXT,
  ADD COLUMN IF NOT EXISTS "compressedMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "compressedSizeBytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "compressionStatus" "CompressionStatus",
  ADD COLUMN IF NOT EXISTS "compressionError" TEXT,
  ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;

UPDATE "Recording"
SET "fileKey" = "storagePath"
WHERE "fileKey" IS NULL AND "storagePath" IS NOT NULL;

ALTER TABLE "Recording" DROP COLUMN IF EXISTS "storagePath";
ALTER TABLE "Recording" DROP COLUMN IF EXISTS "durationSeconds";

-- AlterTable Transcript
ALTER TABLE "Transcript"
  ADD COLUMN IF NOT EXISTS "text" TEXT,
  ADD COLUMN IF NOT EXISTS "language" TEXT,
  ADD COLUMN IF NOT EXISTS "originalFileName" TEXT,
  ADD COLUMN IF NOT EXISTS "originalMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "transcriptionModel" TEXT;

UPDATE "Transcript"
SET "text" = "content"
WHERE "text" IS NULL;

ALTER TABLE "Transcript" DROP COLUMN IF EXISTS "content";
ALTER TABLE "Transcript" ALTER COLUMN "text" SET NOT NULL;

-- CreateTable
CREATE TABLE "ExternalServiceEvent" (
    "id" TEXT NOT NULL,
    "service" "ExternalService" NOT NULL,
    "severity" "ExternalServiceEventSeverity" NOT NULL,
    "errorCode" "ExternalServiceErrorCode",
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawError" JSONB,
    "sessionId" TEXT,
    "recordingId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalServiceEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "service" "ExternalService" NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalServiceEvent_service_idx" ON "ExternalServiceEvent"("service");
CREATE INDEX "ExternalServiceEvent_severity_idx" ON "ExternalServiceEvent"("severity");
CREATE INDEX "ExternalServiceEvent_sessionId_idx" ON "ExternalServiceEvent"("sessionId");
CREATE INDEX "ExternalServiceEvent_createdAt_idx" ON "ExternalServiceEvent"("createdAt");
CREATE INDEX "UsageCounter_service_metric_periodStart_idx" ON "UsageCounter"("service", "metric", "periodStart");
