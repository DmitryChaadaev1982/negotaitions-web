import { createHash } from "node:crypto";

import { withCredentialDispatchFence } from "@/lib/auth/credential-dispatch-fence";
import {
  runAfterUserRowLockedForCredentialMutationHook,
  runBeforePasswordUpdateHook,
  StaleCredentialError,
} from "@/lib/auth/credential-concurrency";
import { lockUserRowForUpdate } from "@/lib/auth/user-row-lock";
import { enqueuePasswordChangedEmail } from "@/lib/email/account-security";
import { prisma } from "@/lib/prisma";

export async function commitAuthenticatedPasswordChange(params: {
  user: {
    id: string;
    email: string;
    name: string | null;
    preferredLocale: string;
  };
  currentPasswordHash: string;
  expectedCredentialGeneration: number;
  newPasswordHash: string;
  currentSessionTokenHash: string | null;
  changedAt: Date;
}): Promise<void> {
  const changeId = createHash("sha256")
    .update(params.newPasswordHash)
    .digest("hex")
    .slice(0, 32);

  await withCredentialDispatchFence(params.user.id, async () => {
    await prisma.$transaction(async (tx) => {
      // Global order: fence -> transaction -> User -> reset tokens ->
      // sessions -> outbox message.
      const locked = await lockUserRowForUpdate(tx, params.user.id);
      if (
        !locked ||
        locked.status !== "ACTIVE" ||
        locked.credentialGeneration !==
          params.expectedCredentialGeneration
      ) {
        throw new StaleCredentialError();
      }

      await runAfterUserRowLockedForCredentialMutationHook();
      await runBeforePasswordUpdateHook();

      const updated = await tx.user.updateMany({
        where: {
          id: params.user.id,
          status: "ACTIVE",
          passwordHash: params.currentPasswordHash,
          credentialGeneration: params.expectedCredentialGeneration,
        },
        data: {
          passwordHash: params.newPasswordHash,
          credentialGeneration: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new StaleCredentialError();

      await tx.passwordResetToken.updateMany({
        where: {
          userId: params.user.id,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: params.changedAt },
      });
      await tx.userSession.deleteMany({
        where: {
          userId: params.user.id,
          ...(params.currentSessionTokenHash
            ? {
                sessionTokenHash: {
                  not: params.currentSessionTokenHash,
                },
              }
            : {}),
        },
      });
      await enqueuePasswordChangedEmail({
        user: params.user,
        changedAt: params.changedAt,
        idempotencyKey: `password-changed:account:${params.user.id}:${changeId}`,
        tx,
      });
    });
  });
}
