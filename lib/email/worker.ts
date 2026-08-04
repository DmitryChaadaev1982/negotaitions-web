import crypto from "node:crypto";

import {
  EmailDeliveryAttemptStatus,
  EmailMessageStatus,
  type EmailDeliveryAttempt,
  type Prisma,
} from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
import { logEmailConfigurationFailure, logEmailEvent, safeRecipient } from "@/lib/email/observability";
import { createEmailProvider } from "@/lib/email/provider";
import { evaluateSuppression } from "@/lib/email/suppression";
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
  acceptanceUnknown: number;
  suppressed: number;
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

async function markClaimLost(messageId: string, claimToken: string, phase: string) {
  logEmailEvent("warn", "claim_lost", {
    messageId,
    claimTokenHash: crypto.createHash("sha256").update(claimToken).digest("hex").slice(0, 16),
    phase,
  });
}

async function markSuppressedByClaim(params: {
  messageId: string;
  claimToken: string;
  suppressionId?: string;
  reason?: string;
}) {
  const now = new Date();
  const result = await prisma.emailMessage.updateMany({
    where: {
      id: params.messageId,
      status: EmailMessageStatus.PROCESSING,
      claimToken: params.claimToken,
    },
    data: {
      status: EmailMessageStatus.SUPPRESSED,
      suppressedAt: now,
      claimToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      processingAt: null,
      nextAttemptAt: null,
      lastErrorCode: "EMAIL_SUPPRESSED_BEFORE_SEND",
      lastErrorMessage: "Email delivery suppressed before provider send.",
    },
  });
  if (result.count === 0) {
    await markClaimLost(params.messageId, params.claimToken, "suppression_recheck");
    return false;
  }
  logEmailEvent("info", "suppressed_before_send", {
    messageId: params.messageId,
    suppressionId: params.suppressionId,
    reason: params.reason,
  });
  return true;
}

async function createAttemptForOwnedClaim(params: {
  messageId: string;
  claimToken: string;
  provider: EmailProvider;
}): Promise<{ attempt: EmailDeliveryAttempt; attemptNumber: number } | null> {
  return prisma.$transaction(async (tx) => {
    const message = await tx.emailMessage.findFirst({
      where: {
        id: params.messageId,
        status: EmailMessageStatus.PROCESSING,
        claimToken: params.claimToken,
      },
      select: { attemptCount: true },
    });
    if (!message) return null;

    const attemptNumber = message.attemptCount + 1;
    const update = await tx.emailMessage.updateMany({
      where: {
        id: params.messageId,
        status: EmailMessageStatus.PROCESSING,
        claimToken: params.claimToken,
        attemptCount: message.attemptCount,
      },
      data: { attemptCount: { increment: 1 } },
    });
    if (update.count === 0) return null;

    const attempt = await tx.emailDeliveryAttempt.create({
      data: {
        emailMessageId: params.messageId,
        attemptNumber,
        provider: params.provider.name,
        transport: params.provider.transport,
      },
    });
    return { attempt, attemptNumber };
  });
}

async function finalizeAccepted(params: {
  messageId: string;
  claimToken: string;
  attemptId: string;
  providerName: string;
  providerMessageId: string;
  acceptedAt: Date;
  metadata?: Record<string, unknown>;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const messageUpdate = await tx.emailMessage.updateMany({
      where: {
        id: params.messageId,
        status: EmailMessageStatus.PROCESSING,
        claimToken: params.claimToken,
      },
      data: {
        status: EmailMessageStatus.ACCEPTED_BY_PROVIDER,
        providerName: params.providerName,
        lastProviderMessageId: params.providerMessageId,
        sentAt: params.acceptedAt,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        processingAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (messageUpdate.count === 0) return false;
    await tx.emailDeliveryAttempt.update({
      where: { id: params.attemptId },
      data: {
        status: EmailDeliveryAttemptStatus.ACCEPTED,
        providerMessageId: params.providerMessageId,
        completedAt: params.acceptedAt,
        providerMetadata: toJsonValue(params.metadata),
      },
    });
    return true;
  });
  if (!updated) {
    await markClaimLost(params.messageId, params.claimToken, "accepted");
  }
  return updated;
}

async function finalizeFailure(params: {
  messageId: string;
  claimToken: string;
  attemptId: string;
  attemptStatus: EmailDeliveryAttemptStatus;
  messageStatus: EmailMessageStatus;
  retryable: boolean;
  nextAttemptAt: Date | null;
  terminalFailureAt: Date | null;
  errorCode: string;
  sanitizedMessage: string;
  metadata?: Record<string, unknown>;
}) {
  const completedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const messageUpdate = await tx.emailMessage.updateMany({
      where: {
        id: params.messageId,
        status: EmailMessageStatus.PROCESSING,
        claimToken: params.claimToken,
      },
      data: {
        status: params.messageStatus,
        terminalFailureAt: params.terminalFailureAt,
        nextAttemptAt: params.nextAttemptAt,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        processingAt: null,
        lastErrorCode: params.errorCode,
        lastErrorMessage: params.sanitizedMessage,
      },
    });
    if (messageUpdate.count === 0) return false;
    await tx.emailDeliveryAttempt.update({
      where: { id: params.attemptId },
      data: {
        status: params.attemptStatus,
        retryable: params.retryable,
        normalizedErrorCode: params.errorCode,
        sanitizedErrorMessage: params.sanitizedMessage,
        completedAt,
        providerMetadata: toJsonValue(params.metadata),
      },
    });
    return true;
  });
  if (!updated) {
    await markClaimLost(params.messageId, params.claimToken, "failure");
  }
  return updated;
}

