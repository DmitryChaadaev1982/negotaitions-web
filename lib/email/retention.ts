import { EmailMessageStatus } from "@/app/generated/prisma/client";
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
] as const;

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
};

function daysAgo(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function runEmailRetentionCleanup(params?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<EmailRetentionResult> {
  const config = getEmailConfig();
  const dryRun = Boolean(params?.dryRun);
  const limit = Math.max(1, Math.min(params?.limit ?? 500, 5000));
  const now = new Date();
  const contentCutoff = daysAgo(config.contentRetentionDays, now);
  const providerIdCutoff = daysAgo(config.providerIdRetentionDays, now);
  const attemptCutoff = daysAgo(config.deliveryAttemptRetentionDays, now);
  const eventCutoff = daysAgo(config.providerEventRetentionDays, now);

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
    };
  }

  const [content, providerIds, attempts, events, suppressions] = await prisma.$transaction([
    prisma.emailMessage.updateMany({
      where: { id: { in: contentCandidates.map((item) => item.id) } },
      data: {
        renderedSubject: null,
        renderedTextBody: null,
        renderedHtmlBody: null,
        recipientEmail: null,
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
  };
  logEmailEvent("info", "retention_cleanup", result);
  return result;
}
