import {
  EmailMessageStatus,
  EmailProviderEventProcessingStatus,
  EmailProviderEventSuppressionDisposition,
  EmailProviderEventType,
  EmailSuppressionReason,
  EmailSuppressionSource,
  type EmailMessage,
  type EmailProviderEvent,
  type Prisma,
} from "@/app/generated/prisma/client";
import { getEmailConfig } from "@/lib/email/config";
import { evaluateProviderEventTransition } from "@/lib/email/provider-event-policy";
import { createActiveSuppression } from "@/lib/email/suppression";
import type { NormalizedProviderEventInput } from "@/lib/email/types";
import { prisma } from "@/lib/prisma";

/**
 * Maps the durable, parse-time suppression decision to a suppression reason.
 *
 * A missing disposition means the row predates Stage 3.13C remediation. It is
 * deliberately treated as "no permanent suppression": a BOUNCED event must
 * never be reconstructed as a hard bounce from its event type alone, because
 * transient bounces share that event type.
 */
export function suppressionReasonForDisposition(
  disposition: EmailProviderEventSuppressionDisposition | null | undefined,
): EmailSuppressionReason | null {
  switch (disposition) {
    case EmailProviderEventSuppressionDisposition.HARD_BOUNCE:
      return EmailSuppressionReason.HARD_BOUNCE;
    case EmailProviderEventSuppressionDisposition.COMPLAINT:
      return EmailSuppressionReason.COMPLAINT;
    default:
      return null;
  }
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  const json = JSON.stringify(metadata);
  if (json.length > 8192) {
    return { truncated: true };
  }
  return JSON.parse(json) as Prisma.InputJsonValue;
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function processEmailProviderEvent(input: NormalizedProviderEventInput) {
  const config = getEmailConfig();
  const now = new Date();
  let eventId: string;
  const created = true;

  try {
    const event = await prisma.emailProviderEvent.create({
      data: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        providerMessageId: input.providerMessageId ?? null,
        eventType: input.eventType,
        eventTime: input.eventTime,
        processingStatus: EmailProviderEventProcessingStatus.PENDING,
        nextReconcileAt: now,
        reconciliationDeadlineAt: addSeconds(
          now,
          config.providerEventReconciliationWindowSeconds,
        ),
        suppressionDisposition:
          input.suppressionDisposition ??
          EmailProviderEventSuppressionDisposition.NONE,
        metadata: sanitizeMetadata(input.metadata),
      },
    });
    eventId = event.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.emailProviderEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: input.provider,
          providerEventId: input.providerEventId,
        },
      },
    });
    if (!existing) throw error;
    const repaired = await reconcileEmailProviderEventById(existing.id, now);
    return {
      created: false,
      processed: repaired.processed,
      messageId: repaired.messageId,
      processingStatus: repaired.processingStatus,
    };
  }

  const result = await reconcileEmailProviderEventById(eventId);
  return { created, ...result };
}

