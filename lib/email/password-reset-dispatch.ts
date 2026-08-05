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
  if (token.expiresAt <= now) return { ok: false, reason: "TOKEN_EXPIRED" };

  // A newer active token identifies supersession even when issuance already
  // marked this token revoked.
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
  if (token.revokedAt) return { ok: false, reason: "TOKEN_REVOKED" };
  if (token.user.status !== "ACTIVE") {
    return { ok: false, reason: "USER_INACTIVE" };
  }
  if (
    typeof params.expectedCredentialGeneration === "number" &&
    token.user.credentialGeneration !== params.expectedCredentialGeneration
  ) {
    return { ok: false, reason: "CREDENTIAL_CHANGED" };
  }

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
  apply?: boolean;
}): Promise<{
  dryRun: boolean;
  scanned: number;
  eligible: number;
  wouldQuarantine: number;
  quarantined: number;
  partialFailures: number;
  classifications: {
    expired: number;
    consumed: number;
    superseded: number;
    generationMismatched: number;
    statusIneligible: number;
    legacyPlaintext: number;
    revoked: number;
    missing: number;
    associationMismatch: number;
  };
}> {
  const now = params?.now ?? new Date();
  const limit = params?.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Password-reset quarantine limit must be between 1 and 500.");
  }
  const apply = params?.apply === true;
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
      renderedTextBody: true,
      renderedHtmlBody: true,
    },
  });

  const result = {
    dryRun: !apply,
    scanned: candidates.length,
    eligible: 0,
    wouldQuarantine: 0,
    quarantined: 0,
    partialFailures: 0,
    classifications: {
      expired: 0,
      consumed: 0,
      superseded: 0,
      generationMismatched: 0,
      statusIneligible: 0,
      legacyPlaintext: 0,
      revoked: 0,
      missing: 0,
      associationMismatch: 0,
    },
  };

  for (const message of candidates) {
    try {
      const metadata =
        message.metadata && typeof message.metadata === "object"
          ? (message.metadata as Record<string, unknown>)
          : {};
      const expectedGeneration =
        typeof metadata.credentialGeneration === "number"
          ? metadata.credentialGeneration
          : null;
      const legacyPlaintext = Boolean(
        message.renderedTextBody || message.renderedHtmlBody,
      );
      if (legacyPlaintext) result.classifications.legacyPlaintext += 1;

      const eligibility: PasswordResetDispatchEligibility =
        expectedGeneration === null
          ? { ok: false, reason: "MESSAGE_MISMATCH" }
          : await evaluatePasswordResetDispatchEligibility({
              relatedTokenId: message.relatedTokenId,
              userId: message.userId,
              expectedCredentialGeneration: expectedGeneration,
              now,
            });
      if (!eligibility.ok) {
        if (eligibility.reason === "TOKEN_EXPIRED") {
          result.classifications.expired += 1;
        } else if (eligibility.reason === "TOKEN_USED") {
          result.classifications.consumed += 1;
        } else if (eligibility.reason === "TOKEN_SUPERSEDED") {
          result.classifications.superseded += 1;
        } else if (eligibility.reason === "CREDENTIAL_CHANGED") {
          result.classifications.generationMismatched += 1;
        } else if (
          eligibility.reason === "USER_INACTIVE" ||
          eligibility.reason === "USER_DELETED"
        ) {
          result.classifications.statusIneligible += 1;
        } else if (eligibility.reason === "TOKEN_REVOKED") {
          result.classifications.revoked += 1;
        } else if (eligibility.reason === "TOKEN_MISSING") {
          result.classifications.missing += 1;
        } else {
          result.classifications.associationMismatch += 1;
        }
      }

      if (eligibility.ok && !legacyPlaintext) {
        result.eligible += 1;
        continue;
      }
      result.wouldQuarantine += 1;
      if (!apply) continue;

      const updated = await prisma.emailMessage.updateMany({
        where: {
          id: message.id,
          status: { in: ["PENDING", "FAILED_RETRYABLE"] },
          messageType: EmailMessageType.PASSWORD_RESET,
        },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          nextAttemptAt: null,
          lastErrorCode: "PASSWORD_RESET_QUARANTINED",
          lastErrorMessage: eligibility.ok
            ? "LEGACY_PLAINTEXT"
            : eligibility.reason,
          sensitivePayloadCiphertext: null,
          sensitivePayloadNonce: null,
          sensitivePayloadClearedAt: now,
          renderedSubject: null,
          renderedTextBody: null,
          renderedHtmlBody: null,
        },
      });
      if (updated.count === 1) result.quarantined += 1;
      else result.partialFailures += 1;
    } catch {
      result.partialFailures += 1;
    }
  }

  return result;
}
