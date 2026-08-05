import { EmailMessageStatus, EmailMessageType } from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
import { logEmailEvent } from "@/lib/email/observability";
import { prisma } from "@/lib/prisma";

const TERMINAL_MESSAGE_STATES = [
  EmailMessageStatus.DELIVERED,
  EmailMessageStatus.BOUNCED,
  EmailMessageStatus.COMPLAINED,
  EmailMessageStatus.SUPPRESSED,
  EmailMessageStatus.FAILED_FINAL,
  EmailMessageStatus.CANCELLED,
  EmailMessageStatus.ACCEPTED_BY_PROVIDER,
  EmailMessageStatus.ACCEPTANCE_UNKNOWN,
] as const;

/** Password-reset ciphertext retention is short and independent of content days. */
const SENSITIVE_PAYLOAD_RETENTION_HOURS = 36;

export type EmailRetentionResult = {
  dryRun: boolean;
  contentCandidates: number;
  contentCleared: number;
  providerIdCandidates: number;
  providerIdsCleared: number;
  attemptCandidates: number;
  attemptsDeleted: number;
  providerEventCandidates: number;
  providerEventsDeleted: number;
  expiredSuppressionsDeactivated: number;
  sensitivePayloadCandidates: number;
  sensitivePayloadsCleared: number;
  expiredResetTokenCandidates: number;
  expiredResetTokensDeleted: number;
  recipientNormalizedCleared: number;
};

