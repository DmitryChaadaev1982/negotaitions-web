-- Add durable Yandex Responses API ID for accepted background AI analysis generations.
ALTER TABLE "AiAnalysis" ADD COLUMN "providerResponseId" TEXT;
