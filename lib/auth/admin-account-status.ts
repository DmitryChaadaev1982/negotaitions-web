import {
  EmailMessageStatus,
  EmailMessageType,
  type Prisma,
} from "@/app/generated/prisma/client";
import { withCredentialDispatchFence } from "@/lib/auth/credential-dispatch-fence";
import { lockUserRowForUpdate } from "@/lib/auth/user-row-lock";
import { prisma } from "@/lib/prisma";

type ResetIneligibleStatus = "BLOCKED" | "REJECTED";

async function invalidatePasswordResetDelivery(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  reason: "USER_BLOCKED" | "USER_REJECTED",
): Promise<void> {
  await tx.passwordResetToken.updateMany({
    where: {
      userId,
      usedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  await tx.emailMessage.updateMany({
    where: {
      userId,
      messageType: EmailMessageType.PASSWORD_RESET,
      status: {
        in: [
          EmailMessageStatus.PENDING,
          EmailMessageStatus.FAILED_RETRYABLE,
        ],
      },
    },
    data: {
      status: EmailMessageStatus.CANCELLED,
      cancelledAt: now,
      nextAttemptAt: null,
      lastErrorCode: "PASSWORD_RESET_STATUS_INELIGIBLE",
      lastErrorMessage: reason,
      sensitivePayloadCiphertext: null,
      sensitivePayloadNonce: null,
      sensitivePayloadClearedAt: now,
      renderedTextBody: null,
      renderedHtmlBody: null,
    },
  });
}

/**
 * Production mutation boundary for administrator BLOCKED/REJECTED changes.
 * Authorization and last-admin policy remain in the server action; this
 * service owns the fenced database mutation so worker race tests exercise the
 * same runtime path.
 *
 * Eligibility-enabling transition invariant
 * -----------------------------------------
 * Approve, unblock, and make-admin deliberately run without this fence. An
 * unfenced account transition is allowed only when it cannot restore
 * eligibility of an already invalidated token or message. Those transitions
 * write `User` and `AdminActionLog` only: they never clear
 * `PasswordResetToken.revokedAt` / `usedAt`, never move an `EmailMessage` out
 * of `CANCELLED`, and never restore a cleared sensitive payload. Token
 * supersession and consumption are likewise terminal.
 *
 * Any future change that can restore reset-message eligibility — reviving a
 * revoked or consumed token, un-cancelling a reset message, or re-encrypting a
 * cleared payload — must adopt the same user-scoped credential-dispatch fence
 * before it mutates `User`.
 */
export async function transitionUserToResetIneligibleStatus(params: {
  targetUserId: string;
  adminUserId: string;
  status: ResetIneligibleStatus;
  comment: string | null;
}): Promise<void> {
  await withCredentialDispatchFence(params.targetUserId, async () => {
    await prisma.$transaction(async (tx) => {
      // Global order: fence -> transaction -> User -> reset tokens -> messages.
      const locked = await lockUserRowForUpdate(tx, params.targetUserId);
      if (!locked) throw new Error("Target user not found.");
      const now = new Date();
      const rejected = params.status === "REJECTED";

      await tx.user.update({
        where: { id: params.targetUserId },
        data: rejected
          ? {
              status: "REJECTED",
              rejectedAt: now,
              rejectedByUserId: params.adminUserId,
              blockedAt: null,
              blockedByUserId: null,
              ...(params.comment
                ? { approvalComment: params.comment }
                : {}),
            }
          : {
              status: "BLOCKED",
              blockedAt: now,
              blockedByUserId: params.adminUserId,
              ...(params.comment
                ? { approvalComment: params.comment }
                : {}),
            },
      });

      await invalidatePasswordResetDelivery(
        tx,
        params.targetUserId,
        now,
        rejected ? "USER_REJECTED" : "USER_BLOCKED",
      );
      await tx.adminActionLog.create({
        data: {
          adminUserId: params.adminUserId,
          targetUserId: params.targetUserId,
          action: rejected ? "USER_REJECTED" : "USER_BLOCKED",
          comment: params.comment,
        },
      });
    });
  });
}
