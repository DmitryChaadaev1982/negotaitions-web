import crypto from "node:crypto";

import {
  EmailDeliveryAttemptStatus,
  EmailMessageStatus,
  EmailMessageType,
  type EmailDeliveryAttempt,
  type Prisma,
} from "@/app/generated/prisma/client";
import { withCredentialDispatchFence } from "@/lib/auth/credential-dispatch-fence";
import { getEmailConfig } from "@/lib/email/config";
import { logEmailConfigurationFailure, logEmailEvent, safeRecipient } from "@/lib/email/observability";
import {
  cancelStalePasswordResetMessage,
  evaluatePasswordResetDispatchEligibility,
} from "@/lib/email/password-reset-dispatch";
import { createEmailProvider } from "@/lib/email/provider";
import { renderEmailTemplate } from "@/lib/email/renderer";
import {
  assertPasswordResetPayloadDeliveryBinding,
  buildPasswordResetActionUrl,
  decryptSensitivePayload,
  SensitivePayloadError,
} from "@/lib/email/sensitive-payload";
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
  cancelled: number;
  skipped: number;
  recoveredStale: number;
  deliveryDisabled: boolean;
};

export type EmailDeliverySweepOptions = {
  provider?: EmailProvider;
  limit?: number;
  beforeSuppressionRecheck?: (messageId: string) => Promise<void>;
  /**
   * Test-only barrier after eligibility revalidation under the dispatch fence,
   * immediately before provider.send for password-reset messages.
   */
  beforeProviderSend?: (messageId: string) => Promise<void>;
  /** When true, skip normal claim/send and only recover leases (canary isolation). */
  leaseRecoveryOnly?: boolean;
  /** Deliver exactly one explicitly selected message id (canary). */
  onlyMessageId?: string;
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
  clearSensitivePayload?: boolean;
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
        ...(params.clearSensitivePayload
          ? {
              sensitivePayloadCiphertext: null,
              sensitivePayloadNonce: null,
              sensitivePayloadClearedAt: params.acceptedAt,
              renderedTextBody: null,
              renderedHtmlBody: null,
            }
          : {}),
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

export async function runEmailDeliverySweep(
  params?: EmailDeliverySweepOptions,
): Promise<EmailDeliverySweepResult> {
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
      cancelled: 0,
      skipped: 0,
      recoveredStale: 0,
      deliveryDisabled: true,
    };
  }

  const provider = params?.provider ?? createEmailProvider();
  const now = new Date();
  const recoveredStale = await recoverStaleProcessing(now, limit);

  if (params?.leaseRecoveryOnly) {
    return {
      scanned: 0,
      claimed: 0,
      accepted: 0,
      retryableFailures: 0,
      finalFailures: 0,
      acceptanceUnknown: 0,
      suppressed: 0,
      cancelled: 0,
      skipped: 0,
      recoveredStale,
      deliveryDisabled: false,
    };
  }

  const candidates = params?.onlyMessageId
    ? [{ id: params.onlyMessageId }]
    : await prisma.emailMessage.findMany({
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
  let cancelled = 0;
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
    const isPasswordReset =
      claimedMessage.messageType === EmailMessageType.PASSWORD_RESET;

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
      if (transitioned) {
        if (isPasswordReset) {
          await prisma.emailMessage.updateMany({
            where: { id: claimedMessage.id },
            data: {
              sensitivePayloadCiphertext: null,
              sensitivePayloadNonce: null,
              sensitivePayloadClearedAt: new Date(),
            },
          });
        }
        suppressed += 1;
      } else skipped += 1;
      continue;
    }

    type DeliveryOutcome =
      | "accepted"
      | "retryable"
      | "final"
      | "unknown"
      | "cancelled"
      | "skipped";

    const finishProviderFailure = async (args: {
      attemptId: string;
      attemptNumber: number;
      result: Extract<Awaited<ReturnType<EmailProvider["send"]>>, { ok: false }>;
    }): Promise<DeliveryOutcome> => {
      const isAcceptanceUnknown = Boolean(args.result.acceptanceUnknown);
      const maxAttemptsReached = args.attemptNumber >= config.maxAttempts;
      const retryable =
        args.result.retryable && !maxAttemptsReached && !isAcceptanceUnknown;
      const nextAttemptAt = retryable ? calculateRetryAt(args.attemptNumber) : null;
      const messageStatus = isAcceptanceUnknown
        ? EmailMessageStatus.ACCEPTANCE_UNKNOWN
        : retryable
          ? EmailMessageStatus.FAILED_RETRYABLE
          : EmailMessageStatus.FAILED_FINAL;
      const attemptStatus = isAcceptanceUnknown
        ? EmailDeliveryAttemptStatus.TIMEOUT_UNKNOWN
        : retryable
          ? EmailDeliveryAttemptStatus.RETRYABLE_FAILURE
          : args.result.errorCode === "EMAIL_DELIVERY_DISABLED"
            ? EmailDeliveryAttemptStatus.CONFIGURATION_ERROR
            : EmailDeliveryAttemptStatus.FINAL_FAILURE;
      const updated = await finalizeFailure({
        messageId: claimedMessage.id,
        claimToken,
        attemptId: args.attemptId,
        attemptStatus,
        messageStatus,
        retryable,
        nextAttemptAt,
        terminalFailureAt: retryable || isAcceptanceUnknown ? null : new Date(),
        errorCode: args.result.errorCode,
        sanitizedMessage: args.result.sanitizedMessage,
        metadata: args.result.metadata,
      });
      if (!updated) return "skipped";
      if (isAcceptanceUnknown) {
        logEmailEvent("warn", "acceptance_unknown", {
          messageId: claimedMessage.id,
          attemptNumber: args.attemptNumber,
          provider: args.result.providerName,
          errorCode: args.result.errorCode,
        });
        return "unknown";
      }
      if (args.result.errorCode === "EMAIL_DELIVERY_DISABLED") {
        await logEmailConfigurationFailure(
          args.result.sanitizedMessage,
          claimedMessage.id,
        );
      }
      return retryable ? "retryable" : "final";
    };

    const finishException = async (
      error: unknown,
      attemptId: string,
      attemptNumber: number,
    ): Promise<DeliveryOutcome> => {
      const isSensitiveFailure = error instanceof SensitivePayloadError;
      const retryable =
        !isSensitiveFailure && attemptNumber < config.maxAttempts;
      const updated = await finalizeFailure({
        messageId: claimedMessage.id,
        claimToken,
        attemptId,
        attemptStatus: retryable
          ? EmailDeliveryAttemptStatus.RETRYABLE_FAILURE
          : EmailDeliveryAttemptStatus.FINAL_FAILURE,
        messageStatus: retryable
          ? EmailMessageStatus.FAILED_RETRYABLE
          : EmailMessageStatus.FAILED_FINAL,
        retryable,
        nextAttemptAt: retryable ? calculateRetryAt(attemptNumber) : null,
        terminalFailureAt: retryable ? null : new Date(),
        errorCode: isSensitiveFailure
          ? "SENSITIVE_PAYLOAD_ERROR"
          : "WORKER_EXCEPTION",
        sanitizedMessage: isSensitiveFailure
          ? "Sensitive payload could not be decrypted for delivery."
          : "Email worker failed before provider acceptance could be confirmed.",
      });
      if (isSensitiveFailure) {
        await prisma.emailMessage.updateMany({
          where: { id: claimedMessage.id },
          data: {
            sensitivePayloadCiphertext: null,
            sensitivePayloadNonce: null,
            sensitivePayloadClearedAt: new Date(),
          },
        });
      }
      if (!updated) return "skipped";
      logEmailEvent("error", "delivery_attempt_failed", {
        messageId: claimedMessage.id,
        attemptNumber,
        recipient: safeRecipient(claimedMessage.recipientEmail),
        errorCode: isSensitiveFailure
          ? "SENSITIVE_PAYLOAD_ERROR"
          : "WORKER_EXCEPTION",
      });
      return retryable ? "retryable" : "final";
    };

    let outcome: DeliveryOutcome = "skipped";

    if (isPasswordReset) {
      if (!claimedMessage.userId) {
        const transitioned = await cancelStalePasswordResetMessage({
          messageId: claimedMessage.id,
          claimToken,
          reason: "MESSAGE_MISMATCH",
        });
        if (transitioned) cancelled += 1;
        else skipped += 1;
        continue;
      }

      const metadata =
        claimedMessage.metadata && typeof claimedMessage.metadata === "object"
          ? (claimedMessage.metadata as Record<string, unknown>)
          : {};
      const expectedGeneration =
        typeof metadata.credentialGeneration === "number"
          ? metadata.credentialGeneration
          : null;

      outcome = await withCredentialDispatchFence(
        claimedMessage.userId,
        async () => {
          const eligibility = await evaluatePasswordResetDispatchEligibility({
            relatedTokenId: claimedMessage.relatedTokenId,
            userId: claimedMessage.userId,
            expectedCredentialGeneration: expectedGeneration,
          });
          if (!eligibility.ok) {
            const transitioned = await cancelStalePasswordResetMessage({
              messageId: claimedMessage.id,
              claimToken,
              reason: eligibility.reason,
            });
            return transitioned ? "cancelled" : "skipped";
          }

          const ownedAttempt = await createAttemptForOwnedClaim({
            messageId: claimedMessage.id,
            claimToken,
            provider,
          });
          if (!ownedAttempt) {
            await markClaimLost(
              claimedMessage.id,
              claimToken,
              "attempt_allocation",
            );
            return "skipped";
          }
          const { attempt, attemptNumber } = ownedAttempt;

          try {
            if (
              !claimedMessage.sensitivePayloadCiphertext ||
              !claimedMessage.sensitivePayloadNonce
            ) {
              throw new SensitivePayloadError(
                "Missing sensitive payload for password reset.",
              );
            }
            if (!claimedMessage.relatedTokenId) {
              throw new SensitivePayloadError(
                "Missing related token for password reset.",
              );
            }
            if (typeof expectedGeneration !== "number") {
              throw new SensitivePayloadError(
                "Missing credential generation binding.",
              );
            }

            const binding = {
              messageId: claimedMessage.id,
              tokenId: claimedMessage.relatedTokenId,
              userId: claimedMessage.userId!,
              credentialGeneration: expectedGeneration,
              recipientNormalized: claimedMessage.recipientEmailNormalized,
            };
            const payload = decryptSensitivePayload(
              {
                ciphertext: claimedMessage.sensitivePayloadCiphertext,
                nonce: claimedMessage.sensitivePayloadNonce,
              },
              binding,
            );
            await assertPasswordResetPayloadDeliveryBinding({
              payload,
              binding,
              messageId: claimedMessage.id,
              relatedTokenId: claimedMessage.relatedTokenId,
              messageUserId: claimedMessage.userId,
              recipientEmailNormalized:
                claimedMessage.recipientEmailNormalized,
            });

            const actionUrl = buildPasswordResetActionUrl(
              config.canonicalBaseUrl,
              payload.rawToken,
            );
            const rendered = renderEmailTemplate({
              key: "password-reset",
              locale: payload.locale,
              variables: {
                ...payload.variables,
                actionUrl,
              },
            });
            if (
              !claimedMessage.recipientEmail ||
              !rendered.subject ||
              !rendered.textBody ||
              !rendered.htmlBody
            ) {
              throw new Error("EMAIL_CONTENT_UNAVAILABLE");
            }

            await params?.beforeProviderSend?.(claimedMessage.id);

            const result = await provider.send({
              id: claimedMessage.id,
              recipientEmail: claimedMessage.recipientEmail,
              fromAddress: claimedMessage.fromAddress,
              replyToAddress: claimedMessage.replyToAddress,
              subject: rendered.subject,
              textBody: rendered.textBody,
              htmlBody: rendered.htmlBody,
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
                clearSensitivePayload: true,
              });
              if (!updated) return "skipped";
              logEmailEvent("info", "accepted_by_provider", {
                messageId: claimedMessage.id,
                attemptNumber,
                provider: result.providerName,
              });
              return "accepted";
            }

            return finishProviderFailure({
              attemptId: attempt.id,
              attemptNumber,
              result,
            });
          } catch (error) {
            return finishException(error, attempt.id, attemptNumber);
          }
        },
      );
    } else {
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

        await params?.beforeProviderSend?.(claimedMessage.id);

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
            clearSensitivePayload: false,
          });
          if (!updated) {
            outcome = "skipped";
          } else {
            logEmailEvent("info", "accepted_by_provider", {
              messageId: claimedMessage.id,
              attemptNumber,
              provider: result.providerName,
            });
            outcome = "accepted";
          }
        } else {
          outcome = await finishProviderFailure({
            attemptId: attempt.id,
            attemptNumber,
            result,
          });
        }
      } catch (error) {
        outcome = await finishException(error, attempt.id, attemptNumber);
      }
    }

    if (outcome === "accepted") accepted += 1;
    else if (outcome === "retryable") retryableFailures += 1;
    else if (outcome === "final") finalFailures += 1;
    else if (outcome === "unknown") acceptanceUnknown += 1;
    else if (outcome === "cancelled") cancelled += 1;
    else skipped += 1;
  }

  return {
    scanned: candidates.length,
    claimed,
    accepted,
    retryableFailures,
    finalFailures,
    acceptanceUnknown,
    suppressed,
    cancelled,
    skipped,
    recoveredStale,
    deliveryDisabled: false,
  };
}
