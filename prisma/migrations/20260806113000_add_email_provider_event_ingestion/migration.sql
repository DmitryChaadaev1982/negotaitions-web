CREATE TYPE "EmailProviderIngestionFailureStatus" AS ENUM ('RECORDED', 'RESOLVED', 'IGNORED');

CREATE TABLE "EmailProviderStreamCheckpoint" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "streamName" TEXT NOT NULL,
  "shardId" TEXT NOT NULL,
  "lastSuccessfullyHandledSequenceNumber" TEXT,
  "approximateArrivalTimestamp" TIMESTAMP(3),
  "lastProcessedProviderEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailProviderStreamCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailProviderIngestionFailure" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "streamName" TEXT NOT NULL,
  "shardId" TEXT NOT NULL,
  "sequenceNumber" TEXT NOT NULL,
  "approximateArrivalTimestamp" TIMESTAMP(3),
  "payloadSha256" TEXT NOT NULL,
  "errorCode" TEXT NOT NULL,
  "sanitizedErrorMessage" TEXT NOT NULL,
  "status" "EmailProviderIngestionFailureStatus" NOT NULL DEFAULT 'RECORDED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailProviderIngestionFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailProviderStreamCheckpoint_provider_streamName_shardId_key"
  ON "EmailProviderStreamCheckpoint"("provider", "streamName", "shardId");

CREATE INDEX "EmailProviderStreamCheckpoint_provider_streamName_idx"
  ON "EmailProviderStreamCheckpoint"("provider", "streamName");

CREATE INDEX "EmailProviderStreamCheckpoint_updatedAt_idx"
  ON "EmailProviderStreamCheckpoint"("updatedAt");

CREATE UNIQUE INDEX "EmailProviderIngestionFailure_provider_streamName_shardId_sequenceNumber_key"
  ON "EmailProviderIngestionFailure"("provider", "streamName", "shardId", "sequenceNumber");

CREATE INDEX "EmailProviderIngestionFailure_payloadSha256_idx"
  ON "EmailProviderIngestionFailure"("payloadSha256");

CREATE INDEX "EmailProviderIngestionFailure_status_createdAt_idx"
  ON "EmailProviderIngestionFailure"("status", "createdAt");
