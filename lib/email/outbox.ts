import {
  EmailMessageCategory,
  EmailMessageStatus,
  type Prisma,
} from "@/app/generated/prisma/client";
import { normalizeEmailAddress } from "@/lib/email/address";
import { getEmailConfig } from "@/lib/email/config";
import { renderEmailTemplate } from "@/lib/email/renderer";
import {
  assertDeferredSensitiveRenderIsTokenFree,
  sanitizeEmailMetadata,
} from "@/lib/email/rendered-content-guards";
import { evaluateSuppression } from "@/lib/email/suppression";
import { loadTemplate } from "@/lib/email/templates";
import type {
  EmailLocale,
  EnqueueEmailInput,
  EnqueueEmailResult,
} from "@/lib/email/types";
import { prisma } from "@/lib/prisma";

type EmailDbClient = typeof prisma | Prisma.TransactionClient;

function normalizeLocale(value: string | null | undefined): EmailLocale {
  return value?.toLowerCase() === "ru" ? "ru" : "en";
}

export async function enqueueEmail(
  input: EnqueueEmailInput,
  db: EmailDbClient = prisma,
): Promise<EnqueueEmailResult> {
  const config = getEmailConfig();
  const locale = normalizeLocale(input.locale);
  // Persist the same canonical ASCII recipient in both durable fields. The
  // normalized field remains indexed; the nullable field supports retention.
  const recipientEmail = normalizeEmailAddress(input.recipientEmail);
  const recipientEmailNormalized = recipientEmail;
  const template = loadTemplate(input.templateKey, locale);
  if (!template.metadata.runtimeEnabled) {
    throw new Error(`Email template ${input.templateKey} is reserved for a future stage.`);
  }
  if (template.metadata.messageType !== input.messageType) {
    throw new Error("Email message type does not match template metadata.");
  }
  if (template.metadata.category !== input.category) {
    throw new Error("Email category does not match template metadata.");
  }
  if (input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 256) {
    throw new Error("Invalid email idempotency key.");
  }

  const deferSensitive = Boolean(input.deferSensitiveRender);
  if (deferSensitive && !input.sensitivePayload) {
    throw new Error("Deferred sensitive render requires an encrypted payload.");
  }

  let renderedSubject: string | null = null;
  let renderedTextBody: string | null = null;
  let renderedHtmlBody: string | null = null;
  let templateVersion = template.metadata.version;

  if (!deferSensitive) {
    const rendered = renderEmailTemplate({
      key: input.templateKey,
      locale,
      variables: input.variables,
    });
    renderedSubject = rendered.subject;
    renderedTextBody = rendered.textBody;
    renderedHtmlBody = rendered.htmlBody;
    templateVersion = rendered.templateVersion;
  } else {
    // Persist only a token-free subject for operations visibility.
    // Bodies stay null until late-render at dispatch (then cleared after send).
    const rendered = renderEmailTemplate({
      key: input.templateKey,
      locale,
      variables: input.variables,
    });
    // Reject token-shaped rendered content regardless of the token-free
    // placeholder action URL, then discard the bodies entirely.
    assertDeferredSensitiveRenderIsTokenFree({
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
    });
    renderedSubject = rendered.subject;
    templateVersion = rendered.templateVersion;
    renderedTextBody = null;
    renderedHtmlBody = null;
  }

  const fromAddress = config.from[template.metadata.defaultSender];
  const replyToAddress = config.replyTo[template.metadata.defaultReplyTo];
  const suppression = await evaluateSuppression({
    recipientEmail,
    category: input.category,
    db,
  });
  const status = suppression.suppressed
    ? EmailMessageStatus.SUPPRESSED
    : EmailMessageStatus.PENDING;

  try {
    const message = await db.emailMessage.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        messageType: input.messageType,
        category: input.category,
        status,
        userId: input.userId ?? null,
        recipientEmail,
        recipientEmailNormalized,
        fromAddress,
        replyToAddress,
        locale,
        templateKey: input.templateKey,
        templateVersion,
        renderedSubject,
        renderedTextBody,
        renderedHtmlBody,
        sensitivePayloadCiphertext: input.sensitivePayload?.ciphertext ?? null,
        sensitivePayloadNonce: input.sensitivePayload?.nonce ?? null,
        sensitivePayloadClearedAt: null,
        relatedTokenId: input.relatedTokenId ?? null,
        metadata: sanitizeEmailMetadata({
          ...(input.metadata ?? {}),
          suppressionReason: suppression.reason ?? undefined,
          suppressionId: suppression.suppressionId ?? undefined,
        }),
        idempotencyKey: input.idempotencyKey,
        providerName: config.provider,
        nextAttemptAt: suppression.suppressed ? null : new Date(),
        suppressedAt: suppression.suppressed ? new Date() : null,
      },
      select: { id: true, status: true },
    });
    return suppression.suppressed
      ? {
          created: true,
          duplicate: false,
          suppressed: true,
          messageId: message.id,
          status: message.status,
        }
      : {
          created: true,
          duplicate: false,
          suppressed: false,
          messageId: message.id,
          status: message.status,
        };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      const existing = await db.emailMessage.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, status: true },
      });
      if (existing) {
        if (existing.status === EmailMessageStatus.SUPPRESSED) {
          return {
            created: false,
            suppressed: true,
            duplicate: true,
            messageId: existing.id,
            status: existing.status,
          };
        }
        return {
          created: false,
          suppressed: false,
          duplicate: true,
          messageId: existing.id,
          status: existing.status,
        };
      }
    }
    throw error;
  }
}

export function ensureAllowedCategoryForSystemTest(category: EmailMessageCategory) {
  if (category !== EmailMessageCategory.ADMIN_TEST) {
    throw new Error("System test email must use ADMIN_TEST category.");
  }
}
