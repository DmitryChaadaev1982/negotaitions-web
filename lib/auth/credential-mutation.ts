import type { Prisma } from "@/app/generated/prisma/client";
import { enqueuePasswordChangedEmail } from "@/lib/email/account-security";
import { getEmailConfig } from "@/lib/email/config";

import {
  PASSWORD_HISTORY_DEPTH,
  passwordMatchesAnyVerifier,
  PasswordReusedError,
  prunePasswordHistory,
} from "./password-history";
import {
  revokeAllUserSessions,
  revokeOtherUserSessions,
} from "./session-revocation";

export { PasswordReusedError } from "./password-history";

type CredentialDb = Prisma.TransactionClient;

export type CredentialSessionRevocation =
  | { kind: "all" }
  | {
      kind: "except-current";
      /**
       * When null, every session is revoked. Authenticated self-change uses
       * that fallback only when the current session hash cannot be read.
       */
      currentSessionTokenHash: string | null;
    };

/**
 * Fail before a credential transaction when the email runtime contract is
 * incomplete. Delivery stays outside this transaction; the outbox insert does
 * not call a provider.
 */
export function assertCredentialMutationEmailConfig(): void {
  getEmailConfig();
}

/**
 * Shared password-credential write used inside an existing transaction.
 *
 * The caller still owns authority: current-password proof or reset-token
 * proof, the credential-dispatch fence, and the User row lock. This helper
 * rejects a candidate that matches the locked current verifier or any of the
 * newest five history verifiers, records the locked verifier as history,
 * updates the hash, bumps credentialGeneration once, revokes outstanding
 * reset tokens, revokes sessions for the requested mode, enqueues
 * PASSWORD_CHANGED, and prunes history to the newest five. Those writes
 * commit or roll back together. A reuse rejection writes nothing.
 *
 * Email-reset callers must mark the consumed token used before calling this
 * helper. Outstanding-token revocation then leaves that consumed token in
 * place and revokes the unused siblings.
 */
export async function applyPasswordCredentialMutation(
  tx: CredentialDb,
  params: {
    userId: string;
    /** Raw new password. Used only to compare with stored verifiers. */
    newPassword: string;
    newPasswordHash: string;
    expectedCredentialGeneration: number;
    changedAt: Date;
    sessionRevocation: CredentialSessionRevocation;
    rejectError: Error;
    notificationUser: {
      id: string;
      email: string;
      name: string | null;
      preferredLocale: string;
    };
    idempotencyKey: string;
  },
): Promise<void> {
  const locked = await tx.user.findUnique({
    where: { id: params.userId },
    select: {
      passwordHash: true,
      credentialGeneration: true,
      status: true,
    },
  });
  if (
    !locked ||
    locked.status !== "ACTIVE" ||
    locked.credentialGeneration !== params.expectedCredentialGeneration
  ) {
    throw params.rejectError;
  }

  const history = await tx.passwordHistory.findMany({
    where: { userId: params.userId },
    orderBy: { retiredCredentialGeneration: "desc" },
    take: PASSWORD_HISTORY_DEPTH,
    select: { passwordHash: true },
  });
  const reused = await passwordMatchesAnyVerifier(params.newPassword, [
    locked.passwordHash,
    ...history.map((row) => row.passwordHash),
  ]);
  if (reused) throw new PasswordReusedError();

  await tx.passwordHistory.create({
    data: {
      userId: params.userId,
      passwordHash: locked.passwordHash,
      retiredCredentialGeneration: locked.credentialGeneration,
    },
  });

  const updated = await tx.user.updateMany({
    where: {
      id: params.userId,
      status: "ACTIVE",
      credentialGeneration: locked.credentialGeneration,
      passwordHash: locked.passwordHash,
    },
    data: {
      passwordHash: params.newPasswordHash,
      credentialGeneration: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw params.rejectError;

  await tx.passwordResetToken.updateMany({
    where: {
      userId: params.userId,
      usedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: params.changedAt },
  });

  if (
    params.sessionRevocation.kind === "except-current" &&
    params.sessionRevocation.currentSessionTokenHash
  ) {
    await revokeOtherUserSessions(
      tx,
      params.userId,
      params.sessionRevocation.currentSessionTokenHash,
    );
  } else {
    await revokeAllUserSessions(tx, params.userId);
  }

  await enqueuePasswordChangedEmail({
    user: params.notificationUser,
    changedAt: params.changedAt,
    idempotencyKey: params.idempotencyKey,
    tx,
  });

  await prunePasswordHistory(tx, params.userId);
}
