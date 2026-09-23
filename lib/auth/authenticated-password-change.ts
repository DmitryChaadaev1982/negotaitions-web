import { createHash } from "node:crypto";

import { verifyPassword } from "@/lib/auth/crypto";
import { withCredentialDispatchFence } from "@/lib/auth/credential-dispatch-fence";
import {
  runAfterUserRowLockedForCredentialMutationHook,
  runBeforePasswordUpdateHook,
  StaleCredentialError,
} from "@/lib/auth/credential-concurrency";
import {
  applyPasswordCredentialMutation,
  assertCredentialMutationEmailConfig,
} from "@/lib/auth/credential-mutation";
import { assertNewPasswordPolicy } from "@/lib/auth/password-policy";
import { lockUserRowForUpdate } from "@/lib/auth/user-row-lock";
import { prisma } from "@/lib/prisma";

export async function commitAuthenticatedPasswordChange(params: {
  user: {
    id: string;
    email: string;
    name: string | null;
    preferredLocale: string;
  };
  currentPassword: string;
  currentPasswordHash: string;
  expectedCredentialGeneration: number;
  newPassword: string;
  newPasswordHash: string;
  currentSessionTokenHash: string | null;
  changedAt: Date;
}): Promise<void> {
  const changeId = createHash("sha256")
    .update(params.newPasswordHash)
    .digest("hex")
    .slice(0, 32);

  assertNewPasswordPolicy(params.newPassword);
  assertCredentialMutationEmailConfig();

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

      if (locked.passwordHash !== params.currentPasswordHash) {
        // A transparent login rehash may replace the encoding without
        // incrementing credentialGeneration. Re-verify the supplied current
        // password against the locked verifier before treating that as a
        // secret change.
        const stillCurrent = await verifyPassword(
          params.currentPassword,
          locked.passwordHash,
        );
        if (!stillCurrent) throw new StaleCredentialError();
      }

      await runAfterUserRowLockedForCredentialMutationHook();
      await runBeforePasswordUpdateHook();

      await applyPasswordCredentialMutation(tx, {
        userId: params.user.id,
        newPassword: params.newPassword,
        newPasswordHash: params.newPasswordHash,
        expectedCredentialGeneration: locked.credentialGeneration,
        changedAt: params.changedAt,
        sessionRevocation: {
          kind: "except-current",
          currentSessionTokenHash: params.currentSessionTokenHash,
        },
        rejectError: new StaleCredentialError(),
        notificationUser: params.user,
        idempotencyKey: `password-changed:account:${params.user.id}:${changeId}`,
      });
    });
  });
}