function daysAgo(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function hoursAgo(hours: number, now = new Date()) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

export async function runEmailRetentionCleanup(params?: {
  dryRun?: boolean;
  limit?: number;
  now?: Date;
}): Promise<EmailRetentionResult> {
  const config = getEmailConfig();
  const dryRun = Boolean(params?.dryRun);
  const limit = Math.max(1, Math.min(params?.limit ?? 500, 5000));
  const now = params?.now ?? new Date();
  const contentCutoff = daysAgo(config.contentRetentionDays, now);
  const providerIdCutoff = daysAgo(config.providerIdRetentionDays, now);
  const attemptCutoff = daysAgo(config.deliveryAttemptRetentionDays, now);
  const eventCutoff = daysAgo(config.providerEventRetentionDays, now);
  const sensitiveCutoff = hoursAgo(SENSITIVE_PAYLOAD_RETENTION_HOURS, now);

  const contentCandidates = await prisma.emailMessage.findMany({
    where: {
      status: { in: TERMINAL_MESSAGE_STATES as unknown as EmailMessageStatus[] },
      createdAt: { lte: contentCutoff },
      contentClearedAt: null,
      OR: [
        { renderedSubject: { not: null } },
        { renderedTextBody: { not: null } },
        { renderedHtmlBody: { not: null } },
        { recipientEmail: { not: null } },
        { recipientEmailNormalized: { not: "" } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  const providerIdCandidates = await prisma.emailMessage.findMany({
    where: {
      status: { in: TERMINAL_MESSAGE_STATES as unknown as EmailMessageStatus[] },
      createdAt: { lte: providerIdCutoff },
      providerMessageIdClearedAt: null,
      lastProviderMessageId: { not: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  const attemptCandidates = await prisma.emailDeliveryAttempt.findMany({
    where: { startedAt: { lte: attemptCutoff } },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  const providerEventCandidates = await prisma.emailProviderEvent.findMany({
    where: { createdAt: { lte: eventCutoff } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  const expiredSuppressions = await prisma.emailSuppression.findMany({
    where: {
      active: true,
      expiresAt: { lte: now },
    },
    take: limit,
    select: { id: true },
  });

  const sensitivePayloadCandidates = await prisma.emailMessage.findMany({
    where: {
      OR: [
        {
          messageType: EmailMessageType.PASSWORD_RESET,
          sensitivePayloadCiphertext: { not: null },
          createdAt: { lte: sensitiveCutoff },
        },
        {
          messageType: EmailMessageType.PASSWORD_RESET,
          sensitivePayloadCiphertext: { not: null },
          status: {
            in: [
              EmailMessageStatus.CANCELLED,
              EmailMessageStatus.FAILED_FINAL,
              EmailMessageStatus.SUPPRESSED,
              EmailMessageStatus.ACCEPTED_BY_PROVIDER,
            ],
          },
        },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  const expiredResetTokenCandidates = await prisma.passwordResetToken.findMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { usedAt: { not: null } },
        { revokedAt: { not: null } },
      ],
      // Keep recently used tokens briefly for audit correlation; purge older.
      createdAt: { lte: daysAgo(7, now) },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  if (dryRun) {
    return {
      dryRun,
      contentCandidates: contentCandidates.length,
      contentCleared: 0,
      providerIdCandidates: providerIdCandidates.length,
      providerIdsCleared: 0,
      attemptCandidates: attemptCandidates.length,
      attemptsDeleted: 0,
      providerEventCandidates: providerEventCandidates.length,
      providerEventsDeleted: 0,
      expiredSuppressionsDeactivated: 0,
      sensitivePayloadCandidates: sensitivePayloadCandidates.length,
      sensitivePayloadsCleared: 0,
      expiredResetTokenCandidates: expiredResetTokenCandidates.length,
      expiredResetTokensDeleted: 0,
      recipientNormalizedCleared: 0,
    };
  }

  const [
    content,
    providerIds,
    attempts,
    events,
    suppressions,
    sensitive,
    tokens,
  ] = await prisma.$transaction([
    prisma.emailMessage.updateMany({
      where: { id: { in: contentCandidates.map((item) => item.id) } },
      data: {
        renderedSubject: null,
        renderedTextBody: null,
        renderedHtmlBody: null,
        recipientEmail: null,
        // Minimize durable recipient identity after retention cutoff.
        recipientEmailNormalized: "",
        contentClearedAt: now,
      },
    }),
    prisma.emailMessage.updateMany({
      where: { id: { in: providerIdCandidates.map((item) => item.id) } },
      data: {
        lastProviderMessageId: null,
        providerMessageIdClearedAt: now,
      },
    }),
    prisma.emailDeliveryAttempt.deleteMany({
      where: { id: { in: attemptCandidates.map((item) => item.id) } },
    }),
    prisma.emailProviderEvent.deleteMany({
      where: { id: { in: providerEventCandidates.map((item) => item.id) } },
    }),
    prisma.emailSuppression.updateMany({
      where: { id: { in: expiredSuppressions.map((item) => item.id) } },
      data: {
        active: false,
        liftedAt: now,
        liftReason: "Expired temporary suppression.",
      },
    }),
    prisma.emailMessage.updateMany({
      where: { id: { in: sensitivePayloadCandidates.map((item) => item.id) } },
      data: {
        sensitivePayloadCiphertext: null,
        sensitivePayloadNonce: null,
        sensitivePayloadClearedAt: now,
        renderedTextBody: null,
        renderedHtmlBody: null,
      },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { id: { in: expiredResetTokenCandidates.map((item) => item.id) } },
    }),
  ]);

  const result = {
    dryRun,
    contentCandidates: contentCandidates.length,
    contentCleared: content.count,
    providerIdCandidates: providerIdCandidates.length,
    providerIdsCleared: providerIds.count,
    attemptCandidates: attemptCandidates.length,
    attemptsDeleted: attempts.count,
    providerEventCandidates: providerEventCandidates.length,
    providerEventsDeleted: events.count,
    expiredSuppressionsDeactivated: suppressions.count,
    sensitivePayloadCandidates: sensitivePayloadCandidates.length,
    sensitivePayloadsCleared: sensitive.count,
    expiredResetTokenCandidates: expiredResetTokenCandidates.length,
    expiredResetTokensDeleted: tokens.count,
    recipientNormalizedCleared: content.count,
  };
  logEmailEvent("info", "retention_cleanup", result);
  return result;
}
