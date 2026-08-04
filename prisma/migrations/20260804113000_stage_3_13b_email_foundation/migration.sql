-- CreateEnum
CREATE TYPE "EmailMessageType" AS ENUM (
    'SYSTEM_TEST',
    'PASSWORD_RESET',
    'ACCOUNT_RECOVERY_DENIED',
    'PASSWORD_CHANGED',
    'EVENT_INVITATION',
    'SESSION_INVITATION',
    'ADMIN_PENDING_APPROVAL'
);

-- CreateEnum
CREATE TYPE "EmailMessageCategory" AS ENUM (
    'ADMIN_TEST',
    'SECURITY',
    'TRANSACTIONAL',
    'INVITATION',
    'PRODUCT',
    'MARKETING'
);

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'ACCEPTED_BY_PROVIDER',
    'DELIVERED',
    'DELAYED',
    'BOUNCED',
    'COMPLAINED',
    'SUPPRESSED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL',
    'CANCELLED'
);

-- CreateEnum
CREATE TYPE "EmailDeliveryAttemptStatus" AS ENUM (
    'STARTED',
    'ACCEPTED',
    'RETRYABLE_FAILURE',
    'FINAL_FAILURE',
    'TIMEOUT_UNKNOWN',
    'CONFIGURATION_ERROR'
);

-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM (
    'HARD_BOUNCE',
    'COMPLAINT',
    'MANUAL',
    'UNSUBSCRIBE',
    'TEMPORARY'
);

-- CreateEnum
CREATE TYPE "EmailSuppressionSource" AS ENUM (
    'PROVIDER_EVENT',
    'ADMIN',
    'SYSTEM'
);

-- CreateEnum
CREATE TYPE "EmailProviderEventType" AS ENUM (
    'ACCEPTED',
    'DELIVERED',
    'DELAYED',
    'BOUNCED',
    'COMPLAINED',
    'REJECTED',
    'RENDERING_FAILED',
    'UNKNOWN'
);

-- CreateEnum
CREATE TYPE "EmailProviderEventProcessingStatus" AS ENUM (
    'PENDING',
    'PROCESSED',
    'IGNORED',
    'FAILED'
);

-- AlterEnum
ALTER TYPE "ExternalService" ADD VALUE IF NOT EXISTS 'EMAIL';

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "messageType" "EmailMessageType" NOT NULL,
    "category" "EmailMessageCategory" NOT NULL,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "recipientEmail" TEXT,
    "recipientEmailNormalized" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "replyToAddress" TEXT,
    "locale" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "renderedSubject" TEXT,
    "renderedTextBody" TEXT,
    "renderedHtmlBody" TEXT,
    "metadata" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "processingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "terminalFailureAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "contentClearedAt" TIMESTAMP(3),
    "providerMessageIdClearedAt" TIMESTAMP(3),
    "lastProviderMessageId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "status" "EmailDeliveryAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "providerMessageId" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "normalizedErrorCode" TEXT,
    "sanitizedErrorMessage" TEXT,
    "providerMetadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "providerMessageIdClearedAt" TIMESTAMP(3),
    "minimizedAt" TIMESTAMP(3),

    CONSTRAINT "EmailDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "recipientEmailNormalized" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "source" "EmailSuppressionSource" NOT NULL,
    "categoryScope" "EmailMessageCategory",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),
    "liftedByUserId" TEXT,
    "liftReason" TEXT,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "emailMessageId" TEXT,
    "eventType" "EmailProviderEventType" NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "processingStatus" "EmailProviderEventProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "processedAt" TIMESTAMP(3),
    "retainedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_idempotencyKey_key" ON "EmailMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailMessage_status_nextAttemptAt_createdAt_idx" ON "EmailMessage"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_recipientEmailNormalized_idx" ON "EmailMessage"("recipientEmailNormalized");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_idx" ON "EmailMessage"("userId");

-- CreateIndex
CREATE INDEX "EmailMessage_lastProviderMessageId_idx" ON "EmailMessage"("lastProviderMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_claimExpiresAt_idx" ON "EmailMessage"("claimExpiresAt");

-- CreateIndex
CREATE INDEX "EmailMessage_createdAt_idx" ON "EmailMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDeliveryAttempt_emailMessageId_attemptNumber_key" ON "EmailDeliveryAttempt"("emailMessageId", "attemptNumber");

-- CreateIndex
CREATE INDEX "EmailDeliveryAttempt_providerMessageId_idx" ON "EmailDeliveryAttempt"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailDeliveryAttempt_startedAt_idx" ON "EmailDeliveryAttempt"("startedAt");

-- CreateIndex
CREATE INDEX "EmailDeliveryAttempt_status_idx" ON "EmailDeliveryAttempt"("status");

-- CreateIndex
CREATE INDEX "EmailSuppression_recipientEmailNormalized_active_idx" ON "EmailSuppression"("recipientEmailNormalized", "active");

-- CreateIndex
CREATE INDEX "EmailSuppression_reason_idx" ON "EmailSuppression"("reason");

-- CreateIndex
CREATE INDEX "EmailSuppression_expiresAt_idx" ON "EmailSuppression"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailSuppression_liftedByUserId_idx" ON "EmailSuppression"("liftedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailProviderEvent_provider_providerEventId_key" ON "EmailProviderEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "EmailProviderEvent_providerMessageId_idx" ON "EmailProviderEvent"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailProviderEvent_emailMessageId_idx" ON "EmailProviderEvent"("emailMessageId");

-- CreateIndex
CREATE INDEX "EmailProviderEvent_eventType_eventTime_idx" ON "EmailProviderEvent"("eventType", "eventTime");

-- CreateIndex
CREATE INDEX "EmailProviderEvent_processingStatus_createdAt_idx" ON "EmailProviderEvent"("processingStatus", "createdAt");

-- CreateIndex
CREATE INDEX "EmailProviderEvent_retainedUntil_idx" ON "EmailProviderEvent"("retainedUntil");

-- AddForeignKey
ALTER TABLE "EmailMessage"
ADD CONSTRAINT "EmailMessage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryAttempt"
ADD CONSTRAINT "EmailDeliveryAttempt_emailMessageId_fkey"
FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSuppression"
ADD CONSTRAINT "EmailSuppression_liftedByUserId_fkey"
FOREIGN KEY ("liftedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
