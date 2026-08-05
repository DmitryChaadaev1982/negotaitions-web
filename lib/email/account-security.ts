import {
  EmailMessageCategory,
  EmailMessageType,
  ExternalService,
  ExternalServiceErrorCode,
  ExternalServiceEventSeverity,
  type Prisma,
} from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
import { logEmailEvent } from "@/lib/email/observability";
import { enqueueEmail } from "@/lib/email/outbox";
import {
  buildPasswordResetActionUrl,
  encryptSensitivePayload,
} from "@/lib/email/sensitive-payload";
import { prisma } from "@/lib/prisma";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";

type EmailTransaction = Prisma.TransactionClient;
type AccountEmailUser = {
  id: string;
  email: string;
  name: string | null;
  preferredLocale: string;
  credentialGeneration?: number;
};

function localeFor(user: AccountEmailUser): "ru" | "en" {
  return user.preferredLocale === "ru" ? "ru" : "en";
}

function displayName(user: AccountEmailUser): string {
  if (user.name?.trim()) return user.name.trim();
  return localeFor(user) === "ru" ? "пользователь" : "user";
}

function canonicalUrl(pathname: string, params?: Record<string, string>): string {
  const config = getEmailConfig();
  const url = new URL(pathname, config.canonicalBaseUrl);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Enqueue a password-reset email without persisting the raw token.
 * The token lives only in an authenticated ciphertext until delivery/cancel.
 */
export async function enqueuePasswordResetEmail(params: {
  user: AccountEmailUser;
  rawToken: string;
  tokenId: string;
  credentialGeneration: number;
  tx: EmailTransaction;
}) {
  const config = getEmailConfig();
  const locale = localeFor(params.user);
  const variables = {
    userName: displayName(params.user),
    supportEmail: config.replyTo.security,
    operatorName: config.operatorName,
    reason: "account-security",
  };
  const encrypted = encryptSensitivePayload({
    v: 1,
    kind: "password-reset",
    rawToken: params.rawToken,
    locale,
    variables,
    credentialGeneration: params.credentialGeneration,
    tokenId: params.tokenId,
  });

  // Fragment URL is computed only for in-memory delivery; never persisted here.
  // Store a token-free placeholder URL so template validation can still run for
  // non-sensitive subject rendering when needed by late-render workers.
  void buildPasswordResetActionUrl(config.canonicalBaseUrl, params.rawToken);

  return enqueueEmail(
    {
      messageType: EmailMessageType.PASSWORD_RESET,
      category: EmailMessageCategory.SECURITY,
      recipientEmail: params.user.email,
      userId: params.user.id,
      locale,
      templateKey: "password-reset",
      // Placeholder variables without the raw token. Worker re-renders from
      // the encrypted payload immediately before provider dispatch.
      variables: {
        ...variables,
        actionUrl: new URL("/reset-password", config.canonicalBaseUrl).toString(),
      },
      idempotencyKey: `password-reset:${params.tokenId}`,
      relatedTokenId: params.tokenId,
      deferSensitiveRender: true,
      sensitivePayload: encrypted,
      metadata: {
        credentialGeneration: params.credentialGeneration,
        passwordResetTokenId: params.tokenId,
        sensitive: true,
      },
    },
    params.tx,
  );
}

export async function enqueueRecoveryDeniedEmail(params: {
  user: AccountEmailUser;
  bucket: number;
  tx: EmailTransaction;
}) {
  const config = getEmailConfig();
  return enqueueEmail(
    {
      messageType: EmailMessageType.ACCOUNT_RECOVERY_DENIED,
      category: EmailMessageCategory.SECURITY,
      recipientEmail: params.user.email,
      userId: params.user.id,
      locale: localeFor(params.user),
      templateKey: "account-recovery-denied",
      variables: {
        userName: displayName(params.user),
        supportEmail: config.replyTo.security,
        operatorName: config.operatorName,
        reason: "account-recovery",
      },
      idempotencyKey: `account-recovery-denied:${params.user.id}:${params.bucket}`,
    },
    params.tx,
  );
}

export async function enqueuePasswordChangedEmail(params: {
  user: AccountEmailUser;
  idempotencyKey: string;
  changedAt: Date;
  tx: EmailTransaction;
}) {
  const config = getEmailConfig();
  return enqueueEmail(
    {
      messageType: EmailMessageType.PASSWORD_CHANGED,
      category: EmailMessageCategory.SECURITY,
      recipientEmail: params.user.email,
      userId: params.user.id,
      locale: localeFor(params.user),
      templateKey: "password-changed",
      variables: {
        userName: displayName(params.user),
        changedAt: params.changedAt.toISOString(),
        supportEmail: config.replyTo.security,
        operatorName: config.operatorName,
        reason: "password-changed",
      },
      idempotencyKey: params.idempotencyKey,
    },
    params.tx,
  );
}

export async function enqueuePendingApprovalEmail(params: {
  admin: AccountEmailUser;
  pendingUser: { id: string; email: string };
}) {
  const config = getEmailConfig();
  return enqueueEmail({
    messageType: EmailMessageType.ADMIN_PENDING_APPROVAL,
    category: EmailMessageCategory.TRANSACTIONAL,
    recipientEmail: params.admin.email,
    userId: params.admin.id,
    locale: localeFor(params.admin),
    templateKey: "admin-pending-approval",
    variables: {
      adminName: displayName(params.admin),
      pendingUserEmail: params.pendingUser.email,
      actionUrl: canonicalUrl("/admin/users"),
      supportEmail: config.replyTo.support,
      operatorName: config.operatorName,
      reason: "pending-approval",
    },
    idempotencyKey: `admin-pending-approval:${params.pendingUser.id}:${params.admin.id}`,
  });
}

export async function notifyActiveAdminsOfPendingRegistration(pendingUser: {
  id: string;
  email: string;
}): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { globalRole: "ADMIN", status: "ACTIVE" },
      select: {
        id: true,
        email: true,
        name: true,
        preferredLocale: true,
      },
    });
    const results = await Promise.allSettled(
      admins.map((admin) =>
        enqueuePendingApprovalEmail({ admin, pendingUser }),
      ),
    );
    const failureCount = results.filter((result) => result.status === "rejected").length;
    if (failureCount > 0) {
      await recordPendingApprovalEnqueueFailure(failureCount);
    }
  } catch {
    await recordPendingApprovalEnqueueFailure(1);
  }
}

async function recordPendingApprovalEnqueueFailure(failureCount: number) {
  logEmailEvent("error", "admin_pending_approval_enqueue_failed", {
    failureCount,
  });
  await logExternalServiceEvent({
    service: ExternalService.EMAIL,
    severity: ExternalServiceEventSeverity.WARNING,
    errorCode: ExternalServiceErrorCode.UNKNOWN,
    title: "Pending approval email enqueue failure",
    message: "One or more administrator notifications could not be queued.",
  }).catch(() => null);
}