export async function runEmailDeliverySweep(params?: {
  provider?: EmailProvider;
  limit?: number;
  beforeSuppressionRecheck?: (messageId: string) => Promise<void>;
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
      acceptanceUnknown: 0,
      suppressed: 0,
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
  let acceptanceUnknown = 0;
  let suppressed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const claimedMessage = await claimMessage(
      candidate.id,
      new Date(),
      config.processingLeaseSeconds,
    );
    if (!claimedMessage || !claimedMessage.claimToken) {
      skipped += 1;
      continue;
    }
    claimed += 1;
    const claimToken = claimedMessage.claimToken;

    await params?.beforeSuppressionRecheck?.(claimedMessage.id);
    const suppression = await evaluateSuppression({
      recipientEmail: claimedMessage.recipientEmail ?? claimedMessage.recipientEmailNormalized,
      category: claimedMessage.category,
    });
    if (suppression.suppressed) {
      const transitioned = await markSuppressedByClaim({
        messageId: claimedMessage.id,
        claimToken,
        suppressionId: suppression.suppressionId,
        reason: suppression.reason,
      });
      if (transitioned) suppressed += 1;
      else skipped += 1;
      continue;
    }

    const ownedAttempt = await createAttemptForOwnedClaim({
      messageId: claimedMessage.id,
      claimToken,
      provider,
    });
    if (!ownedAttempt) {
      await markClaimLost(claimedMessage.id, claimToken, "attempt_allocation");
      skipped += 1;
      continue;
    }
    const { attempt, attemptNumber } = ownedAttempt;

    try {
      if (
        !claimedMessage.recipientEmail ||
        !claimedMessage.renderedSubject ||
        !claimedMessage.renderedTextBody ||
        !claimedMessage.renderedHtmlBody
      ) {
        throw new Error("EMAIL_CONTENT_UNAVAILABLE");
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
        const updated = await finalizeAccepted({
          messageId: claimedMessage.id,
          claimToken,
          attemptId: attempt.id,
          providerName: result.providerName,
          providerMessageId: result.providerMessageId,
          acceptedAt: result.acceptedAt,
          metadata: result.metadata,
        });
        if (!updated) {
          skipped += 1;
          continue;
        }
        accepted += 1;
        logEmailEvent("info", "accepted_by_provider", {
          messageId: claimedMessage.id,
          attemptNumber,
          provider: result.providerName,
        });
        continue;
      }

      const isAcceptanceUnknown = Boolean(result.acceptanceUnknown);
      const maxAttemptsReached = attemptNumber >= config.maxAttempts;
      const retryable = result.retryable && !maxAttemptsReached && !isAcceptanceUnknown;
      const nextAttemptAt = retryable ? calculateRetryAt(attemptNumber) : null;
      const messageStatus = isAcceptanceUnknown
        ? EmailMessageStatus.ACCEPTANCE_UNKNOWN
        : retryable
          ? EmailMessageStatus.FAILED_RETRYABLE
          : EmailMessageStatus.FAILED_FINAL;
      const attemptStatus = isAcceptanceUnknown
        ? EmailDeliveryAttemptStatus.TIMEOUT_UNKNOWN
        : retryable
          ? EmailDeliveryAttemptStatus.RETRYABLE_FAILURE
          : result.errorCode === "EMAIL_DELIVERY_DISABLED"
            ? EmailDeliveryAttemptStatus.CONFIGURATION_ERROR
            : EmailDeliveryAttemptStatus.FINAL_FAILURE;
      const updated = await finalizeFailure({
        messageId: claimedMessage.id,
        claimToken,
        attemptId: attempt.id,
        attemptStatus,
        messageStatus,
        retryable,
        nextAttemptAt,
        terminalFailureAt: retryable || isAcceptanceUnknown ? null : new Date(),
        errorCode: result.errorCode,
        sanitizedMessage: result.sanitizedMessage,
        metadata: result.metadata,
      });
      if (!updated) {
        skipped += 1;
        continue;
      }
      if (isAcceptanceUnknown) {
        acceptanceUnknown += 1;
        logEmailEvent("warn", "acceptance_unknown", {
          messageId: claimedMessage.id,
          attemptNumber,
          provider: result.providerName,
          errorCode: result.errorCode,
        });
        continue;
      }
      if (retryable) {
        retryableFailures += 1;
      } else {
        finalFailures += 1;
        if (result.errorCode === "EMAIL_DELIVERY_DISABLED") {
          await logEmailConfigurationFailure(result.sanitizedMessage, claimedMessage.id);
        }
      }
    } catch {
      const retryable = attemptNumber < config.maxAttempts;
      const updated = await finalizeFailure({
        messageId: claimedMessage.id,
        claimToken,
        attemptId: attempt.id,
        attemptStatus: retryable
          ? EmailDeliveryAttemptStatus.RETRYABLE_FAILURE
          : EmailDeliveryAttemptStatus.FINAL_FAILURE,
        messageStatus: retryable
          ? EmailMessageStatus.FAILED_RETRYABLE
          : EmailMessageStatus.FAILED_FINAL,
        retryable,
        nextAttemptAt: retryable ? calculateRetryAt(attemptNumber) : null,
        terminalFailureAt: retryable ? null : new Date(),
        errorCode: "WORKER_EXCEPTION",
        sanitizedMessage: "Email worker failed before provider acceptance could be confirmed.",
      });
      if (!updated) {
        skipped += 1;
        continue;
      }
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
    acceptanceUnknown,
    suppressed,
    skipped,
    recoveredStale,
    deliveryDisabled: false,
  };
}