export async function reconcileEmailProviderEventById(eventId: string, now = new Date()) {
  const config = getEmailConfig();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 5000");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = 5000");

    const eventRows = await tx.$queryRaw<EmailProviderEvent[]>`
      SELECT *
        FROM "EmailProviderEvent"
       WHERE "id" = ${eventId}
       FOR UPDATE
    `;
    const event = eventRows[0];
    if (!event) {
      return { processed: false, messageId: null, processingStatus: null };
    }

    if (!event.providerMessageId) {
      await tx.emailProviderEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: EmailProviderEventProcessingStatus.IGNORED,
          processingResultCode: "NO_PROVIDER_MESSAGE_ID",
          processingResultMessage: "Provider event did not include a provider message id.",
          processedAt: now,
          nextReconcileAt: null,
        },
      });
      return {
        processed: false,
        messageId: null,
        processingStatus: EmailProviderEventProcessingStatus.IGNORED,
      };
    }

    const messageRows = await tx.$queryRaw<EmailMessage[]>`
      SELECT *
        FROM "EmailMessage"
       WHERE "providerName" = ${event.provider}
         AND "lastProviderMessageId" = ${event.providerMessageId}
       FOR UPDATE
    `;
    const message = messageRows[0];

    if (!message) {
      const deadline = event.reconciliationDeadlineAt ?? addSeconds(
        event.createdAt,
        config.providerEventReconciliationWindowSeconds,
      );
      const expired = now >= deadline;
      const updated = await tx.emailProviderEvent.update({
        where: { id: event.id },
        data: expired
          ? {
              processingStatus: EmailProviderEventProcessingStatus.IGNORED,
              processingResultCode: "RECONCILIATION_EXPIRED",
              processingResultMessage: "No matching email message was found before the reconciliation window expired.",
              processedAt: now,
              nextReconcileAt: null,
              reconciliationDeadlineAt: deadline,
            }
          : {
              processingStatus: EmailProviderEventProcessingStatus.UNMATCHED,
              processingResultCode: "UNMATCHED_PROVIDER_MESSAGE",
              processingResultMessage: "No matching email message exists yet for the provider-qualified id.",
              nextReconcileAt: addSeconds(now, config.providerEventReconciliationDelaySeconds),
              reconciliationDeadlineAt: deadline,
              reconciliationAttempts: { increment: 1 },
            },
      });
      return {
        processed: false,
        messageId: null,
        processingStatus: updated.processingStatus,
      };
    }

    const suppressionReason = suppressionReasonForDisposition(
      event.suppressionDisposition,
    );
    const suppressionMetadata = sanitizeMetadata({
      provider: event.provider,
      providerEventId: event.providerEventId,
      messageId: message.id,
    });

    if (event.processingStatus === EmailProviderEventProcessingStatus.PROCESSED) {
      if (suppressionReason) {
        await createActiveSuppression({
          recipientEmailNormalized: message.recipientEmailNormalized,
          reason: suppressionReason,
          source: EmailSuppressionSource.PROVIDER_EVENT,
          categoryScope: null,
          metadata: suppressionMetadata,
          db: tx,
        });
      }
      return {
        processed: true,
        messageId: message.id,
        processingStatus: event.processingStatus,
      };
    }

    const decision = evaluateProviderEventTransition({
      currentStatus: message.status,
      lastProviderEventTime: message.lastProviderEventTime,
      eventType: event.eventType,
      eventTime: event.eventTime,
    });

    if (decision.apply) {
      await tx.emailMessage.update({
        where: { id: message.id },
        data: {
          status: decision.nextStatus,
          lastProviderEventType: event.eventType,
          lastProviderEventTime: event.eventTime,
          deliveredAt:
            event.eventType === EmailProviderEventType.DELIVERED
              ? event.eventTime
              : message.deliveredAt,
          terminalFailureAt:
            decision.nextStatus === EmailMessageStatus.BOUNCED ||
            decision.nextStatus === EmailMessageStatus.COMPLAINED ||
            decision.nextStatus === EmailMessageStatus.FAILED_FINAL
              ? event.eventTime
              : message.terminalFailureAt,
        },
      });

      if (suppressionReason) {
        await createActiveSuppression({
          recipientEmailNormalized: message.recipientEmailNormalized,
          reason: suppressionReason,
          source: EmailSuppressionSource.PROVIDER_EVENT,
          categoryScope: null,
          metadata: suppressionMetadata,
          db: tx,
        });
      }
    }

    await tx.emailProviderEvent.update({
      where: { id: event.id },
      data: {
        emailMessageId: message.id,
        processingStatus: decision.apply
          ? EmailProviderEventProcessingStatus.PROCESSED
          : EmailProviderEventProcessingStatus.IGNORED,
        processingResultCode: decision.resultCode,
        processingResultMessage: decision.resultMessage,
        processedAt: now,
        nextReconcileAt: null,
      },
    });

    return {
      processed: decision.apply,
      messageId: message.id,
      processingStatus: decision.apply
        ? EmailProviderEventProcessingStatus.PROCESSED
        : EmailProviderEventProcessingStatus.IGNORED,
      resultCode: decision.resultCode,
    };
  });
}

export async function runEmailProviderEventReconciliationSweep(params?: {
  limit?: number;
  now?: Date;
}) {
  const now = params?.now ?? new Date();
  const limit = Math.max(1, Math.min(params?.limit ?? 100, 1000));
  const candidates = await prisma.emailProviderEvent.findMany({
    where: {
      processingStatus: {
        in: [
          EmailProviderEventProcessingStatus.PENDING,
          EmailProviderEventProcessingStatus.UNMATCHED,
        ],
      },
      OR: [{ nextReconcileAt: null }, { nextReconcileAt: { lte: now } }],
    },
    orderBy: [{ nextReconcileAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  let unmatched = 0;
  let ignored = 0;
  for (const candidate of candidates) {
    const result = await reconcileEmailProviderEventById(candidate.id, now);
    if (result.processingStatus === EmailProviderEventProcessingStatus.PROCESSED) {
      processed += 1;
    } else if (result.processingStatus === EmailProviderEventProcessingStatus.UNMATCHED) {
      unmatched += 1;
    } else if (result.processingStatus === EmailProviderEventProcessingStatus.IGNORED) {
      ignored += 1;
    }
  }

  return {
    scanned: candidates.length,
    processed,
    unmatched,
    ignored,
  };
}
