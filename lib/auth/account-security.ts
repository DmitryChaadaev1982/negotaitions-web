import {
  EmailMessageType,
  Prisma,
} from "@/app/generated/prisma/client";
import {
  runAfterPasswordVerifiedHook,
  runBeforePasswordUpdateHook,
} from "@/lib/auth/credential-concurrency";
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

/** Test-only: observe whether bcrypt ran for a reset attempt. */
let passwordHashInvocationCountForTests = 0;
let trackPasswordHashInvocations = false;

export function beginTrackingPasswordHashInvocationsForTests(): void {
  trackPasswordHashInvocations = true;
  passwordHashInvocationCountForTests = 0;
}

export function endTrackingPasswordHashInvocationsForTests(): number {
  trackPasswordHashInvocations = false;
  return passwordHashInvocationCountForTests;
}

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
        credentialGeneration: true,
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
        credentialGeneration: user.credentialGeneration,
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

/**
 * Cheap eligibility probe used before bcrypt. Does not consume the token.
 */
async function isResetTokenEligible(
  tokenHash: string,
  now: Date,
): Promise<boolean> {
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      usedAt: true,
      revokedAt: true,
      expiresAt: true,
      user: { select: { status: true } },
    },
  });
  return Boolean(
    token &&
      !token.usedAt &&
      !token.revokedAt &&
      token.expiresAt > now &&
      token.user.status === "ACTIVE",
  );
}

export async function resetPasswordWithToken(params: {
  rawToken: string;
  newPassword: string;
}): Promise<boolean> {
  // 1. Validate token syntax (cheap).
  if (!isPasswordResetTokenShape(params.rawToken)) return false;
  // 2. Hash token (cheap SHA-256).
  const tokenHash = hashPasswordResetToken(params.rawToken);
  const now = new Date();

  // 3. Query eligibility cheaply — do not consume; do not bcrypt yet.
  if (!(await isResetTokenEligible(tokenHash, now))) {
    return false;
  }

  await runAfterPasswordVerifiedHook();

  // 4. Only then perform bcrypt.
  if (trackPasswordHashInvocations) {
    passwordHashInvocationCountForTests += 1;
  }
  const passwordHash = await hashPassword(params.newPassword);

  // 5. Atomically claim token / update password / bump generation / wipe sessions.
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
              credentialGeneration: true,
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

      await runBeforePasswordUpdateHook();

      const updated = await tx.user.updateMany({
        where: {
          id: token.userId,
          status: "ACTIVE",
          credentialGeneration: token.user.credentialGeneration,
        },
        data: {
          passwordHash,
          credentialGeneration: { increment: 1 },
        },
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
