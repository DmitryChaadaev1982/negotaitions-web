import {
  EmailMessageStatus,
  EmailMessageType,
} from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
import { evaluatePasswordResetDispatchEligibility } from "@/lib/email/password-reset-dispatch";
import { evaluateSuppression } from "@/lib/email/suppression";
import type { EmailProvider } from "@/lib/email/types";
import { runEmailDeliverySweep } from "@/lib/email/worker";
import { prisma } from "@/lib/prisma";

const EMAIL_MESSAGE_ID = /^[a-z0-9][a-z0-9_-]{7,63}$/;

export class EmailCanaryError extends Error {
  constructor(
    public readonly code:
      | "CANARY_ID_INVALID"
      | "CANARY_DELIVERY_DISABLED"
      | "CANARY_MESSAGE_NOT_FOUND"
      | "CANARY_MESSAGE_INELIGIBLE"
      | "CANARY_DELIVERY_FAILED",
  ) {
    super(code);
    this.name = "EmailCanaryError";
  }
}

export function validateEmailMessageId(value: string): string {
  const id = value.trim();
  if (id !== value || !EMAIL_MESSAGE_ID.test(id)) {
    throw new EmailCanaryError("CANARY_ID_INVALID");
  }
  return id;
}

/**
 * Deliver exactly one explicitly selected eligible outbox row. There is no
 * fallback to a general sweep, and selected-mode lease recovery is scoped to
 * this same id.
 */
export async function runOneMessageEmailCanary(params: {
  messageId: string;
  provider?: EmailProvider;
}): Promise<{
  messageId: string;
  scanned: number;
  claimed: number;
  accepted: number;
}> {
  const messageId = validateEmailMessageId(params.messageId);
  const config = getEmailConfig();
  if (!config.deliveryEnabled) {
    throw new EmailCanaryError("CANARY_DELIVERY_DISABLED");
  }

  const now = new Date();
  const message = await prisma.emailMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      status: true,
      nextAttemptAt: true,
      messageType: true,
      category: true,
      recipientEmail: true,
      recipientEmailNormalized: true,
      relatedTokenId: true,
      userId: true,
      metadata: true,
    },
  });
  if (!message) throw new EmailCanaryError("CANARY_MESSAGE_NOT_FOUND");
  if (
    (message.status !== EmailMessageStatus.PENDING &&
      message.status !== EmailMessageStatus.FAILED_RETRYABLE) ||
    (message.nextAttemptAt && message.nextAttemptAt > now)
  ) {
    throw new EmailCanaryError("CANARY_MESSAGE_INELIGIBLE");
  }

  try {
    const suppression = await evaluateSuppression({
      recipientEmail:
        message.recipientEmail ?? message.recipientEmailNormalized,
      category: message.category,
      now,
    });
    if (suppression.suppressed) {
      throw new EmailCanaryError("CANARY_MESSAGE_INELIGIBLE");
    }
  } catch (error) {
    if (error instanceof EmailCanaryError) throw error;
    throw new EmailCanaryError("CANARY_MESSAGE_INELIGIBLE");
  }

  if (message.messageType === EmailMessageType.PASSWORD_RESET) {
    const metadata =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as Record<string, unknown>)
        : {};
    const generation =
      typeof metadata.credentialGeneration === "number"
        ? metadata.credentialGeneration
        : null;
    if (generation === null) {
      throw new EmailCanaryError("CANARY_MESSAGE_INELIGIBLE");
    }
    const eligibility = await evaluatePasswordResetDispatchEligibility({
      relatedTokenId: message.relatedTokenId,
      userId: message.userId,
      expectedCredentialGeneration: generation,
      now,
    });
    if (!eligibility.ok) {
      throw new EmailCanaryError("CANARY_MESSAGE_INELIGIBLE");
    }
  }

  const result = await runEmailDeliverySweep({
    onlyMessageId: messageId,
    limit: 1,
    provider: params.provider,
  });
  if (
    result.deliveryDisabled ||
    result.scanned !== 1 ||
    result.claimed !== 1 ||
    result.accepted !== 1
  ) {
    throw new EmailCanaryError("CANARY_DELIVERY_FAILED");
  }
  return {
    messageId,
    scanned: result.scanned,
    claimed: result.claimed,
    accepted: result.accepted,
  };
}
