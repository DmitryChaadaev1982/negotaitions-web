import {
  EmailMessageStatus,
  EmailProviderEventProcessingStatus,
  EmailProviderEventType,
  EmailSuppressionReason,
  EmailSuppressionSource,
  type Prisma,
} from "@/app/generated/prisma/client";
import type { NormalizedProviderEventInput } from "@/lib/email/types";
import { prisma } from "@/lib/prisma";

function statusForProviderEvent(eventType: EmailProviderEventType): EmailMessageStatus | null {
  switch (eventType) {
    case EmailProviderEventType.ACCEPTED:
      return EmailMessageStatus.ACCEPTED_BY_PROVIDER;
    case EmailProviderEventType.DELIVERED:
      return EmailMessageStatus.DELIVERED;
    case EmailProviderEventType.DELAYED:
      return EmailMessageStatus.DELAYED;
    case EmailProviderEventType.BOUNCED:
      return EmailMessageStatus.BOUNCED;
    case EmailProviderEventType.COMPLAINED:
      return EmailMessageStatus.COMPLAINED;
    case EmailProviderEventType.REJECTED:
    case EmailProviderEventType.RENDERING_FAILED:
      return EmailMessageStatus.FAILED_FINAL;
    case EmailProviderEventType.UNKNOWN:
      return null;
  }
}

function suppressionReasonForEvent(
  input: NormalizedProviderEventInput,
): EmailSuppressionReason | null {
  if (input.suppressionReason) return input.suppressionReason;
  if (input.eventType === EmailProviderEventType.BOUNCED) {
    return EmailSuppressionReason.HARD_BOUNCE;
  }
  if (input.eventType === EmailProviderEventType.COMPLAINED) {
    return EmailSuppressionReason.COMPLAINT;
  }
  return null;
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

export async function processEmailProviderEvent(input: NormalizedProviderEventInput) {
  const existing = await prisma.emailProviderEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: input.provider,
        providerEventId: input.providerEventId,
      },
    },
  });
  if (existing) {
    return { created: false, processed: existing.processingStatus === "PROCESSED" };
  }

  const message = input.providerMessageId
    ? await prisma.emailMessage.findFirst({
        where: { lastProviderMessageId: input.providerMessageId },
      })
    : null;
  const nextStatus = statusForProviderEvent(input.eventType);
  const suppressionReason = suppressionReasonForEvent(input);

  await prisma.$transaction(async (tx) => {
    await tx.emailProviderEvent.create({
      data: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        providerMessageId: input.providerMessageId ?? null,
        emailMessageId: message?.id ?? null,
        eventType: input.eventType,
        eventTime: input.eventTime,
        processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
        metadata: sanitizeMetadata(input.metadata),
        processedAt: new Date(),
      },
    });

    if (message && nextStatus) {
      await tx.emailMessage.update({
        where: { id: message.id },
        data: {
          status: nextStatus,
          deliveredAt:
            input.eventType === EmailProviderEventType.DELIVERED
              ? input.eventTime
              : message.deliveredAt,
          terminalFailureAt:
            nextStatus === EmailMessageStatus.BOUNCED ||
            nextStatus === EmailMessageStatus.COMPLAINED ||
            nextStatus === EmailMessageStatus.FAILED_FINAL
              ? input.eventTime
              : message.terminalFailureAt,
        },
      });
    }

    if (message && suppressionReason) {
      await tx.emailSuppression.create({
        data: {
          recipientEmailNormalized: message.recipientEmailNormalized,
          reason: suppressionReason,
          source: EmailSuppressionSource.PROVIDER_EVENT,
          categoryScope: null,
          metadata: sanitizeMetadata({
            provider: input.provider,
            providerEventId: input.providerEventId,
            messageId: message.id,
          }),
        },
      });
    }
  });

  return { created: true, processed: true, messageId: message?.id ?? null };
}
