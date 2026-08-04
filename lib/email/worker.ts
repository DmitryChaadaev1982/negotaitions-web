import crypto from "node:crypto";

import {
  EmailDeliveryAttemptStatus,
  EmailMessageStatus,
  type Prisma,
} from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
import { logEmailConfigurationFailure, logEmailEvent, safeRecipient } from "@/lib/email/observability";
import { createEmailProvider } from "@/lib/email/provider";
import type { EmailProvider } from "@/lib/email/types";
import { prisma } from "@/lib/prisma";

const CLAIMABLE_STATUSES = [
  EmailMessageStatus.PENDING,
  EmailMessageStatus.FAILED_RETRYABLE,
] as const;

export type EmailDeliverySweepResult = {
  scanned: number;
  claimed: number;
  accepted: number;
  retryableFailures: number;
  finalFailures: number;
  skipped: number;
  recoveredStale: number;
  deliveryDisabled: boolean;
};

function toJsonValue(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  const json = JSON.stringify(value);
  if (json.length > 8192) {
    return { truncated: true };
  }
  return JSON.parse(json) as Prisma.InputJsonValue;
}

export function calculateRetryAt(
  attemptCount: number,
  now = new Date(),
  params = getEmailConfig(),
): Date {
  const exponent = Math.max(0, attemptCount - 1);
  const base = params.retryBaseSeconds * 1000;
  const max = params.retryMaxSeconds * 1000;
  const delay = Math.min(base * 2 ** exponent, max);
  const jitter = Math.floor(delay * 0.15 * ((attemptCount % 5) / 5));
  return new Date(now.getTime() + delay + jitter);
}

