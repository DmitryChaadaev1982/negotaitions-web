import { EmailMessageType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type PasswordResetDispatchEligibility =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "TOKEN_MISSING"
        | "TOKEN_USED"
        | "TOKEN_REVOKED"
        | "TOKEN_EXPIRED"
        | "TOKEN_SUPERSEDED"
        | "USER_INACTIVE"
        | "USER_DELETED"
        | "CREDENTIAL_CHANGED"
        | "MESSAGE_MISMATCH";
    };

/**
 * Recheck password-reset delivery eligibility immediately before provider send.
 * Never leaks account status to public clients; returns sanitized reason codes only.
 */
export async function evaluatePasswordResetDispatchEligibility(params: {
  relatedTokenId: string | null | undefined;
  userId: string | null | undefined;
  expectedCredentialGeneration?: number | null;
  now?: Date;
}): Promise<PasswordResetDispatchEligibility> {
  const now = params.now ?? new Date();
  if (!params.relatedTokenId) {
    return { ok: false, reason: "TOKEN_MISSING" };
  }

  const token = await prisma.passwordResetToken.findUnique({
    where: { id: params.relatedTokenId },
    select: {
      id: true,
      userId: true,
      usedAt: true,
      revokedAt: true,
      expiresAt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          status: true,
          credentialGeneration: true,
        },
      },
    },
  });

  if (!token) return { ok: false, reason: "TOKEN_MISSING" };
  if (params.userId && token.userId !== params.userId) {
    return { ok: false, reason: "MESSAGE_MISMATCH" };
  }
  if (!token.user) return { ok: false, reason: "USER_DELETED" };
  if (token.usedAt) return { ok: false, reason: "TOKEN_USED" };
  if (token.revokedAt) return { ok: false, reason: "TOKEN_REVOKED" };
  if (token.expiresAt <= now) return { ok: false, reason: "TOKEN_EXPIRED" };
  if (token.user.status !== "ACTIVE") {
    return { ok: false, reason: "USER_INACTIVE" };
  }
  if (
    typeof params.expectedCredentialGeneration === "number" &&
    token.user.credentialGeneration !== params.expectedCredentialGeneration
  ) {
    return { ok: false, reason: "CREDENTIAL_CHANGED" };
  }

  // A newer active token supersedes this message's token.
  const newerActive = await prisma.passwordResetToken.findFirst({
    where: {
      userId: token.userId,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
      createdAt: { gt: token.createdAt },
    },
    select: { id: true },
  });
  if (newerActive) return { ok: false, reason: "TOKEN_SUPERSEDED" };

  return { ok: true };
}

export async function cancelStalePasswordResetMessage(params: {
  messageId: string;
  claimToken: string;
  reason: string;
}): Promise<boolean> {
  const now = new Date();
  const result = await prisma.emailMessage.updateMany({
    where: {
      id: params.messageId,
      status: "PROCESSING",
      claimToken: params.claimToken,
      messageType: EmailMessageType.PASSWORD_RESET,
    },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      claimToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      processingAt: null,
      nextAttemptAt: null,
      lastErrorCode: "PASSWORD_RESET_STALE",
      lastErrorMessage: params.reason,
      sensitivePayloadCiphertext: null,
      sensitivePayloadNonce: null,
      sensitivePayloadClearedAt: now,
      renderedSubject: null,
      renderedTextBody: null,
      renderedHtmlBody: null,
    },
  });
  return result.count === 1;
}

/**
 * Quarantine pending/retryable password-reset backlog before activation canaries.
 * Does not send mail. Safe to run repeatedly.
 */
export async function quarantineStalePasswordResetBacklog(params?: {
  limit?: number;
  now?: Date;
}): Promise<{ scanned: number; cancelled: number }> {
  const now = params?.now ?? new Date();
  const limit = Math.max(1, Math.min(params?.limit ?? 200, 2000));
  const candidates = await prisma.emailMessage.findMany({
    where: {
      messageType: EmailMessageType.PASSWORD_RESET,
      status: { in: ["PENDING", "FAILED_RETRYABLE"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      relatedTokenId: true,
      userId: true,
      metadata: true,
    },
  });

  let cancelled = 0;
  for (const message of candidates) {
    const metadata =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as Record<string, unknown>)
        : {};
    const expectedGeneration =
      typeof metadata.credentialGeneration === "number"
        ? metadata.credentialGeneration
        : null;
    const eligibility = await evaluatePasswordResetDispatchEligibility({
      relatedTokenId: message.relatedTokenId,
      userId: message.userId,
      expectedCredentialGeneration: expectedGeneration,
      now,
    });
    if (eligibility.ok) continue;

    const result = await prisma.emailMessage.updateMany({
      where: {
        id: message.id,
        status: { in: ["PENDING", "FAILED_RETRYABLE"] },
        messageType: EmailMessageType.PASSWORD_RESET,
      },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        nextAttemptAt: null,
        lastErrorCode: "PASSWORD_RESET_STALE",
        lastErrorMessage: eligibility.reason,
        sensitivePayloadCiphertext: null,
        sensitivePayloadNonce: null,
        sensitivePayloadClearedAt: now,
        renderedSubject: null,
        renderedTextBody: null,
        renderedHtmlBody: null,
      },
    });
    if (result.count === 1) cancelled += 1;
  }

  return { scanned: candidates.length, cancelled };
}
