import type { Prisma } from "@/app/generated/prisma/client";
import { enqueuePasswordChangedEmail } from "@/lib/email/account-security";
import { getEmailConfig } from "@/lib/email/config";

import {
  revokeAllUserSessions,
  revokeOtherUserSessions,
} from "./session-revocation";

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
 * updates the hash, bumps credentialGeneration, revokes outstanding reset
 * tokens, revokes sessions for the requested mode, and enqueues
 * PASSWORD_CHANGED. Those writes commit or roll back together.
 *
 * Email-reset callers must mark the consumed token used before calling this
 * helper. Outstanding-token revocation then leaves that consumed token in
 * place and revokes the unused siblings.
 */
export async function applyPasswordCredentialMutation(
  tx: CredentialDb,
  params: {
    userId: string;
    newPasswordHash: string;
    expectedCredentialGeneration: number;
    /** Extra CAS for authenticated self-change. Email reset omits it. */
    currentPasswordHash?: string;
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
  const updated = await tx.user.updateMany({
    where: {
      id: params.userId,
      status: "ACTIVE",
      credentialGeneration: params.expectedCredentialGeneration,
      ...(params.currentPasswordHash !== undefined
        ? { passwordHash: params.currentPasswordHash }
        : {}),
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
}