async function recoverStaleProcessing(now: Date, limit: number) {
  const stale = await prisma.emailMessage.findMany({
    where: {
      status: EmailMessageStatus.PROCESSING,
      claimExpiresAt: { lte: now },
    },
    orderBy: [{ claimExpiresAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const result = await prisma.emailMessage.updateMany({
    where: {
      id: { in: stale.map((message) => message.id) },
      status: EmailMessageStatus.PROCESSING,
      claimExpiresAt: { lte: now },
    },
    data: {
      status: EmailMessageStatus.FAILED_RETRYABLE,
      claimToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      processingAt: null,
      nextAttemptAt: now,
      lastErrorCode: "STALE_PROCESSING_RECOVERED",
      lastErrorMessage: "Stale processing lease recovered by email worker.",
    },
  });
  return result.count;
}

async function claimMessage(messageId: string, now: Date, leaseSeconds: number) {
  const claimToken = crypto.randomUUID();
  const claimExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
  const result = await prisma.emailMessage.updateMany({
    where: {
      id: messageId,
      status: { in: CLAIMABLE_STATUSES as unknown as EmailMessageStatus[] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: {
      status: EmailMessageStatus.PROCESSING,
      attemptCount: { increment: 1 },
      claimedAt: now,
      claimExpiresAt,
      claimToken,
      processingAt: now,
      nextAttemptAt: null,
    },
  });
  if (result.count === 0) return null;
  return prisma.emailMessage.findUnique({
    where: { id: messageId },
  });
}

export async function runEmailDeliverySweep(params?: {
  provider?: EmailProvider;
  limit?: number;
}): Promise<EmailDeliverySweepResult> {
  const config = getEmailConfig();
  const limit = Math.max(1, Math.min(params?.limit ?? config.workerBatchSize, 500));
  if (!config.deliveryEnabled) {
    logEmailEvent("info", "delivery_disabled", { provider: config.provider, limit });
    return {
      scanned: 0,
      claimed: 0,
      accepted: 0,
      retryableFailures: 0,
      finalFailures: 0,
      skipped: 0,
      recoveredStale: 0,
      deliveryDisabled: true,
    };
  }

  const provider = params?.provider ?? createEmailProvider();
  const now = new Date();
  const recoveredStale = await recoverStaleProcessing(now, limit);
  const candidates = await prisma.emailMessage.findMany({
    where: {
      status: { in: CLAIMABLE_STATUSES as unknown as EmailMessageStatus[] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });

  let claimed = 0;
  let accepted = 0;
  let retryableFailures = 0;
  let finalFailures = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const claimedMessage = await claimMessage(
      candidate.id,
      new Date(),
      config.processingLeaseSeconds,
    );
    if (!claimedMessage) {
      skipped += 1;
      continue;
    }
    claimed += 1;

    const attemptNumber = claimedMessage.attemptCount;
    const attempt = await prisma.emailDeliveryAttempt.create({
      data: {
        emailMessageId: claimedMessage.id,
        attemptNumber,
        provider: provider.name,
        transport: provider.transport,
      },
    });

    try {
      if (
        !claimedMessage.recipientEmail ||
        !claimedMessage.renderedSubject ||
        !claimedMessage.renderedTextBody ||
        !claimedMessage.renderedHtmlBody
      ) {
        throw new Error("Email message content was already retained/minimized.");
      }

      const result = await provider.send({
        id: claimedMessage.id,
        recipientEmail: claimedMessage.recipientEmail,
        fromAddress: claimedMessage.fromAddress,
        replyToAddress: claimedMessage.replyToAddress,
        subject: claimedMessage.renderedSubject,
        textBody: claimedMessage.renderedTextBody,
        htmlBody: claimedMessage.renderedHtmlBody,
        idempotencyKey: claimedMessage.idempotencyKey,
      });

      if (result.ok) {
        await prisma.$transaction([
          prisma.emailDeliveryAttempt.update({
            where: { id: attempt.id },
            data: {
              status: EmailDeliveryAttemptStatus.ACCEPTED,
              providerMessageId: result.providerMessageId,
              completedAt: result.acceptedAt,
              providerMetadata: toJsonValue(result.metadata),
            },
          }),
          prisma.emailMessage.update({
            where: { id: claimedMessage.id },
            data: {
              status: EmailMessageStatus.ACCEPTED_BY_PROVIDER,
              providerName: result.providerName,
              lastProviderMessageId: result.providerMessageId,
              sentAt: result.acceptedAt,
              claimToken: null,
              claimedAt: null,
              claimExpiresAt: null,
              processingAt: null,
              lastErrorCode: null,
              lastErrorMessage: null,
            },
          }),
        ]);
        accepted += 1;
        logEmailEvent("info", "accepted_by_provider", {
          messageId: claimedMessage.id,
          attemptNumber,
          provider: result.providerName,
        });
        continue;
      }

      const maxAttemptsReached = attemptNumber >= config.maxAttempts;
      const retryable = result.retryable && !maxAttemptsReached;
      const nextAttemptAt = retryable ? calculateRetryAt(attemptNumber) : null;
      await prisma.$transaction([
        prisma.emailDeliveryAttempt.update({
          where: { id: attempt.id },
          data: {
            status: result.timeoutUnknown
              ? EmailDeliveryAttemptStatus.TIMEOUT_UNKNOWN
              : retryable
                ? EmailDeliveryAttemptStatus.RETRYABLE_FAILURE
                : result.errorCode === "EMAIL_DELIVERY_DISABLED"
                  ? EmailDeliveryAttemptStatus.CONFIGURATION_ERROR
                  : EmailDeliveryAttemptStatus.FINAL_FAILURE,
            retryable,
            normalizedErrorCode: result.errorCode,
            sanitizedErrorMessage: result.sanitizedMessage,
            completedAt: new Date(),
            providerMetadata: toJsonValue(result.metadata),
          },
        }),
        prisma.emailMessage.update({
          where: { id: claimedMessage.id },
          data: {
            status: retryable
              ? EmailMessageStatus.FAILED_RETRYABLE
              : EmailMessageStatus.FAILED_FINAL,
            terminalFailureAt: retryable ? null : new Date(),
            nextAttemptAt,
            claimToken: null,
            claimedAt: null,
            claimExpiresAt: null,
            processingAt: null,
            lastErrorCode: result.errorCode,
            lastErrorMessage: result.sanitizedMessage,
          },
        }),
      ]);
      if (retryable) {
        retryableFailures += 1;
      } else {
        finalFailures += 1;
        if (result.errorCode === "EMAIL_DELIVERY_DISABLED") {
          await logEmailConfigurationFailure(result.sanitizedMessage, claimedMessage.id);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : "Email worker failed.";
      const retryable = attemptNumber < config.maxAttempts;
      await prisma.$transaction([
        prisma.emailDeliveryAttempt.update({
          where: { id: attempt.id },
          data: {
            status: retryable
              ? EmailDeliveryAttemptStatus.RETRYABLE_FAILURE
              : EmailDeliveryAttemptStatus.FINAL_FAILURE,
            retryable,
            normalizedErrorCode: "WORKER_EXCEPTION",
            sanitizedErrorMessage: message,
            completedAt: new Date(),
          },
        }),
        prisma.emailMessage.update({
          where: { id: claimedMessage.id },
          data: {
            status: retryable
              ? EmailMessageStatus.FAILED_RETRYABLE
              : EmailMessageStatus.FAILED_FINAL,
            terminalFailureAt: retryable ? null : new Date(),
            nextAttemptAt: retryable ? calculateRetryAt(attemptNumber) : null,
            claimToken: null,
            claimedAt: null,
            claimExpiresAt: null,
            processingAt: null,
            lastErrorCode: "WORKER_EXCEPTION",
            lastErrorMessage: message,
          },
        }),
      ]);
      logEmailEvent("error", "delivery_attempt_failed", {
        messageId: claimedMessage.id,
        attemptNumber,
        recipient: safeRecipient(claimedMessage.recipientEmail),
        errorCode: "WORKER_EXCEPTION",
      });
      if (retryable) retryableFailures += 1;
      else finalFailures += 1;
    }
  }

  return {
    scanned: candidates.length,
    claimed,
    accepted,
    retryableFailures,
    finalFailures,
    skipped,
    recoveredStale,
    deliveryDisabled: false,
  };
}
