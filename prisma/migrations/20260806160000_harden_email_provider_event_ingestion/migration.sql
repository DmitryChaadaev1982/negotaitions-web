-- Additive Stage 3.13C remediation migration.
-- No column is dropped, renamed, repurposed, or given a destructive default.
-- Every new column is nullable so the previous runtime keeps working unchanged.

CREATE TYPE "EmailProviderEventSuppressionDisposition" AS ENUM ('NONE', 'HARD_BOUNCE', 'COMPLAINT');

-- Durable suppression decision reviewed at parse time (F-03).
-- NULL means "decided before this migration"; reconciliation must not
-- reconstruct a permanent suppression from eventType alone.
ALTER TABLE "EmailProviderEvent"
  ADD COLUMN "suppressionDisposition" "EmailProviderEventSuppressionDisposition";

-- Durable initial-read boundary for LATEST shards (F-16).
-- Not a processed-record checkpoint: it only bounds iterator reacquisition.
ALTER TABLE "EmailProviderStreamCheckpoint"
  ADD COLUMN "initialReadAt" TIMESTAMP(3);

-- Supports the fair round-robin scheduler loading every shard checkpoint for a
-- stream in one indexed read per round.
CREATE INDEX "EmailProviderStreamCheckpoint_streamName_shardId_idx"
  ON "EmailProviderStreamCheckpoint"("streamName", "shardId");

-- Supports poison-record triage per shard without scanning the whole ledger.
CREATE INDEX "EmailProviderIngestionFailure_provider_streamName_shardId_idx"
  ON "EmailProviderIngestionFailure"("provider", "streamName", "shardId");
