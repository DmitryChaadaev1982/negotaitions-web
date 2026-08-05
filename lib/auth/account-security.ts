import {
  EmailMessageType,
  Prisma,
} from "@/app/generated/prisma/client";
import {
  enqueuePasswordChangedEmail,
  enqueuePasswordResetEmail,
  enqueueRecoveryDeniedEmail,
} from "@/lib/email/account-security";
import { prisma } from "@/lib/prisma";

import { hashPassword } from "./crypto";
import { getPasswordResetConfig } from "./password-reset-config";
import { consumePasswordResetAttempt } from "./password-reset-rate-limit";
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
  isPasswordResetTokenShape,
} from "./password-reset-token";

const HOUR_MS = 60 * 60 * 1000;
const SERIALIZABLE_ATTEMPTS = 3;

class InvalidResetTokenError extends Error {}

function isSerializableConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

async function withSerializableRetry<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === SERIALIZABLE_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw new Error("Serializable transaction retry exhausted.");
}

export async function requestPasswordReset(params: {
  normalizedEmail: string;
  clientIpFingerprint?: string | null;
}): Promise<void> {
  const config = getPasswordResetConfig();
  if (
    !consumePasswordResetAttempt({
      normalizedEmail: params.normalizedEmail,
      clientIpFingerprint: params.clientIpFingerprint,
      maxPerAccountPerHour: config.maxPerAccountPerHour,
      cooldownSeconds: config.cooldownSeconds,
    })
  ) {
    return;
  }

  const now = new Date();
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const cooldownAfter = new Date(
    now.getTime() - config.cooldownSeconds * 1000,
  );

  await withSerializableRetry(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: params.normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        preferredLocale: true,
        status: true,
      },
    });
    if (!user || user.status === "PENDING_APPROVAL") return;

    if (user.status === "ACTIVE") {
      const [recentCount, latest] = await Promise.all([
        tx.passwordResetToken.count({
          where: { userId: user.id, createdAt: { gte: hourAgo } },
        }),
        tx.passwordResetToken.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      if (
        recentCount >= config.maxPerAccountPerHour ||
        (latest && latest.createdAt > cooldownAfter)
      ) {
        return;
      }

      await tx.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      const rawToken = generatePasswordResetToken();
      const token = await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashPasswordResetToken(rawToken),
          expiresAt: new Date(now.getTime() + config.ttlMinutes * 60 * 1000),
        },
        select: { id: true },
      });
      await enqueuePasswordResetEmail({
        user,
        rawToken,
        tokenId: token.id,
        tx,
      });
      return;
    }

    if (user.status !== "BLOCKED" && user.status !== "REJECTED") return;
    const [recentCount, latest] = await Promise.all([
      tx.emailMessage.count({
        where: {
          userId: user.id,
          messageType: EmailMessageType.ACCOUNT_RECOVERY_DENIED,
          createdAt: { gte: hourAgo },
        },
      }),
      tx.emailMessage.findFirst({
        where: {
          userId: user.id,
          messageType: EmailMessageType.ACCOUNT_RECOVERY_DENIED,
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    if (
      recentCount >= config.maxPerAccountPerHour ||
      (latest && latest.createdAt > cooldownAfter)
    ) {
      return;
    }
    const bucket = Math.floor(
      now.getTime() / (config.cooldownSeconds * 1000),
    );
    await enqueueRecoveryDeniedEmail({ user, bucket, tx });
  });
}

export async function resetPasswordWithToken(params: {
  rawToken: string;
  newPassword: string;
}): Promise<boolean> {
  if (!isPasswordResetTokenShape(params.rawToken)) return false;
  const tokenHash = hashPasswordResetToken(params.rawToken);
  const passwordHash = await hashPassword(params.newPassword);
  const now = new Date();

  try {
    await withSerializableRetry(async (tx) => {
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              preferredLocale: true,
              status: true,
            },
          },
        },
      });
      if (
        !token ||
        token.usedAt ||
        token.revokedAt ||
        token.expiresAt <= now ||
        token.user.status !== "ACTIVE"
      ) {
        throw new InvalidResetTokenError();
      }

      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new InvalidResetTokenError();

      const updated = await tx.user.updateMany({
        where: { id: token.userId, status: "ACTIVE" },
        data: { passwordHash },
      });
      if (updated.count !== 1) throw new InvalidResetTokenError();

      await tx.passwordResetToken.updateMany({
        where: {
          userId: token.userId,
          id: { not: token.id },
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await tx.userSession.deleteMany({ where: { userId: token.userId } });
      await enqueuePasswordChangedEmail({
        user: token.user,
        changedAt: now,
        idempotencyKey: `password-changed:reset:${token.id}`,
        tx,
      });
    });
    return true;
  } catch (error) {
    if (error instanceof InvalidResetTokenError) return false;
    throw error;
  }
}
