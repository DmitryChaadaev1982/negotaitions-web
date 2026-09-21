import { createHash } from "node:crypto";

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
import { lockUserRowForUpdate } from "@/lib/auth/user-row-lock";
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

      await runAfterUserRowLockedForCredentialMutationHook();
      await runBeforePasswordUpdateHook();

      await applyPasswordCredentialMutation(tx, {
        userId: params.user.id,
        newPasswordHash: params.newPasswordHash,
        expectedCredentialGeneration: params.expectedCredentialGeneration,
        currentPasswordHash: params.currentPasswordHash,
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
